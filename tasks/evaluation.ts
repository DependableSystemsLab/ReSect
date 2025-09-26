import chalk from "chalk";
import cliProgress from "cli-progress";
import { QueryFailedError } from "typeorm";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import readline from "node:readline";
import { Chain } from "../src/config/Chain";
import { etherscanApiKeys, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database, ReentrancyAttack, Transaction } from "../src/database";
import { type DebugTraceProvider, Etherscan, QuickNode, Tenderly } from "../src/providers";
import { Analyzer, Scope, TraceNotFoundError, type AnalysisResult } from "../src/core";
import type { Hex } from "../src/utils";


type Promisable<T> = T | Promise<T>;

function convertScope(scope: ReentrancyAttack.Scope): Scope {
	switch (scope) {
		case ReentrancyAttack.Scope.SingleFunction:
			return Scope.SingleFunction;
		case ReentrancyAttack.Scope.CrossFunction:
			return Scope.CrossFunction;
		case ReentrancyAttack.Scope.CrossContract:
		case ReentrancyAttack.Scope.CrossProject:
		case ReentrancyAttack.Scope.CrossChain:
			return Scope.CrossContract;
		default:
			throw new Error(`Unknown scope: ${scope}`);
	}
}

const errorCheckers: Record<string, (err: any) => boolean | Promisable<string | Error>> = {
	chainCompatibility(err) {
		if (!(err instanceof Error))
			return false;
		const msg = err.message;
		return msg.startsWith("Invalid chain ID:") || msg.startsWith("Invalid txhash:");
	},
	notFound(err) {
		return err instanceof TraceNotFoundError;
	},
	network(err) {
		if (err instanceof Response)
			return err.bodyUsed ? true : err.clone().text().then(text => `${err.status}: ${text}`);
		if (!(err instanceof Error))
			return false;
		return err.message === "fetch failed";
	},
	database(err) {
		if (!(err instanceof QueryFailedError))
			return false;
		delete (err as any).parameters;
		delete (err as any).driverError;
		return err;
	}
};

function* flattenError(err: any): Generator<any> {
	if (!(err instanceof AggregateError))
		yield err;
	else {
		for (const inner of err.errors)
			yield* flattenError(inner);
	}
}

async function handleError(error: any, stats: Record<string, number>) {
	let matched = false;
	let key: keyof typeof errorCheckers;
	let message = error;
	for (key in errorCheckers) {
		const func = errorCheckers[key];
		let match = true;
		const errors = Array.from(flattenError(error));
		const results = new Array<ReturnType<typeof func>>();
		for (const e of errors) {
			const r = func(e);
			if (r === false) {
				match = false;
				break;
			}
			results.push(r);
		}
		if (match) {
			stats[key] ??= 0;
			++stats[key];
			matched = true;
			const messages = [];
			for (let i = 0; i < results.length; ++i) {
				let result = results[i];
				if (result instanceof Promise)
					result = await result;
				messages.push(typeof result === "boolean" ? errors[i] : result);
			}
			message = messages.length === 1 ? messages[0] : messages;
			break;
		}
	}
	if (!matched) {
		stats.other ??= 0;
		++stats.other;
	}
	++stats.total;
	console.log(message);
}

type FnTx = Pick<Transaction.WithAttack, "hash" | "chain" | "attack">;
type FpTx = Transaction.WithRelations<"chain">;

async function evaluate(type: "fn", txns: readonly FnTx[], useDatabase?: boolean, concurrancy?: number): Promise<void>;
async function evaluate(type: "fp", txns: readonly FpTx[], useDatabase?: boolean, concurrancy?: number): Promise<void>;
async function evaluate(
	type: "fn" | "fp",
	txns: readonly FnTx[] | readonly FpTx[],
	useDatabase: boolean = true,
	concurrency: number = 1
) {
	const database = Database.default;
	const txRepo = await database.getRepository(Transaction);
	const etherscan = new Etherscan(etherscanApiKeys, Chain.Ethereum, useDatabase ? database : undefined);
	const debugProvider: DebugTraceProvider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, undefined, useDatabase ? database : undefined)
		: new Tenderly(tenderlyNodeAccessKeys, undefined, useDatabase ? database : undefined);

	const stats = {
		detected: 0,
		passed: 0,
		mismatch: { total: 0 } as Record<string, number>,
		positive: new Array<{ hash: Hex.TxHash, result: AnalysisResult; }>(),
		errors: { total: 0 } as Record<string, number>,
	};
	const bar = new cliProgress.SingleBar({
		format: `{bar} {percentage}% | Time: {duration_formatted} | {value}/{total} txs | {speed} txs/s | {message}`,
		fps: 5,
		hideCursor: true,
		autopadding: true
	}, cliProgress.Presets.shades_classic);
	const width = Math.floor(Math.log10(txns.length)) + 1;
	const log = (msg: string, index?: number, resetCursor = true) => {
		if (resetCursor) {
			readline.clearLine(process.stdout, 0);
			readline.cursorTo(process.stdout, 0);
		}
		console.log(index === undefined ? msg : chalk.grey`[${(index + 1).toString().padStart(width, " ")} / ${txns.length}] ` + msg);
	};

	const fnTest = async (txn: FnTx, index: number) => {
		const analyzer = new Analyzer(etherscan, debugProvider);
		const hash = `0x${txn.hash}` as const;
		const attack = txn.attack!;

		const txInfo = `${attack.name} (${hash} on ${txn.chain.name})`;
		bar.update({ message: txInfo });

		let detected = false;
		let scope = Scope.CrossContract;
		let readonly = false;
		const entranceTypes = new Set<ReentrancyAttack.EntryPoint>();

		try {
			for await (const result of analyzer.analyze(hash, txn.chain.id)) {
				detected = true;
				scope = Math.min(scope, result.scope);
				if (result.readonly === true)
					readonly = true;
				result.entrances.forEach(e => entranceTypes.add(e.type));
			}
		}
		catch (err) {
			log(chalk.red`Analysis Error: ${txInfo}`, index);
			await handleError(err, stats.errors);
			return;
		}

		if (!detected) {
			log(chalk.yellow`No attack detected for ${txInfo}`, index);
			return;
		}
		++stats.detected;
		const expected: Record<string, any> = {};
		const actual: Record<string, any> = {};
		if (attack.scope != null) {
			expected.scope = convertScope(attack.scope);
			actual.scope = scope;
		}
		if (attack.entryPoint != null) {
			expected.entryPoint = attack.entryPoint;
			const types = Array.from(entranceTypes);
			actual.entryPoint = types.includes(expected.entryPoint) ? expected.entryPoint : types;
		}
		let equal = true;
		for (const key in expected) {
			if (actual[key] !== expected[key]) {
				if (equal) {
					log(chalk.yellow`Mismatched analysis for ${txInfo}:`, index);
					equal = false;
				}
				console.log(chalk.yellow`  Expected ${key} to be ${expected[key]}, but got ${actual[key]}`);
				stats.mismatch[key] ??= 0;
				++stats.mismatch[key];
			}
		}
		if (!equal)
			++stats.mismatch.total;
		else
			++stats.passed;
	};

	const fpTest = async (txn: FpTx, index: number) => {
		const analyzer = new Analyzer(etherscan, debugProvider);
		const hash = `0x${txn.hash}` as const;

		let result: AnalysisResult | undefined;
		try {
			for await (result of analyzer.analyze(hash, txn.chain.id))
				break;
		}
		catch (err) {
			log(chalk.red`Analysis Error: ${hash}`, index);
			await handleError(err, stats.errors);
			return;
		}

		const tags = txn.tags ?? 0;
		txn.setTags(Transaction.Tags.Reentrancy, result !== undefined);
		if (txn.tags !== tags) {
			await txRepo.update(txn.hash, { tags: txn.tags })
				.catch(err => {
					log(chalk.red`Failed to update tags for ${hash}`, index);
					console.log(err);
				});
		}

		if (result) {
			stats.positive.push({ hash, result });
			log(chalk.yellow`Positive detected: ${hash}`, index);
			log(result.toString());
			bar.update({ message: `Reentrancy: ${stats.positive.length}` });
		}
	};

	bar.start(txns.length, 0);
	const startTime = Date.now();
	let completed = 0;
	const finalize = () => {
		++completed;
		bar.update(completed, { speed: (completed / ((Date.now() - startTime) / 1000)).toFixed(1) });
	};
	process.on("SIGINT", () => {
		bar.stop();
		printResult();
		process.exit(0);
	});
	await txns.forEachAsync(
		type === "fn"
			? (txn, idx) => fnTest(txn as FnTx, idx).finally(finalize)
			: (txn, idx) => fpTest(txn as FpTx, idx).finally(finalize),
		txns,
		{ maxConcurrency: concurrency }
	);
	const endTime = Date.now();
	bar.stop();

	function printResult(timestamp: number = Date.now()) {
		log(chalk.white`Evaluated ${completed} transactions in ${((timestamp - startTime) / 1000).toFixed(1)}s`);
		log(chalk.white`Evaluation Summary:`);
		const logStats = (color: chalk.Chalk, label: string, count: number, total: number) =>
			log(color`${label}: ${count}/${total} (${(count / total * 100).toFixed(2)}%)`);
		if (type === "fp") {
			const total = completed - stats.errors.total;
			const positive = stats.positive.length;
			logStats(chalk.green, "Negatives", total - positive, total);
			if (positive > 0) {
				logStats(chalk.yellow, "Positives", positive, total);
				const scopeCount = new Map<Scope, number>();
				const entryPointCount = new Map<ReentrancyAttack.EntryPoint, number>();
				for (const { result } of stats.positive) {
					scopeCount.set(result.scope, (scopeCount.get(result.scope) ?? 0) + 1);
					new Set(result.entrances).forEach(e => {
						entryPointCount.set(e.type, (entryPointCount.get(e.type) ?? 0) + 1);
					});
				}
				for (const [scope, count] of scopeCount)
					logStats(chalk.yellow, `  Scope ${Scope[scope]}`, count, positive);
				for (const [entryPoint, count] of entryPointCount)
					logStats(chalk.yellow, `  EntryPoint ${entryPoint}`, count, positive);
			}
		}
		else {
			logStats(chalk.cyan, `Detection`, stats.detected, completed - stats.errors.total);
			logStats(chalk.green, `Analysis`, stats.passed, stats.detected);
			const keys = Object.keys(stats.mismatch);
			if (keys.length > 1) {
				logStats(chalk.yellow, `Mismatches`, stats.mismatch.total, stats.detected);
				for (const key of keys) {
					if (key !== "total")
						logStats(chalk.yellow, `  ${key}`, stats.mismatch[key], stats.detected);
				}
			}
		}
		const keys = Object.keys(stats.errors);
		if (keys.length > 1) {
			logStats(chalk.red, `Errors`, stats.errors.total, completed);
			for (const key of keys) {
				if (key !== "total")
					logStats(chalk.red, `  ${key}`, stats.errors[key], completed);
			}
		}
	}
	printResult(endTime);
}

const cliParser = yargs()
	.option("type", {
		alias: "t",
		type: "string",
		choices: ["fn", "fp"] as const,
		default: "fn" as const,
		description: "Type of evaluation ('fn' for false negatives, 'fp' for false positives)"
	})
	.option("chain", {
		alias: "c",
		type: "string",
		description: "Blockchain network. Can be either chain name or chain ID",
		coerce(value: string) {
			if (/^\d+$/.test(value))
				return Number.parseInt(value);
			if (!(value in Chain))
				throw new Error(`Unknown chain: ${value}`);
			return Chain[value as keyof typeof Chain];
		}
	})
	.option("size", {
		type: "string",
		default: "all",
		description: "Number of transactions to evaluate. Use 'all' for all transactions, or 'first' in case of false negatives to use only the first transaction of each attack",
		coerce(value: string) {
			if (value === "all" || value === "first")
				return value;
			const n = Number.parseInt(value);
			if (!Number.isSafeInteger(n))
				throw new Error(`Invalid size: ${value}`);
			return n;
		}
	})
	.option("skip", {
		type: "number",
		default: 0,
		description: "Number of transactions to skip. This option is only relevant for false negative evaluation, where transactions are ordered by block number"
	})
	.option("concurrency", {
		type: "number",
		default: 1,
		description: "Number of concurrent tests to run"
	})
	.option("database", {
		alias: "d",
		type: "boolean",
		default: true,
		description: "Use database for analysis"
	})
	.help()
	.alias("help", "h");

(async () => {
	const { type, chain: chainId, size, ...argv } = await cliParser.parseAsync(hideBin(process.argv));
	if (type === "fn") {
		const txns = await Database.default.getAttackTransactions(undefined, Transaction.Tags.Exploit);
		let collection: Transaction.WithAttack[];
		if (size === "all")
			collection = txns;
		else {
			const attackTxns = new Map<number, typeof txns[0]>();
			for (const txn of txns) {
				if (txn.attackId == null)
					continue;
				const existing = attackTxns.get(txn.attackId);
				if (!existing || existing.timestamp == null || txn.timestamp && txn.timestamp < existing.timestamp)
					attackTxns.set(txn.attackId, txn);
			}
			collection = Array.from(attackTxns.values());
		}
		if (chainId !== undefined)
			collection = collection.filter(tx => tx.chainId === chainId);
		await evaluate("fn", collection, argv.database, argv.concurrency);
	}
	else {
		if (size === "first")
			throw new Error(`Option --size=first is not valid for false positive evaluation`);
		const collection = await Database.default.getFpEvaluationTransactions(chainId, size === "all" ? undefined : size, argv.skip);
		await evaluate("fp", collection, argv.database, argv.concurrency);
	}
	process.exit(0);
})();