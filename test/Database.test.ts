import "basic-type-extensions";
import { DataSource, IsNull } from "typeorm";
import { etherscanApiKey } from "../src/config/credentials";
import { typeormConfig } from "../src/config/typeorm";
import { JsonRpcConverter } from "../src/converters";
import { Block, Chain, Database, Transaction } from "../src/database";
import { Etherscan } from "../src/providers";
import { Hex } from "../src/utils";

describe("Database", () => {
	test("Schema", async () => {
		const source = new DataSource({
			...typeormConfig,
			database: "reentrancy-attack-test",
			synchronize: false,
			logging: true
		});
		await source.initialize();
		await source.synchronize(true);
	});

	test("Fetch Blocks", async () => {
		const database = new Database({
			...typeormConfig,
			logging: ["warn", "error"]
		});
		const repo = await database.getRepository(Transaction);
		const txs = await repo.find({ where: { blockNumber: IsNull() } });
		console.log(`Found ${txs.length} transactions without block number`);

		const chains = await (await database.getRepository(Chain)).find({ select: ["id"] });
		const base = BigInt(Math.max(...chains.map(c => c.id)) + 1);

		const etherscan = new Etherscan(etherscanApiKey);
		const blockNumbers = new Set<bigint>();

		const handleError = async (error: any) => {
			if (error instanceof Response)
				error = await error.json();
			console.error(error);
		}

		await txs.forEachAsync(async (tx, idx) => {
			const transaction = await etherscan.geth
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
			const blockData = await etherscan.geth
				.getBlockByNumber(Hex.toString(block.number), false, block.chainId)
				.catch(handleError);
			if (blockData == null)
				return undefined;
			console.log(`Fetched block ${idx + 1}/${newBlocks.length}: ${blockData.hash}`);
			return JsonRpcConverter.blockToEntity(blockData, block.chainId);
		});

		await blockRepo.save(blocks.filter(b => b != null));
		await repo.save(txs);
	}, 1000 * 60 * 60 * 24);
});