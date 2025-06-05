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
		} catch (err) {
			log(chalk.red`Analysis Error: ${txn.attack.name}`);
			console.error(err);
			return;
		}

		if (detected)
			log(chalk.green`Analysis Complete: ${txn.attack.name}`);
		else
			log(chalk.yellow`Analysis Failed: ${txn.attack.name}`);

		const expected: Record<string, any> = { detected: true };
		const actual: Record<string, any> = { detected };
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
			}
		}
		if (equal)
			log(chalk.green`Test passed: ${txn.attack.name}`);
	}, txns, { maxConcurrency: concurrancy });
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