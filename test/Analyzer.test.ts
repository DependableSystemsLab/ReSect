import inspector from "node:inspector";
import { Chain, type ChainName } from "../src/config/Chain";
import { etherscanApiKey, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database } from "../src/database";
import { Etherscan, QuickNode, QuickNodeWithDb, Tenderly, TenderlyWithDb, type DebugTraceProvider } from "../src/providers";
import { Reentrancy } from "../src/Reentrancy";
import type { Hex } from "../src/utils";

interface TestCaseBase {
	name: string;
	chain: ChainName;
	txHash: Hex.String;
	useDatabase?: boolean;
	skip?: boolean;
}

interface PositiveTestCase extends TestCaseBase {
	isReentrancy: true;
	scope?: Reentrancy.Scope;
	entranceType?: Reentrancy.EntranceType;
	readonly?: boolean;
}

interface NegativeTestCase extends TestCaseBase {
	isReentrancy: false;
}

type TestCase = PositiveTestCase | NegativeTestCase;

const cases: TestCase[] = [];

describe("Reentrancy Analyzer", () => {
	const debug = inspector.url() !== undefined;
	const timeout = debug ? 24 * 60 * 60_000 : 30_000;

	const etherscan = new Etherscan(etherscanApiKey, Chain.Ethereum);
	const debugProvider: DebugTraceProvider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, "Ethereum")
		: new Tenderly(tenderlyNodeAccessKeys, "Ethereum");

	const etherscanWithDb = new Etherscan(etherscanApiKey, Chain.Ethereum, Database.default);
	const debugProviderWithDb: DebugTraceProvider = quickNodeApiKey
		? new QuickNodeWithDb(quickNodeApiKey, "Ethereum")
		: new TenderlyWithDb(tenderlyNodeAccessKeys, "Ethereum", etherscanWithDb.geth);

	async function testOnCase(testCase: Readonly<TestCase>) {
		const { chain, txHash } = testCase;
		const chainId = Chain[chain];
		const analyzer = testCase.useDatabase === false
			? new Reentrancy.Analyzer(etherscan, debugProvider)
			: new Reentrancy.Analyzer(etherscanWithDb, debugProviderWithDb);
		let detected = false;
		let scope = Reentrancy.Scope.CrossContract;
		let readonly = false;
		const entranceTypes = new Set<Reentrancy.EntranceType>();
		for await (const result of analyzer.analyze(txHash, chainId)) {
			detected = true;
			if (!testCase.isReentrancy)
				fail(`Expected no reentrancy, but got ${result.reStack}`);
			else {
				console.log(`Analysis result for ${testCase.name}:`);
				console.log(result.toString());
				scope = Math.min(scope, result.scope);
				if (result.readonly === true)
					readonly = true;
				result.entrances.forEach(e => entranceTypes.add(e.type));
			}
		}
		expect(detected).toBe(testCase.isReentrancy);
		if (testCase.isReentrancy) {
			if (testCase.scope !== undefined)
				expect(scope).toBe(testCase.scope);
			if (testCase.readonly !== undefined)
				expect(readonly).toBe(testCase.readonly);
			if (testCase.entranceType !== undefined)
				expect(Array.from(entranceTypes)).toContain(testCase.entranceType);
		}
	}

	cases.forEach(testCase => {
		const it = testCase.skip ? test.skip : test;
		it(testCase.name, () => testOnCase(testCase), timeout);
	});
});