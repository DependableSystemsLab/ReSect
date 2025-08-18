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

describe("Reentrancy Analyzer", () => {
	const debug = inspector.url() !== undefined;
	const timeout = debug ? 24 * 60 * 60_000 : 30_000;
	jest.setTimeout(timeout);

	const etherscan = new Etherscan(etherscanApiKey, Chain.Ethereum);
	const debugProvider: DebugTraceProvider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, "Ethereum")
		: new Tenderly(tenderlyNodeAccessKeys, "Ethereum");

	const etherscanWithDb = new Etherscan(etherscanApiKey, Chain.Ethereum, Database.default);
	const debugProviderWithDb: DebugTraceProvider = quickNodeApiKey
		? new QuickNodeWithDb(quickNodeApiKey, "Ethereum")
		: new TenderlyWithDb(tenderlyNodeAccessKeys, "Ethereum", etherscanWithDb.geth);

	const testOnCase = (testCase: Readonly<TestCase>) => async () => {
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
	};

	test("Multi-Entrance", testOnCase({
		isReentrancy: true,
		name: "ChainPaint",
		chain: "Ethereum",
		txHash: "0x0eb8f8d148508e752d9643ccf49ac4cb0c21cbad346b5bbcf2d06974d31bd5c4",
		scope: Reentrancy.Scope.SingleFunction,
		entranceType: Reentrancy.EntranceType.Fallback,
		readonly: false
	}));

	test("Proxy Contract", testOnCase({
		isReentrancy: true,
		name: "Predy Finance",
		chain: "ArbitrumOne",
		txHash: "0xbe163f651d23f0c9e4d4a443c0cc163134a31a1c2761b60188adcfd33178f50f",
		scope: Reentrancy.Scope.CrossFunction,
		entranceType: Reentrancy.EntranceType.Other,
		readonly: false
	}));

	test("Scope: Cross Function", testOnCase({
		isReentrancy: true,
		name: "TrustSwap",
		chain: "Ethereum",
		txHash: "0x83952d998cc562f40d0a58b76d563a16f3064ddb116e7b1b4e40298ca80499b8",
		scope: Reentrancy.Scope.CrossFunction,
		entranceType: Reentrancy.EntranceType.MaliciousToken,
		readonly: false
	}));

	test("Scope: Cross Contract", testOnCase({
		isReentrancy: true,
		name: "GoodDollar",
		chain: "Ethereum",
		txHash: "0x726459a46839c915ee2fb3d8de7f986e3c7391c605b7a622112161a84c7384d0",
		scope: Reentrancy.Scope.CrossContract,
		entranceType: Reentrancy.EntranceType.Other,
		readonly: false
	}));

	test("Entrance Type: Malicious Token", testOnCase({
		isReentrancy: true,
		name: "GemPad",
		chain: "Ethereum",
		txHash: "0x9ceb4698eb09e93d232e10557c3932e1e74b5d8e78170b5034512aa0a8135970",
		scope: Reentrancy.Scope.CrossFunction,
		entranceType: Reentrancy.EntranceType.MaliciousToken,
		readonly: false
	}));

	test("Entrance Type: ERC Hook", testOnCase({
		isReentrancy: true,
		name: "NFT Trader 2",
		chain: "Ethereum",
		txHash: "0x431341c6d41301b7db3b719ccaec8081adf71b707069ea27d71dcdd374d8e6fa",
		scope: Reentrancy.Scope.CrossFunction,
		entranceType: Reentrancy.EntranceType.ERCHook,
		readonly: false
	}));

	test("Readonly", testOnCase({
		isReentrancy: true,
		name: "Market.xyz",
		chain: "Polygon",
		txHash: "0xb8efe839da0c89daa763f39f30577dc21937ae351c6f99336a0017e63d387558",
		scope: Reentrancy.Scope.CrossContract,
		entranceType: Reentrancy.EntranceType.Fallback,
		readonly: true
	}));

	test("Self-Destruct", testOnCase({
		isReentrancy: true,
		name: "NFT Trader Attack 1",
		chain: "Ethereum",
		txHash: "0x3dc115307c7b79e9ff0afe4c1a0796c22e366a47b47ed2d82194bcd59bb4bd46",
		scope: Reentrancy.Scope.CrossFunction,
		entranceType: Reentrancy.EntranceType.ERCHook,
		readonly: false
	}));

	test("Non-Reentrancy", testOnCase({
		isReentrancy: false,
		name: "Pythia",
		chain: "Ethereum",
		txHash: "0xee5a17a81800a9493e03164673ac0428347d246aa30cdb124b647787faaabbea"
	}));
});