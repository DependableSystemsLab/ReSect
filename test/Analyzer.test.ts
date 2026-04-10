import inspector from "node:inspector";
import { Chain, type ChainName } from "../src/config/Chain";
import { etherscanApiKeys, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database, ReentrancyAttack } from "../src/database";
import { Etherscan, QuickNode, Tenderly } from "../src/providers";
import { Analyzer, Scope } from "../src/core";
import type { Hex } from "../src/utils";

interface TestCaseBase {
	name: string;
	chain: ChainName;
	txHash: Hex.String;
	useDatabase?: boolean;
}

interface PositiveTestCase extends TestCaseBase {
	isReentrancy: true;
	scope?: Scope;
	entranceType?: ReentrancyAttack.EntryPoint;
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

	const etherscan = new Etherscan(etherscanApiKeys, Chain.Ethereum);
	const provider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, "Ethereum")
		: tenderlyNodeAccessKeys ? new Tenderly(tenderlyNodeAccessKeys, "Ethereum") : undefined;
	const etherscanWithDb = new Etherscan(etherscanApiKeys, Chain.Ethereum, Database.default);
	const providerWithDb = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, "Ethereum", Database.default)
		: tenderlyNodeAccessKeys ? new Tenderly(tenderlyNodeAccessKeys, "Ethereum", Database.default) : undefined;
	if (!provider || !providerWithDb)
		throw new Error("At least one provider (QuickNode, Tenderly) must be available");

	const testOnCase = (testCase: Readonly<TestCase>) => async () => {
		const { chain, txHash } = testCase;
		const chainId = Chain[chain];
		const analyzer = testCase.useDatabase === false
			? new Analyzer(etherscan, provider, provider)
			: new Analyzer(etherscanWithDb, providerWithDb, providerWithDb);
		let detected = false;
		let scope = Scope.CrossContract;
		let readonly = false;
		const entranceTypes = new Set<ReentrancyAttack.EntryPoint>();
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
		scope: Scope.SingleFunction,
		entranceType: ReentrancyAttack.EntryPoint.Fallback,
		readonly: false
	}));

	test("Proxy Contract", testOnCase({
		isReentrancy: true,
		name: "Predy Finance",
		chain: "ArbitrumOne",
		txHash: "0xbe163f651d23f0c9e4d4a443c0cc163134a31a1c2761b60188adcfd33178f50f",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.ApplicationHook,
		readonly: false
	}));

	test("Proxy Contract Exclusion", testOnCase({
		isReentrancy: false,
		name: "Some Random Tx",
		chain: "Base",
		txHash: "0x9d0a27afc2aa374222914da9c4573e32dbcaacd89ada60af21e59d13927083b3"
	}));

	test("Scope: Cross Function", testOnCase({
		isReentrancy: true,
		name: "TrustSwap",
		chain: "Ethereum",
		txHash: "0x83952d998cc562f40d0a58b76d563a16f3064ddb116e7b1b4e40298ca80499b8",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.MaliciousToken,
		readonly: false
	}));

	test("Scope: Cross Contract", testOnCase({
		isReentrancy: true,
		name: "GoodDollar",
		chain: "Ethereum",
		txHash: "0x726459a46839c915ee2fb3d8de7f986e3c7391c605b7a622112161a84c7384d0",
		scope: Scope.CrossContract,
		entranceType: ReentrancyAttack.EntryPoint.ApplicationHook,
		readonly: false
	}));

	test("Entrance Type: Malicious Token", testOnCase({
		isReentrancy: true,
		name: "GemPad",
		chain: "Ethereum",
		txHash: "0x9ceb4698eb09e93d232e10557c3932e1e74b5d8e78170b5034512aa0a8135970",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.MaliciousToken,
		readonly: false
	}));

	test("Entrance Type: ERC Hook", testOnCase({
		isReentrancy: true,
		name: "NFT Trader 2",
		chain: "Ethereum",
		txHash: "0x431341c6d41301b7db3b719ccaec8081adf71b707069ea27d71dcdd374d8e6fa",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.ERCHook,
		readonly: false
	}));

	test("Readonly", testOnCase({
		isReentrancy: true,
		name: "Market.xyz",
		chain: "Polygon",
		txHash: "0xb8efe839da0c89daa763f39f30577dc21937ae351c6f99336a0017e63d387558",
		scope: Scope.CrossContract,
		entranceType: ReentrancyAttack.EntryPoint.Fallback,
		readonly: true
	}));

	test("Self-Destruct", testOnCase({
		isReentrancy: true,
		name: "NFT Trader Attack 1",
		chain: "Ethereum",
		txHash: "0x3dc115307c7b79e9ff0afe4c1a0796c22e366a47b47ed2d82194bcd59bb4bd46",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.ERCHook,
		readonly: false
	}));

	test("Genesis Transactions", testOnCase({
		isReentrancy: true,
		name: "Sumer Money Attack",
		chain: "Base",
		txHash: "0x619c44af9fedb8f5feea2dcae1da94b6d7e5e0e7f4f4a99352b6c4f5e43a4661",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.Fallback,
		readonly: false
	}));

	// Logical bug
	test("Earning.Farm Attack", testOnCase({
		isReentrancy: true,
		name: "Earning.Farm Attack",
		chain: "Ethereum",
		txHash: "0x6e6e556a5685980317cb2afdb628ed4a845b3cbd1c98bdaffd0561cb2c4790fa",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.Fallback,
		readonly: false
	}));

	// 404
	test("DeltaPrime Attack", testOnCase({
		isReentrancy: true,
		name: "DeltaPrime Attack",
		chain: "AvalancheCChain",
		txHash: "0xece4efbe11e59d457cb1359ebdc4efdffdd310f0a82440be03591f2e27d2b59e",
		scope: Scope.CrossFunction,
		entranceType: ReentrancyAttack.EntryPoint.ApplicationHook,
		readonly: false
	}));

	// Unexpected error
	test("Sentiment Attack", testOnCase({
		isReentrancy: true,
		name: "Sentiment Attack",
		chain: "ArbitrumOne",
		txHash: "0xa9ff2b587e2741575daf893864710a5cbb44bb64ccdc487a100fa20741e0f74d",
		scope: Scope.CrossContract,
		entranceType: ReentrancyAttack.EntryPoint.Fallback,
		readonly: true
	}));

	test("Strange Error", testOnCase({
		isReentrancy: false,
		name: "Whatever",
		chain: "World",
		txHash: "0xf5e906e2afd2ee51513a362556af70bdd8c03e91ca7a84c37e561a066b15f7bb"
	}));

	test("Non-Reentrancy", testOnCase({
		isReentrancy: false,
		name: "Pythia",
		chain: "Ethereum",
		txHash: "0xee5a17a81800a9493e03164673ac0428347d246aa30cdb124b647787faaabbea"
	}));
});