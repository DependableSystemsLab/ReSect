import "basic-type-extensions";
import cliProgress from "cli-progress";
import { format as formatDate } from "date-fns/format";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "node:path";
import fs from "node:fs/promises";
import { Chain as ChainList } from "../src/config/Chain";
import { Block, CallTrace, Database, type Transaction } from "../src/database";
import { Hex } from "../src/utils";


const cliParser = yargs()
	.option("chain", {
		alias: "c",
		type: "number",
		demandOption: true,
		description: `Chain ID to export transactions. Supported: ${Object.entries(ChainList).map(([name, id]) => `${name} (${id})`).join(", ")}`
	})
	.option("outdir", {
		alias: "o",
		type: "string",
		demandOption: true,
		description: "Output directory to save transaction JSON files"
	})
	.help()
	.alias("help", "h");

(async () => {
	const { chain, outdir } = await cliParser.parseAsync(hideBin(process.argv));
	await fs.mkdir(outdir, { recursive: true });

	const db = Database.default;
	const traceRepo = await db.getRepository(CallTrace);
	const hashColumn = traceRepo.metadata.findColumnWithPropertyName("txHash")!;
	const cached = await traceRepo.createQueryBuilder("t")
		.select(`t."${hashColumn.databaseName}"`, "hash")
		.distinct(true)
		.getRawMany<{ hash: CallTrace["txHash"]; }>()
		.then(rows => new Set(rows.map(r => r.hash)));
	const txns = await db.getFpEvaluationTransactions(chain)
		.then(txns => txns.filter(txn => cached.has(txn.hash)) as Transaction.Full[]);
	const blockNumbers = new Set(txns.map(t => t.blockNumber));

	const blockRepo = await db.getRepository(Block);
	const blocks = await blockRepo.findBy({ chainId: chain })
		.then(blks => blks.filter(b => blockNumbers.has(b.number)) as Block.Full[]);
	const blockMap = new Map(blocks.map(b => [b.number, b]));

	console.log(`Exporting ${txns.length} transactions with traces on chain ${chain} to ${outdir}`);
	const bar = new cliProgress.SingleBar({
		format: `{bar} {percentage}% | Time: {duration_formatted} | {value}/{total} txs`,
		fps: 10,
		hideCursor: true,
		autopadding: true
	}, cliProgress.Presets.shades_classic);
	bar.start(txns.length, 0);
	for (const txn of txns) {
		const traces = await traceRepo.find({
			where: { txHash: txn.hash },
			order: { index: "ASC" }
		}) as CallTrace.Full[];
		const b = blockMap.get(txn.blockNumber!)!;
		const json = {
			hash: Hex.addPrefix(txn.hash),
			chain: txn.chainId,
			block: {
				number: b.number,
				hash: Hex.addPrefix(b.hash),
				parentHash: Hex.addPrefix(b.parentHash),
				timestamp: b.timestamp.toISOString(),
				gasLimit: b.gasLimit.toString(),
				gasUsed: b.gasUsed.toString(),
				baseFeePerGas: b.baseFeePerGas?.toString(),
				miner: Hex.addPrefix(b.miner),
				size: b.size
			},
			sender: Hex.addPrefix(txn.sender),
			receiver: txn.receiver ? Hex.addPrefix(txn.receiver) : null,
			traces: traces.map(t => ({
				index: t.index,
				depth: t.depth,
				levelIndex: t.levelIndex,
				from: Hex.addPrefix(t.from),
				to: t.to ? Hex.addPrefix(t.to) : null,
				type: t.type,
				value: t.value?.toString(),
				gas: t.gas?.toString(),
				gasUsed: t.gasUsed?.toString(),
				input: t.input?.toString("hex"),
				output: t.output?.toString("hex"),
				error: t.error,
				parentIndex: t.parentIndex
			}))
		};
		const dir = path.join(outdir, formatDate(b.timestamp, "yyyy-MM"));
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, `${txn.hash}.json`), JSON.stringify(json, null, "\t"), { encoding: "ascii" });
		bar.increment();
	}
	bar.stop();
	await db.close();
})();