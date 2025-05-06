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

	for (const testCase of cases) {
		const it = testCase.skip ? test.skip : test;
		it(`${testCase.name} on ${testCase.chain}`, async () => {
			const { chain, txHash } = testCase;
			const chainId = Chain[chain];
			const analyzer = testCase.useDatabase === false
				? new Reentrancy.Analyzer(etherscan, debugProvider)
				: new Reentrancy.Analyzer(etherscanWithDb, debugProviderWithDb);
			let detected = false;
			for await (const result of analyzer.analyze(txHash, chainId)) {
				detected = true;
				if (!testCase.isReentrancy)
					fail(`Expected no reentrancy, but got ${result.stack}`);
				else {
					if (testCase.scope)
						expect(result.scope).toBe(testCase.scope);
					console.log(Reentrancy.Analyzer.toString(result));
				}
			}
			expect(detected).toBe(testCase.isReentrancy);
		}, timeout);
	}
});