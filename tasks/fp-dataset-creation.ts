import "basic-type-extensions";
import cliProgress from "cli-progress";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { Raw } from "typeorm";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import readline from "readline";
import { Chain as ChainList } from "../src/config/Chain";
import { etherscanApiKeys, quickNodeApiKey } from "../src/config/credentials";
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
	total: number,
	blockRange: [start: number, end: number],
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
			? new Etherscan(etherscanApiKeys, chainId)
			: new QuickNode(quickNodeApiKey!, chainId)
	);

	const existingNumbers = new Set((await blockRepo.find({
		select: ["number"],
		where: { chainId }
	})).map(b => b.number));
	const existingTxCount = await txRepo.countBy({
		chainId,
		tags: Raw(alias => `(${alias} & ${Transaction.Tags.RandomlySelected}) != 0`)
	});
	if (existingTxCount >= total) {
		console.log(`Already have ${existingTxCount} transactions in database, which meets or exceeds the requested total of ${total}.`);
		return;
	}

	const bar = new cliProgress.SingleBar({
		format: `{bar} {percentage}% | ETA: {eta_formatted} | {value}/{total} txs | {message}`,
		etaBuffer: 20,
		hideCursor: true,
		autopadding: true
	}, cliProgress.Presets.shades_classic);

	let count = existingTxCount;
	bar.start(total, count, { message: "Starting..." });
	const startTime = Date.now();

	try {
		while (count < total) {
			const blockNumber = Math.randomInteger(blockRange[0], blockRange[1]);
			if (existingNumbers.has(blockNumber))
				continue;

			existingNumbers.add(blockNumber);
			const block = await rpcProvider
				.getBlockByNumber(blockNumber, true, chainId)
				.catch(err => {
					readline.clearLine(process.stdout, 0);
					readline.cursorTo(process.stdout, 0);
					console.log(err);
				});
			if (block == null)
				continue;

			const txEntities = new Array<Transaction>();
			for (const tx of block.transactions) {
				if (tx.from === tx.to)
					continue; // Skip self-calls
				const selector = extractSelector(tx.input);
				if (selector == undefined)
					continue; // Skip native tokens transfers
				if (commonTokenSelectors.has(selector))
					continue; // Skip common token interactions
				const txEntity = JsonRpcConverter.transactionToEntity(tx, chainId);
				txEntity.tags = Transaction.Tags.RandomlySelected;
				txEntities.push(txEntity);
				if (count + txEntities.length >= total)
					break;
			}

			if (txEntities.length) {
				await blockRepo.save(JsonRpcConverter.blockToEntity(block, chainId));
				await txRepo.save(txEntities);
				count += txEntities.length;
			}
			const nonTrivialPercent = block.transactions.length === 0 ? 0 : (txEntities.length / block.transactions.length * 100).toFixed(0);
			bar.update(count, { message: `${blockNumber}: ${txEntities.length} / ${block.transactions.length} (${nonTrivialPercent}%) non-trivial` });
		}
	}
	finally {
		bar.stop();
		console.log(`Fetched ${count - existingTxCount} transactions in ${formatDistanceToNow(startTime)}`);
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

	const etherscan = new Etherscan(etherscanApiKeys, argv.chain);
	async function parseRange(type: "start" | "end", value: string | undefined): Promise<number> {
		if (value?.match(/^\d+$/))
			return parseInt(value);
		if (value === undefined)
			return type === "start" ? 0 : Hex.toNumber(await etherscan.blockNumber());
		const date = Date.parse(value);
		if (isNaN(date))
			throw new Error(`Invalid date: ${value}`);
		const block = await etherscan.getBlockNumberByTimestamp(Math.floor(date / 1000), type === "start" ? "after" : "before");
		if (block === null && type === "end")
			throw new Error(`No block found for date: ${value}`);
		return block ?? 0;
	}

	const startBlock = await parseRange("start", argv.start);
	const endBlock = await parseRange("end", argv.end);
	if (endBlock < startBlock)
		throw new Error(`End block (${endBlock}) is before start block (${startBlock})`);
	if (argv.total > endBlock - startBlock + 1)
		throw new Error(`Total (${argv.total}) is greater than available blocks (${endBlock - startBlock + 1})`);

	await fetchTransactions(argv.chain, argv.total, [startBlock, endBlock], argv.provider);
	await database.close();
})();