import chalk from "chalk";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Chain } from "../src/config/Chain";
import { etherscanApiKey, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database, ReentrancyAttack, Transaction } from "../src/database";
import { type DebugTraceProvider, Etherscan, QuickNode, QuickNodeWithDb, Tenderly, TenderlyWithDb } from "../src/providers";
import { Reentrancy } from "../src/Reentrancy";


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

async function evaluate(
	txns: readonly Pick<Transaction.WithAttack, "hash" | "chain" | "attack">[],
	useDatabase: boolean = true,
	concurrancy: number = 1
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
	console.log(chalk.cyan`Running ${txns.length} tests...`);
	const width = txns.length.toString().length;
	const errors = {
		chainCompatibility(err) {
			if (!(err instanceof Error))
				return false;
			const msg = err.message;
			return msg.startsWith("Invalid chain ID:") || msg.startsWith("Invalid txhash:");
		},
		network(err) {
			if (err instanceof Response)
				return true;
			if (!(err instanceof Error))
				return false;
			return err.message === "fetch failed" || err instanceof AggregateError && err.errors.every(err => err.message === "fetch failed");
		},
	} satisfies Record<string, (err: any) => boolean>;
	const stats = {
		detected: 0,
		passed: 0,
		errors: { total: 0 } as Record<string, number>,
		mismatch: { total: 0 } as Record<string, number>
	};
	await txns.forEachAsync(async (txn, index) => {
		const idxStr = (index + 1).toString().padStart(width, " ");
		const log = (msg: string) => console.log(`[${idxStr}/${txns.length}] ${msg}`);

		log(chalk.cyan`Analyzing ${txn.attack.name} (0x${txn.hash} on ${txn.chain.name})`);
		const hash = `0x${txn.hash}` as const;
		const attack = txn.attack!;
		const analyzer = new Reentrancy.Analyzer(etherscan, debugProvider);

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
			log(chalk.red`Analysis Error: ${txn.attack.name}`);
			console.error(err);
			let errorMatched = false;
			if (err instanceof Error) {
				let key: keyof typeof errors;
				for (key in errors) {
					if (errors[key](err)) {
						stats.errors[key] ??= 0;
						++stats.errors[key];
						errorMatched = true;
						break;
					}
				}
			}
			if (!errorMatched) {
				stats.errors.other ??= 0;
				++stats.errors.other;
			}
			++stats.errors.total;
			return;
		}

		if (!detected) {
			log(chalk.yellow`No attack detected for ${txn.attack.name}`);
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
				equal = false;
				log(chalk.red`Expected ${key} to be ${expected[key]}, but got ${actual[key]}`);
				stats.mismatch[key] ??= 0;
				++stats.mismatch[key];
			}
		}
		if (!equal)
			++stats.mismatch.total;
		else {
			log(chalk.green`Test passed: ${txn.attack.name}`);
			++stats.passed;
		}
	}, txns, { maxConcurrency: concurrancy });

	console.log(chalk.white`\nEvaluation Summary:`);
	const logStats = (color: chalk.Chalk, label: string, count: number, total: number) =>
		console.log(color`${label}: ${count}/${total} (${(count / total * 100).toFixed(2)}%)`);
	logStats(chalk.cyan, `Detection`, stats.detected, txns.length - stats.errors.total);
	logStats(chalk.green, `Analysis`, stats.passed, stats.detected);
	let keys = Object.keys(stats.mismatch);
	if (keys.length > 1) {
		logStats(chalk.yellow, `Mismatches`, stats.mismatch.total, stats.detected);
		for (const key of keys) {
			if (key !== "total")
				logStats(chalk.yellow, `  ${key}`, stats.mismatch[key], stats.detected);
		}
	}
	keys = Object.keys(stats.errors);
	if (keys.length > 1) {
		logStats(chalk.red, `Errors`, stats.errors.total, txns.length);
		for (const key of keys) {
			if (key !== "total")
				logStats(chalk.red, `  ${key}`, stats.errors[key], txns.length);
		}
	}
}

const cliParser = yargs()
	.option("collection", {
		alias: "c",
		type: "string",
		default: "first",
		description: "Collection of transactions to evaluate ('first' or 'all')",
		coerce(value: string) {
			value = value.toLowerCase();
			if (value !== "first" && value !== "all")
				throw new Error("Invalid collection. Use 'first' or 'all'.");
			return value;
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
	const argv = await cliParser.parseAsync(hideBin(process.argv));
	const txns = await Database.default.getAttackTransactions(undefined, Transaction.Action.Exploit);
	let collection: Transaction.WithAttack[];
	if (argv.collection === "all")
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
	await evaluate(collection, argv.database, argv.concurrency);
})();