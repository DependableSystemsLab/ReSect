import { Chain as AllChain, type ChainName } from "../config/Chain";
import { Database } from "../database";
import { verifyCallTypes, Hex } from "../utils";
import { verifyChain, RPC, type DebugTraceProvider } from "./common";
import { debugTraceTransaction, type IntegrationContext } from "./integration";


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

export class Tenderly
	extends RPC.MultiChainProviderBase<Tenderly.Chain>
	implements RPC.Debug.MultiChainProvider, DebugTraceProvider<RPC.Debug.TraceInfo> {

	readonly #apiKeys: Tenderly.ApiKeys;
	#chainName: Tenderly.Chain;

	constructor(chain: Tenderly.Chain | number, accessKey: string);
	constructor(apiKeys: Tenderly.ApiKeys, defaultChain?: Tenderly.Chain);
	constructor(param1: Tenderly.Chain | number | Tenderly.ApiKeys, param2?: string) {
		super();
		if (typeof param1 !== "object")
			param1 = this.verifyChain(param1);
		this.#apiKeys = typeof param1 === "object" ? param1 : { [param1]: param2! };
		this.#chainName = typeof param1 === "object"
			? this.verifyChain(param2 as Tenderly.Chain ?? "Ethereum")
			: this.verifyChain(param1);
	}

	override get name(): string {
		return "Tenderly";
	}
	get chainName(): Tenderly.Chain {
		return this.#chainName;
	}
	set chainName(chain: Tenderly.Chain) {
		this.#chainName = this.verifyChain(chain);
	}
	get chain(): number {
		return AllChain[this.#chainName];
	}
	set chain(chainId: number) {
		this.#chainName = this.verifyChain(chainId);
	}

	protected verifyChain(chain: Tenderly.Chain | number): Tenderly.Chain {
		chain = verifyChain(chain, endpoints, "Tenderly");
		if (!(chain in this.#apiKeys))
			throw new Error(`API key for ${chain} is not set`);
		return chain;
	}

	protected getUrl(chain?: Tenderly.Chain | number): string {
		chain = chain === undefined ? this.#chainName : this.verifyChain(chain);
		return `https://${endpoints[chain]}.gateway.tenderly.co/${this.#apiKeys[chain]}`;
	}

	getDebugTrace(txHash: Hex.String, chain?: Tenderly.Chain | number) {
		return this.debugTraceTransaction(txHash, { tracer: "callTracer" }, chain);
	}

	async debugTraceTransaction(
		txHash: Hex.String,
		options: RPC.Debug.DebugTransactionOptions,
		chain?: Tenderly.Chain | number
	) {
		Hex.verifyTxHash(txHash);
		const trace = await this.request<Tenderly.DebugTraceRaw | null>("debug_traceTransaction", [txHash, options], chain);
		return trace ? verifyCallTypes(trace) : null;
	}
}

export class TenderlyWithDb extends Tenderly {
	readonly #ctx: IntegrationContext;

	constructor(
		chain: Tenderly.Chain | number,
		accessKey: string,
		provider: RPC.MultiChainProvider,
		db?: Database
	);
	constructor(
		apiKeys: Tenderly.ApiKeys,
		defaultChain: Tenderly.Chain | undefined,
		provider: RPC.MultiChainProvider,
		db?: Database
	);
	constructor(
		param1: Tenderly.Chain | number | Tenderly.ApiKeys,
		param2: string | undefined,
		provider: RPC.MultiChainProvider,
		db?: Database
	) {
		// @ts-ignore
		super(param1, param2);
		const database = db ?? Database.default;
		this.#ctx = new Proxy(provider, {
			get: (target, p, receiver) => p === "db" ? database : Reflect.get(target, p, receiver)
		}) as IntegrationContext;
	}

	override debugTraceTransaction(txHash: Hex.TxHash, options: RPC.Debug.DebugTransactionOptions, chain?: Tenderly.Chain | number) {
		chain = chain === undefined ? this.chain : AllChain[this.verifyChain(chain)];
		return debugTraceTransaction.call(
			this.#ctx,
			super.debugTraceTransaction.bind(this),
			txHash, options, chain
		);
	}
}

export namespace Tenderly {
	export type Chain = keyof typeof endpoints;

	export const chains = Object.freeze(Object.keys(endpoints) as Chain[]);

	export function supports(chain: string): chain is Chain {
		return chain in endpoints;
	}

	export type ApiKeys = Readonly<Partial<Record<Chain, string>>>;

	export type DebugTraceRaw = Omit<RPC.Debug.Trace, "type" | "calls"> & {
		type: string;
		calls?: DebugTraceRaw[];
	};
}