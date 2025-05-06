import { Chain as AllChain, chainNames, type ChainName } from "../config/Chain";
import type { TenderlyApiKeys } from "../config/credentials";
import { Database } from "../database";
import { verifyCallTypes, Hex, type Trace, type DebugTrace } from "../utils";
import { getDebugTraceWithDb, RPC, type DebugTraceProvider, type DbExtensionContext } from "./base";


const endpoints = {
	Ethereum: "mainnet",
	EthereumSepolia: "sepolia",
	EthereumHolesky: "holesky",
	ArbitrumOne: "arbitrum",
	ArbitrumNova: "arbitrum-nova",
	ArbitrumSepolia: "arbitrum-sepolia",
	AvalancheCChain: "avalanche",
	AvalancheFuji: "avalanche-fuji",
	Linea: "linea",
	LineaSepolia: "linea-sepolia",
	Base: "base",
	BaseSepolia: "base-sepolia",
	Optimism: "optimism",
	OptimismSepolia: "optimism-sepolia",
	Polygon: "polygon",
	PolygonAmoy: "polygon-amoy",
	ApeChain: "apechain",
	ApeChainCurtis: "curtis",
	Mantle: "mantle",
	MantleSepolia: "mantle-sepolia",
	zkSync: "zksync",
	zkSyncSepolia: "zksync-sepolia"
} satisfies Partial<Record<ChainName, string>>;

export class Tenderly implements DebugTraceProvider<DebugTrace<Trace>> {
	private static _rpcId = 0;

	readonly #apiKeys: TenderlyApiKeys;
	#chain: Tenderly.Chain;

	constructor(chain: Tenderly.Chain | number, accessKey: string)
	constructor(apiKeys: TenderlyApiKeys, defaultChain?: Tenderly.Chain)
	constructor(param1: Tenderly.Chain | number | TenderlyApiKeys, param2?: string) {
		if (typeof param1 !== "object")
			param1 = this.verifyChain(param1);
		[this.#apiKeys, this.#chain] = typeof param1 === "object"
			? [param1, this.verifyChain((param2 ?? "Ethereum") as Tenderly.Chain)]
			: [{ [param1]: param2! }, param1];
	}

	get chain(): Tenderly.Chain {
		return this.#chain;
	}
	set chain(chain: Tenderly.Chain) {
		this.#chain = this.verifyChain(chain);
	}
	get chainId(): number {
		return AllChain[this.#chain];
	}
	set chainId(chainId: number) {
		this.#chain = this.verifyChain(chainId);
	}

	protected verifyChain(chain: Tenderly.Chain | number): Tenderly.Chain {
		if (typeof chain === "number") {
			const name = chainNames.get(chain);
			if (!name)
				throw new Error(`Invalid chain ID: ${chain}`);
			if (!Tenderly.supports(name))
				throw new Error(`Tenderly does not support ${name}`);
			chain = name;
		}
		if (!(chain in this.#apiKeys))
			throw new Error(`API key for ${chain} is not set`);
		return chain;
	}

	protected getUrl(chain?: Tenderly.Chain | number): string {
		chain = chain === undefined ? this.#chain : this.verifyChain(chain);
		return `https://${endpoints[chain]}.gateway.tenderly.co/${this.#apiKeys[chain]}`;
	}

	async #request<T>(method: string, params: unknown[], chain?: Tenderly.Chain | number): Promise<T> {
		const result = await fetch(this.getUrl(chain), {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: Tenderly._rpcId++,
				method,
				params
			})
		});
		if (!result.ok) {
			const text = await result.text();
			throw new Error(`Tenderly API error: ${text}`);
		}
		const json = await result.json() as RPC.Response<T> | RPC.Error;
		if ("error" in json) {
			const error = json.error;
			throw new Error(`Tenderly API error: ${error.message} (${error.slug})`);
		}
		return json.result;
	}

	getDebugTrace(txHash: Hex.String, chain?: Tenderly.Chain | number): Promise<DebugTrace<Trace>> {
		return this.debugTraceTransaction(txHash, "callTracer", false, chain);
	}

	async debugTraceTransaction(
		txHash: Hex.String,
		tracer: "callTracer" | "prestateTracer" = "callTracer",
		onlyTopCall = false,
		chain?: Tenderly.Chain | number
	): Promise<DebugTrace<Trace>> {
		Hex.verifyTxHash(txHash);
		const trace = await this.#request<Tenderly.DebugTraceRaw>("debug_traceTransaction", [txHash, { tracer, onlyTopCall }], chain);
		return verifyCallTypes(trace);
	}
}

export class TenderlyWithDb extends Tenderly {
	readonly #ctx: DbExtensionContext;

	constructor(
		chain: Tenderly.Chain | number,
		accessKey: string,
		provider: RPC.MultiChainProvider,
		db?: Database
	)
	constructor(
		apiKeys: TenderlyApiKeys,
		defaultChain: Tenderly.Chain,
		provider: RPC.MultiChainProvider,
		db?: Database
	)
	constructor(
		param1: Tenderly.Chain | number | TenderlyApiKeys,
		param2: string,
		provider: RPC.MultiChainProvider,
		db?: Database
	) {
		// @ts-ignore
		super(param1, param2);
		this.#ctx = {
			db: db ?? Database.default,
			provider,
			getDebugTrace: (txHash, chain) => super.getDebugTrace(txHash, chain)
		} as DbExtensionContext;
	}

	override async getDebugTrace(txHash: Hex.TxHash, chain?: Tenderly.Chain | number) {
		chain = chain === undefined ? this.chainId : AllChain[this.verifyChain(chain)];
		return getDebugTraceWithDb.call(this.#ctx, txHash, chain);
	}
}

export namespace Tenderly {
	export type Chain = keyof typeof endpoints;

	export const chains = Object.freeze(Object.keys(endpoints) as Chain[]);

	export function supports(chain: string): chain is Chain {
		return chain in endpoints;
	}

	export type DebugTraceRaw = Omit<DebugTrace<Trace>, "type" | "calls"> & {
		type: string;
		calls?: DebugTraceRaw[];
	};
}