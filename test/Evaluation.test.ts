import chalk from "chalk";
import { plainToInstance } from "class-transformer";
import { log } from "node:console";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Chain } from "../src/config/Chain";
import { etherscanApiKey, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database, ReentrancyAttack, Transaction } from "../src/database";
import { Etherscan, QuickNodeWithDb, TenderlyWithDb, type DebugTraceProvider } from "../src/providers";
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

describe("Dataset Evaluation", () => {
	const database = Database.default;
	const etherscanWithDb = new Etherscan(etherscanApiKey, Chain.Ethereum, database);
	const debugProviderWithDb: DebugTraceProvider = quickNodeApiKey
		? new QuickNodeWithDb(quickNodeApiKey, "Ethereum", database)
		: new TenderlyWithDb(tenderlyNodeAccessKeys, "Ethereum", etherscanWithDb.geth, database);

	let described = false;
	type OnlyFunc<T> = T extends (...args: infer P) => infer R ? (...args: P) => R : never;
	const describeOnce: OnlyFunc<jest.Describe> = (name, fn) =>
		globalThis.describe(name, () => {
			if (described)
				return;
			described = true;
			fn();
		});
	const describe: jest.Describe = Object.assign(describeOnce, {
		only: globalThis.describe.only,
		skip: globalThis.describe.skip,
		each: globalThis.describe.each
	});

	function runTests(txns: readonly Pick<Transaction.WithAttack, "hash" | "chain" | "attack">[]) {
		if (txns.length === 0)
			return;
		log(chalk.cyan(`Running ${txns.length} tests...`));
		const testCases = txns.map((txn, index) => ({
			txn,
			index,
			desc: `${txn.attack.name}: 0x${txn.hash} on ${txn.chain.name}`
		}));
		test.each(testCases)("$#. $desc", async ({ txn, index }) => {
			log(chalk.cyan`[${index + 1}/${testCases.length}] Analyzing ${txn.attack.name} (0x${txn.hash} on ${txn.chain.name})`);

			const hash = `0x${txn.hash}` as const;
			const attack = txn.attack!;
			const analyzer = new Reentrancy.Analyzer(etherscanWithDb, debugProviderWithDb);

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
			} catch (error) {
				log(chalk.red`[${index + 1}/${testCases.length}] Analysis Error: ${txn.attack.name}`);
				fail(`Error: ${error}`);
			}

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
			expect(actual).toEqual(expected);

			afterAll(() => {
				if (detected)
					log(chalk.green`[${index + 1}/${testCases.length}] Analysis Complete: ${txn.attack.name}`);
				else
					log(chalk.yellow`[${index + 1}/${testCases.length}] Analysis Failed: ${txn.attack.name}`);
			});
		}, 5 * 60_000);
	}

	function loadTransactions(): Transaction.WithAttack[] | null {
		const dataFile = join(__dirname, "..", "data", "exploit-transactions.json");
		if (!existsSync(dataFile))
			return null;
		const json = readFileSync(dataFile, "utf-8");
		const object = JSON.parse(json);
		if (!Array.isArray(object))
			throw new Error("Invalid data file");
		return plainToInstance(Transaction, object, { enableImplicitConversion: true }) as Transaction.WithAttack[];
	}

	describe("First Exploit Transactions", () => {
		const txns = loadTransactions();
		if (txns == null)
			return;
		const attackTxns = new Map<number, typeof txns[0]>();
		for (const txn of txns) {
			if (txn.attackId == null)
				continue;
			const existing = attackTxns.get(txn.attackId);
			if (!existing || existing.timestamp == null || txn.timestamp && txn.timestamp < existing.timestamp)
				attackTxns.set(txn.attackId, txn);
		}
		runTests(Array.from(attackTxns.values()));
	});

	describe("All Exploit Transactions", () => {
		const txns = loadTransactions();
		if (txns == null)
			return;
		runTests(txns);
	});
});