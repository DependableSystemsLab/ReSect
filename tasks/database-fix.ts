import "basic-type-extensions";
import { In, IsNull } from "typeorm";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { etherscanApiKeys, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { typeormConfig } from "../src/config/typeorm";
import { JsonRpcConverter } from "../src/converters";
import { Block, Chain, Contract, Database, Transaction } from "../src/database";
import { Etherscan, QuickNode, Tenderly, type RPC } from "../src/providers";
import { Analyzer } from "../src/core";
import { Hex } from "../src/utils";


const database = new Database({
	...typeormConfig,
	logging: ["warn", "error"]
});

async function fetchBlocks() {
	const repo = await database.getRepository(Transaction);
	const txs = await repo.find({ where: { blockNumber: IsNull() } });
	console.log(`Found ${txs.length} transactions without block number`);

	const chains = await (await database.getRepository(Chain)).find({ select: ["id"] });
	const base = BigInt(Math.max(...chains.map(c => c.id)) + 1);

	const etherscan = new Etherscan(etherscanApiKeys);
	const blockNumbers = new Set<bigint>();

	const handleError = async (error: any) => {
		if (error instanceof Response)
			error = await error.json();
		console.error(error);
	};

	await txs.forEachAsync(async (tx, idx) => {
		const transaction = await etherscan
			.getTransactionByHash(`0x${tx.hash}`, tx.chainId!)
			.catch(handleError);
		if (transaction == null)
			return;
		console.log(`Fetched tx ${idx + 1}/${txs.length}: ${transaction.hash}`);
		tx.blockNumber = Hex.toNumber(transaction.blockNumber);
		tx.blockIndex = Hex.toNumber(transaction.transactionIndex);
		const number = BigInt(tx.blockNumber) * base + BigInt(tx.chainId!);
		blockNumbers.add(number);
	});

	const blockRepo = await database.getRepository(Block);
	const existingBlocks = await blockRepo.find({ select: ["chainId", "number"] });
	const existingBlockNumbers = new Set(existingBlocks.map(b => BigInt(b.number) * base + BigInt(b.chainId)));
	const newBlocks = Array.from(blockNumbers)
		.filter(n => !existingBlockNumbers.has(n))
		.map(n => {
			const chainId = Number(n % base);
			const number = Number(n / base);
			return { number, chainId };
		});

	console.log(`Found ${newBlocks.length} new blocks`);
	const blocks = await newBlocks.mapAsync(async (block, idx) => {
		const blockData = await etherscan
			.getBlockByNumber(Hex.toString(block.number), false, block.chainId)
			.catch(handleError);
		if (blockData == null)
			return undefined;
		console.log(`Fetched block ${idx + 1}/${newBlocks.length}: ${blockData.hash}`);
		return JsonRpcConverter.blockToEntity(blockData, block.chainId);
	});

	await blockRepo.save(blocks.filter(b => b != null));
	await repo.save(txs);
}

async function fetchContracts() {
	const repo = await database.getRepository(Contract);
	const txnRepo = await database.getRepository(Transaction);
	const blockRepo = await database.getRepository(Block);
	const contracts = await repo.createQueryBuilder()
		.where("octet_length(code) = 0")
		.getMany();
	const txns = await txnRepo.find({ select: { hash: true, chainId: true } });
	const blocks = await blockRepo.find({ select: { number: true, chainId: true } });

	const contractsByChain = new Map<number, Contract[]>();
	for (const contract of contracts) {
		const chainId = contract.chainId!;
		let collection = contractsByChain.get(chainId);
		if (!collection) {
			collection = [];
			contractsByChain.set(chainId, collection);
		}
		collection.push(contract);
	}

	const etherscan = new Etherscan(etherscanApiKeys);
	const rpcProvider: RPC.MultiChainProvider = quickNodeApiKey ? new QuickNode(quickNodeApiKey) : etherscan;
	const debugProvider = quickNodeApiKey ? new QuickNode(quickNodeApiKey) : new Tenderly(tenderlyNodeAccessKeys);
	const errors = [];
	for (const [chainId, contracts] of contractsByChain) {
		console.log(`Found ${contracts.length} NULL or empty contracts for chain ${chainId}`);
		const creations = await etherscan.getContractCreation(contracts.map(c => Hex.addPrefix(c.address)), chainId);
		const existingTxns = new Set(txns.filter(t => t.chainId === chainId).map(t => t.hash));
		const missingTxns = new Array<Hex.TxHash>();
		const promises = new Array<Promise<void>>();
		const entitiesToSave = new Array<Contract>();
		for (let i = 0; i < contracts.length; ++i) {
			const contract = contracts[i];
			const creation = creations[i];
			if (creation == undefined) {
				contract.code = null;
				contract.creationTxHash = null;
				contract.creator = null;
				contract.contractFactory = null;
				entitiesToSave.push(contract);
			}
			else {
				const address = Hex.addPrefix(contract.address);
				const creationHash = creation.txHash as Hex.TxHash;
				contract.creationTxHash = Hex.removePrefix(creationHash);
				if (!existingTxns.has(contract.creationTxHash!))
					missingTxns.push(creationHash);
				contract.creator = Hex.removePrefix(creation.contractCreator);
				contract.contractFactory = creation.contractFactory == "" ? null : Hex.removePrefix(creation.contractFactory);
				promises.push(rpcProvider.getCode(address, "latest", chainId).then(async code => {
					if (code === "0x") {
						const trace = await debugProvider.getDebugTrace(creationHash, chainId);
						if (trace === null)
							throw new Error(`Failed to retrieve debug trace for ${creationHash}`);
						const createTrace = Analyzer.findCreateTrace(trace, address);
						if (createTrace === undefined)
							throw new Error(`Failed to find create trace for ${address}`);
						code = createTrace.output ?? "0x";
					}
					contract.code = Buffer.from(Hex.removePrefix(code), "hex");
					entitiesToSave.push(contract);
				}));
			}
		}
		for (const result of await Promise.allSettled(promises)) {
			if (result.status === "rejected")
				errors.push(result.reason);
		}
		if (entitiesToSave.length) {
			if (missingTxns.length) {
				const existingBlocks = new Set(blocks.filter(b => b.chainId === chainId).map(b => b.number));
				for (const txHash of missingTxns) {
					const txn = await rpcProvider.getTransactionByHash(txHash, chainId);
					if (!txn)
						throw new Error(`Failed to retrieve transaction for ${txHash}`);
					if (!existingBlocks.has(Hex.toNumber(txn.blockNumber))) {
						const block = await rpcProvider.getBlockByNumber(txn.blockNumber, false, chainId);
						if (!block)
							throw new Error(`Failed to retrieve block for ${txn.blockNumber}`);
						await database.saveBlock(block as RPC.Block, chainId);
						existingBlocks.add(Hex.toNumber(block.number));
					}
					await database.saveTransaction(txn!, chainId);
				}
			}
			await repo.save(entitiesToSave, { chunk: 16 });
			console.log(`Saved ${entitiesToSave.length} contracts for chain ${chainId}`);
		}
	}
	if (errors.length > 0)
		throw new AggregateError(errors);
}

async function cleanBlocks(chainId?: number) {
	const repo = await database.getRepository(Block);
	const txRepo = await database.getRepository(Transaction);
	const blocks = await repo.find({
		select: ["number", "chainId"],
		where: { chainId }
	});
	const blockNumbersByChain = new Map<number, Set<number>>();
	for (const { chainId, number } of blocks) {
		let set = blockNumbersByChain.get(chainId);
		if (!set) {
			set = new Set<number>();
			blockNumbersByChain.set(chainId, set);
		}
		set.add(number);
	}
	const txs = await txRepo.find({
		select: ["blockNumber", "chainId"],
		where: { chainId }
	});
	const txBlockNumbersByChain = new Map<number, Set<number>>();
	for (const { chainId, blockNumber } of txs) {
		if (chainId === undefined)
			continue;
		let set = txBlockNumbersByChain.get(chainId);
		if (!set) {
			set = new Set<number>();
			txBlockNumbersByChain.set(chainId, set);
		}
		set.add(blockNumber!);
	}
	for (const [chain, blockNumbers] of blockNumbersByChain) {
		const txBlockNumbers = txBlockNumbersByChain.get(chain);
		const diff = txBlockNumbers ? blockNumbers.difference(txBlockNumbers) : blockNumbers;
		if (diff.size > 0) {
			const result = await repo.delete({
				chainId: chain,
				number: In(Array.from(diff))
			});
			console.log(`Deleted ${result.affected} blocks for chain ${chain}`);
		}
	}
}

const cliParser = yargs()
	.command("fetch-blocks", false, undefined, fetchBlocks)
	.command("fetch-contracts", false, undefined, fetchContracts)
	.command({
		command: "clean-blocks [chainId]",
		describe: "Remove blocks that have no associated transactions",
		builder: yargs => yargs.positional("chainId", {
			type: "number",
			describe: "Chain ID to clean blocks for (all chains if not specified)",
			demandOption: false
		}),
		handler: argv => cleanBlocks(argv.chainId)
	})
	.demandCommand(1, "You need to specify a command")
	.strict()
	.help()
	.alias("help", "h");

cliParser.parseAsync(hideBin(process.argv)).catch(err => {
	console.error("Unhandled error in main:", err);
	process.exitCode = 1;
});