import { Chain, type ChainName } from "../src/config/Chain";
import { etherscanApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Etherscan, TenderlyWithDb, type DebugTraceProvider } from "../src/providers";
import { Reentrancy } from "../src/Reentrancy";

interface TestCaseBase {
	name: string;
	chain: ChainName;
	txHash: string;
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
	const debugProviders = new Map<ChainName, DebugTraceProvider>();

	for (const testCase of cases) {
		const it = testCase.skip ? test.skip : test;
		it(`${testCase.name} on ${testCase.chain}`, async () => {
			const { chain, txHash } = testCase;
			const etherscan = new Etherscan(etherscanApiKey, Chain[chain]);
			let provider = debugProviders.get(chain);
			if (!provider) {
				if (!(chain in tenderlyNodeAccessKeys))
					throw new Error(`No Tenderly access key for ${chain}`);
				const key = tenderlyNodeAccessKeys[chain];
				provider = new TenderlyWithDb(chain, key, etherscan.geth);
				debugProviders.set(chain, provider);
			}
			const analyzer = new Reentrancy.Analyzer(chain, etherscan, provider);
			let detected = false;
			for await (const result of analyzer.analyze(txHash)) {
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
		}, 30_000);
	}
});