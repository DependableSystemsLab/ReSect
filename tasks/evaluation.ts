import chalk from "chalk";
import cliProgress from "cli-progress";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import readline from "node:readline";
import { Chain } from "../src/config/Chain";
import { etherscanApiKey, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database, ReentrancyAttack, Transaction } from "../src/database";
import { type DebugTraceProvider, Etherscan, QuickNode, QuickNodeWithDb, Tenderly, TenderlyWithDb } from "../src/providers";
import { Reentrancy } from "../src/Reentrancy";
import type { Hex } from "../src/utils";


function convertEntranceType(ep: ReentrancyAttack.EntryPoint): Reentrancy.EntranceType {
	switch (ep) {
		case ReentrancyAttack.EntryPoint.Fallback:
			return Reentrancy.EntranceType.Fallback;
		case ReentrancyAttack.EntryPoint.MaliciousToken:
			return Reentrancy.EntranceType.MaliciousToken;
		case ReentrancyAttack.EntryPoint.ERCHook:
			return Reentrancy.EntranceType.ERCHook;
		case ReentrancyAttack.EntryPoint.ApplicationHook:
			return Reentrancy.EntranceType.Other;
		default:
			throw new Error(`Unknown entry point: ${ep}`);
	}
}

function convertScope(scope: ReentrancyAttack.Scope): Reentrancy.Scope {
	switch (scope) {
		case ReentrancyAttack.Scope.SingleFunction:
			return Reentrancy.Scope.SingleFunction;
		case ReentrancyAttack.Scope.CrossFunction:
			return Reentrancy.Scope.CrossFunction;
		case ReentrancyAttack.Scope.CrossContract:
		case ReentrancyAttack.Scope.CrossProject:
		case ReentrancyAttack.Scope.CrossChain:
			return Reentrancy.Scope.CrossContract;
		default:
			throw new Error(`Unknown scope: ${scope}`);
	}
}

const errors = {
	chainCompatibility(err) {
		if (!(err instanceof Error))
			return false;
		const msg = err.message;
		return msg.startsWith("Invalid chain ID:") || msg.startsWith("Invalid txhash:");
	},
	notFound(err) {
		if (err instanceof Reentrancy.TraceNotFoundError)
			return true;
		if (err instanceof AggregateError)
			return err.errors.every(err => err instanceof Reentrancy.TraceNotFoundError);
		return false;
	},
	network(err) {
		if (err instanceof Response)
			return true;
		if (!(err instanceof Error))
			return false;
		return err.message === "fetch failed" || err instanceof AggregateError && err.errors.every(err => err.message === "fetch failed");
	},
} satisfies Record<string, (err: any) => boolean>;

function handleError(err: any, errStats: Record<string, number>) {
	let errorMatched = false;
	let key: keyof typeof errors;
	for (key in errors) {
		if (errors[key](err)) {
			errStats[key] ??= 0;
			++errStats[key];
			errorMatched = true;
			break;
		}
	}
	if (!errorMatched) {
		errStats.other ??= 0;
		++errStats.other;
	}
	++errStats.total;
}

type FnTx = Pick<Transaction.WithAttack, "hash" | "chain" | "attack">;
type FpTx = Pick<Transaction.WithRelations<"chain">, "hash" | "chain">;

async function evaluate(type: "fn", txns: readonly FnTx[], useDatabase?: boolean, concurrancy?: number): Promise<void>;
async function evaluate(type: "fp", txns: readonly FpTx[], useDatabase?: boolean, concurrancy?: number): Promise<void>;
async function evaluate(
	type: "fn" | "fp",
	txns: readonly FnTx[] | readonly FpTx[],
	useDatabase: boolean = true,
	concurrency: number = 1
) {
	const database = Database.default;
	const etherscan = new Etherscan(etherscanApiKey, Chain.Ethereum, useDatabase ? database : undefined);
	const debugProvider: DebugTraceProvider = quickNodeApiKey
		? useDatabase
			? new QuickNodeWithDb(quickNodeApiKey, undefined, database)
			: new QuickNode(quickNodeApiKey)
		: useDatabase
			? new TenderlyWithDb(tenderlyNodeAccessKeys, undefined, etherscan.geth, database)
			: new Tenderly(tenderlyNodeAccessKeys);
	const analyzer = new Reentrancy.Analyzer(etherscan, debugProvider);

	const stats = {
		detected: 0,
		passed: 0,
		mismatch: { total: 0 } as Record<string, number>,
		positive: [] as Hex.TxHash[],
		errors: { total: 0 } as Record<string, number>,
	};
	const bar = new cliProgress.SingleBar({
		format: `{bar} {percentage}% | ETA: {eta_formatted} | {value}/{total} txs | {message}`,
		fps: 5,
		etaBuffer: Math.max(20, Math.floor(10 * Math.log10(txns.length))),
		hideCursor: true,
		autopadding: true,
		clearOnComplete: true
	}, cliProgress.Presets.shades_classic);
	const log = (...args: any[]) => {
		readline.clearLine(process.stdout, 0);
		readline.cursorTo(process.stdout, 0);
		console.log(...args);
	};

	const fnTest = async (txn: FnTx) => {
		const hash = `0x${txn.hash}` as const;
		const attack = txn.attack!;

		const txInfo = `${attack.name} (${hash} on ${txn.chain.name})`;
		bar.update({ message: txInfo });

		let detected = false;
		let scope = Reentrancy.Scope.CrossContract;
		let readonly = false;
		const entranceTypes = new Set<Reentrancy.EntranceType>();

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
			log(chalk.red`Analysis Error: ${txInfo}`);
			console.error(err);
			handleError(err, stats.errors);
			return;
		}

		if (!detected) {
			log(chalk.yellow`No attack detected for ${txInfo}`);
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
			expected.entryPoint = convertEntranceType(attack.entryPoint);
			const types = Array.from(entranceTypes);
			actual.entryPoint = types.includes(expected.entryPoint) ? expected.entryPoint : types;
		}
		let equal = true;
		for (const key in expected) {
			if (actual[key] !== expected[key]) {
				if (equal) {
					log(chalk.yellow`Mismatched analysis for ${txInfo}:`);
					equal = false;
				}
				log(chalk.yellow`  Expected ${key} to be ${expected[key]}, but got ${actual[key]}`);
				stats.mismatch[key] ??= 0;
				++stats.mismatch[key];
			}
		}
		if (!equal)
			++stats.mismatch.total;
		else
			++stats.passed;
	};

	const fpTest = async (txn: FpTx) => {
		const hash = `0x${txn.hash}` as const;
		bar.update({ message: chalk.cyan`${hash} (${txn.chain.name})` });

		let result: Reentrancy.AnalysisResult | undefined;
		try {
			for await (result of analyzer.analyze(hash, txn.chain.id))
				break;
		}
		catch (err) {
			log(chalk.red`Analysis Error: ${hash}`);
			console.error(err);
			handleError(err, stats.errors);
			return;
		}

		if (result) {
			stats.positive.push(hash);
			log(chalk.yellow`Positive detected: ${hash}`);
			console.log(result.toString());
		}
	};

	bar.start(txns.length, 0, { message: chalk.cyan`Running ${txns.length} tests...` });
	await txns.forEachAsync(
		type === "fn"
			? txn => fnTest(txn as FnTx).finally(() => bar.increment())
			: txn => fpTest(txn as FpTx).finally(() => bar.increment()),
		txns,
		{ maxConcurrency: concurrency }
	);
	await Promise.sleep(100); // wait for the last bar update to finish
	bar.stop();

	console.log(chalk.white`\nEvaluation Summary:`);
	const logStats = (color: chalk.Chalk, label: string, count: number, total: number) =>
		console.log(color`${label}: ${count}/${total} (${(count / total * 100).toFixed(2)}%)`);
	if (type === "fp") {
		const total = txns.length - stats.errors.total;
		logStats(chalk.green, "Negatives", total - stats.positive.length, total);
		if (stats.positive.length > 0) {
			logStats(chalk.yellow, "Positives", stats.positive.length, total);
			for (const hash of stats.positive)
				console.log(chalk.yellow`  ${hash}`);
		}
	}
	else {
		logStats(chalk.cyan, `Detection`, stats.detected, txns.length - stats.errors.total);
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
		logStats(chalk.red, `Errors`, stats.errors.total, txns.length);
		for (const key of keys) {
			if (key !== "total")
				logStats(chalk.red, `  ${key}`, stats.errors[key], txns.length);
		}
	}
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
		const collection = await Database.default.getFpEvaluationTransactions(chainId, size === "all" ? undefined : size);
		await evaluate("fp", collection, argv.database, argv.concurrency);
	}
})();