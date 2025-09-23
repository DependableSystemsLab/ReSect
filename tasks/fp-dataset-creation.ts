import "basic-type-extensions";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Chain as ChainList } from "../src/config/Chain";
import { etherscanApiKey, quickNodeApiKey } from "../src/config/credentials";
import { typeormConfig } from "../src/config/typeorm";
import { JsonRpcConverter } from "../src/converters";
import { Block, Chain, Database, Transaction } from "../src/database";
import { Etherscan, QuickNode, RPC } from "../src/providers";
import { extractSelector, Hex } from "../src/utils";
import { ERC1155, ERC20, ERC721, type NamedABI } from "../src/config/ERC";


function* getSelectors(abi: NamedABI) {
	for (const key in abi) {
		const func = abi[key];
		yield func.selector;
	}
}
const commonTokenSelectors = new Set(
	[ERC20.abis, ERC721.abis, ERC1155.abis]
		.flatMap(abi => Array.from(getSelectors(abi)))
);

const database = new Database({
	...typeormConfig,
	logging: ["warn", "error"]
});

async function fetchTransactions(
	chainId: number,
	blockNumbers: number[],
	provider: "Etherscan" | "QuickNode" = "Etherscan"
) {
	if (provider === "QuickNode" && !quickNodeApiKey)
		throw new Error("QuickNode API key is not set");

	const chainRepo = await database.getRepository(Chain);
	const chain = await chainRepo.findOneBy({ id: chainId });
	if (chain == null)
		throw new Error(`Chain ${chainId} not found in database`);

	const blockRepo = await database.getRepository(Block);
	const txRepo = await database.getRepository(Transaction);

	const rpcProvider = new RPC.ExtendedProvider(
		provider === "Etherscan"
			? new Etherscan(etherscanApiKey, chainId).geth
			: new QuickNode(quickNodeApiKey!, chainId)
	);

	const digits = Math.floor(Math.log10(blockNumbers.length)) + 1;
	const bnDigits = Math.floor(Math.log10(blockNumbers.maximum())) + 1;
	const existingNumbers = new Set((await blockRepo.find({
		select: ["number"],
		where: { chainId }
	})).map(b => b.number));

	for (let i = 0; i < blockNumbers.length; ++i) {
		const blockNumber = blockNumbers[i];
		const logPrefix = `[${(i + 1).toString().padStart(digits, " ")}/${blockNumbers.length}] ${blockNumber.toString().padStart(bnDigits, " ")}: `;
		const log = (message: string, ...args: any[]) => console.log(logPrefix + message, ...args);

		if (existingNumbers.has(blockNumber)) {
			log("Already in database, skipping");
			continue;
		}
		const block = await rpcProvider.getBlockByNumber(blockNumber, true, chainId);
		if (block == null) {
			log(`Not found on chain ${chain.name} (${chainId})`);
			continue;
		}
		const blockEntity = JsonRpcConverter.blockToEntity(block, chainId);
		await blockRepo.save(blockEntity);
		const txEntities = new Array<Transaction>();
		for (const tx of block.transactions) {
			const selector = extractSelector(tx.input);
			if (selector == undefined)
				continue; // Skip native tokens transfers
			if (commonTokenSelectors.has(selector))
				continue; // Skip common token interactions
			const txEntity = JsonRpcConverter.transactionToEntity(tx, chainId);
			txEntity.tags = Transaction.Tags.RandomlySelected;
			txEntities.push(txEntity);
		}
		log(`Fetched ${block.transactions.length} transactions, ${txEntities.length} non-trivial`);
		await txRepo.save(txEntities);
	}
}

const cliParser = yargs()
	.option("chain", {
		alias: "c",
		type: "number",
		demandOption: true,
		description: `Chain ID to fetch transactions from. Supported: ${Object.entries(ChainList).map(([name, id]) => `${name} (${id})`).join(", ")}`
	})
	.option("provider", {
		alias: "p",
		type: "string",
		choices: ["Etherscan", "QuickNode"] as const,
		default: "Etherscan" as const,
		description: "Provider to use for fetching transactions",
	})
	.option("start", {
		type: "string",
		default: "0",
		description: "Starting date or block number for fetching transactions"
	})
	.option("end", {
		type: "string",
		description: "Ending date or block number for fetching transactions. If omitted, the latest block will be used"
	})
	.option("total", {
		alias: "n",
		type: "number",
		demandOption: true,
		description: "Total number of transactions to fetch"
	})
	.help()
	.alias("help", "h");



(async () => {
	const argv = await cliParser.parseAsync(hideBin(process.argv));

	const etherscan = new Etherscan(etherscanApiKey, argv.chain);
	async function parseRange(type: "start" | "end", value: string | undefined): Promise<number> {
		if (value?.match(/^\d+$/))
			return parseInt(value);
		if (value === undefined)
			return type === "start" ? 0 : Hex.toNumber(await etherscan.geth.blockNumber());
		const date = Date.parse(value);
		if (isNaN(date))
			throw new Error(`Invalid date: ${value}`);
		const block = await etherscan.getBlockNumberByTimestamp(Math.floor(date / 1000), type === "start" ? "after" : "before");
		if (block === null)
			throw new Error(`No block found for date: ${value}`);
		return block;
	}

	const startBlock = await parseRange("start", argv.start);
	const endBlock = await parseRange("end", argv.end);
	if (endBlock < startBlock)
		throw new Error(`End block (${endBlock}) is before start block (${startBlock})`);
	if (argv.total > endBlock - startBlock + 1)
		throw new Error(`Total (${argv.total}) is greater than available blocks (${endBlock - startBlock + 1})`);

	// Randomly select total block numbers in the range [startBlock, endBlock]
	const blockNumbers = new Set<number>();
	while (blockNumbers.size < argv.total)
		blockNumbers.add(Math.randomInteger(startBlock, endBlock));
	await fetchTransactions(argv.chain, Array.from(blockNumbers).sort((a, b) => a - b), argv.provider);
	await database.close();
})();