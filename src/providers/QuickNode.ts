import { createThrottledFetch, type DefaultThrottleConfig, type ThrottledFetchInst } from "fetch-throttler";
import { Chain as AllChain, type ChainName } from "../config/Chain";
import { Database } from "../database";
import { Hex, verifyCallTypes } from "../utils";
import { verifyChain, RPC, type DebugTraceProvider, type CallTraceProvider } from "./common";
import { integration } from "./integration";


const endpoints = {
	Ethereum: null,
	EthereumSepolia: "ethereum-sepolia",
	EthereumHolesky: "ethereum-holesky",
	Abstract: "abstract-mainnet",
	AbstractSepolia: "abstract-testnet",
	ArbitrumOne: "arbitrum-mainnet",
	ArbitrumNova: "nova-mainnet",
	ArbitrumSepolia: "arbitrum-sepolia",
	AvalancheCChain: ["avalanche-mainnet", "/ext/bc/C/rpc"],
	AvalancheFuji: ["avalanche-testnet", "/ext/bc/C/rpc"],
	Base: "base-mainnet",
	BaseSepolia: "base-sepolia",
	Berachain: "bera-mainnet",
	BerachainBepolia: "bera-bepolia",
	Blast: "blast-mainnet",
	BlastSepolia: "blast-sepolia",
	BNBSmartChain: "bsc",
	BNBSmartChainTestnet: "bsc-testnet",
	Celo: "celo-mainnet",
	Gnosis: "xdai",
	HyperEVM: "hype-mainnet",
	Linea: "linea-mainnet",
	Mantle: "mantle-mainnet",
	MantleSepolia: "mantle-sepolia",
	Optimism: "optimism",
	OptimismSepolia: "optimism-sepolia",
	Polygon: "matic",
	PolygonAmoy: "matic-amoy",
	Sei: "sei-atlantic",
	SeiTestnet: "sei-pacific",
	Scroll: "scroll-mainnet",
	ScrollSepolia: "scroll-testnet",
	Sonic: "sonic-mainnet",
	Sophon: "sophon-mainnet",
	SophonSepolia: "sophon-testnet",
	World: "worldchain-mainnet",
	WorldSepolia: "worldchain-sepolia",
	Unichain: "unichain-mainnet",
	UnichainSepolia: "unichain-sepolia",
	zkSync: "zksync-mainnet",
	zkSyncSepolia: "zksync-sepolia"
} satisfies Partial<Record<ChainName, null | string | [host: string, suffix: string]>>;

export class QuickNode
	extends RPC.MultiChainProviderBase<QuickNode.Chain>
	implements RPC.MultiChainProvider, RPC.Debug.MultiChainProvider, DebugTraceProvider<RPC.Debug.Trace>, CallTraceProvider<RPC.Trace.Trace> {

	static readonly #fetchInsts = new Map<string, [regular: ThrottledFetchInst, trace: ThrottledFetchInst]>();

	#traceFetch: ThrottledFetchInst;
	#chainName: QuickNode.Chain;
	readonly db: Database | undefined;

	constructor(
		readonly apiKey: QuickNode.ApiKey,
		chain?: QuickNode.Chain | number,
		database?: Database
	) {
		if (!QuickNode.#fetchInsts.has(apiKey[0])) {
			const fetchConfig: DefaultThrottleConfig = {
				interval: 1000,
				maxConcurrency: QuickNode.rateLimits[apiKey[2] ?? QuickNode.Plan.Free],
				maxRetry: 3,
				shouldRetry(errOrRes) {
					if (errOrRes instanceof Response)
						return errOrRes.status === 429 || errOrRes.status === 408;
				}
			};
			const regular = createThrottledFetch(fetchConfig);
			const trace = createThrottledFetch({
				...fetchConfig,
				maxConcurrency: QuickNode.rateLimits[apiKey[2] ?? QuickNode.Plan.Free] / 2.5
			});
			QuickNode.#fetchInsts.set(apiKey[0], [regular, trace]);
		}
		const [fetch, traceFetch] = QuickNode.#fetchInsts.get(apiKey[0])!;
		super(fetch);
		this.#traceFetch = traceFetch;
		this.#chainName = chain ? this.verifyChain(chain) : "Ethereum";
		this.db = database;
	}

	override get name(): string {
		return "QuickNode";
	}
	get chain(): number {
		return AllChain[this.#chainName];
	}
	set chain(chain: QuickNode.Chain | number) {
		this.#chainName = this.verifyChain(chain);
	}

	protected verifyChain(chain: QuickNode.Chain | number): QuickNode.Chain {
		return verifyChain(chain, endpoints, "QuickNode");
	}

	protected override getUrl(chain: QuickNode.Chain | number): string {
		chain = this.verifyChain(chain);
		const endpoint = endpoints[chain];
		const prefix = endpoint === null
			? this.apiKey[0]
			: `${this.apiKey[0]}.${typeof endpoint === "string" ? endpoint : endpoint[0]}`;
		const suffix = endpoint && Array.isArray(endpoint) ? endpoint[1] : "";
		return `https://${prefix}.quiknode.pro/${this.apiKey[1]}${suffix}`;
	}

	blockNumber(chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_blockNumber", [], chain);
	}

	getBlockByNumber(blockNumber: RPC.BlockNumber, full: boolean, chain?: QuickNode.Chain | number) {
		return this.request<RPC.Block | RPC.Block<RPC.Transaction> | null>("eth_getBlockByNumber", [blockNumber, full], chain);
	}

	@integration()
	getTransactionByHash(txHash: Hex.TxHash, chain?: QuickNode.Chain | number) {
		return this.request<RPC.Transaction | null>("eth_getTransactionByHash", [txHash], chain);
	}

	@integration()
	getCode(address: Hex.Address, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_getCode", [address, blockNumber], chain);
	}

	getStorageAt(address: Hex.Address, position: Hex.String, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_getStorageAt", [address, position, blockNumber], chain);
	}

	call(request: RPC.CallRequest, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_call", [request, blockNumber], chain);
	}

	@integration()
	async traceTransaction(txHash: Hex.TxHash, chain?: QuickNode.Chain | number) {
		chain = this.verifyChain(chain ?? this.#chainName);
		const method = chain.startsWith("Arbitrum") ? "arbtrace_transaction" : "trace_transaction";
		const traces = await this.request<RPC.Trace.TraceInfo[] | null>(method, [txHash], chain, this.#traceFetch)
			.catch(err => {
				if (err instanceof Response && err.status === 404)
					return null;
				throw err;
			});
		return traces?.length ? traces.map(RPC.Trace.convert) : null;
	}

	getCallTraces(txHash: Hex.TxHash, chain?: number) {
		return this.traceTransaction(txHash, chain);
	}

	@integration()
	async debugTraceTransaction(txHash: Hex.TxHash, options: RPC.Debug.DebugTransactionOptions, chain?: QuickNode.Chain | number) {
		const trace = await this.request<QuickNode.DebugTraceRaw | [] | null>("debug_traceTransaction", [txHash, options], chain, this.#traceFetch)
			.then(r => r == null || Array.isArray(r) ? null : r)
			.catch(err => {
				if (err instanceof Response && err.status === 404)
					return null;
				throw err;
			});
		return trace ? verifyCallTypes(trace) : null;
	}

	getDebugTrace(txHash: Hex.TxHash, chain?: number) {
		return this.debugTraceTransaction(txHash, { tracer: "callTracer" }, chain);
	}
}

export namespace QuickNode {
	export type Chain = keyof typeof endpoints;

	export const chains = Object.freeze(Object.keys(endpoints) as Chain[]);

	export function supports(chain: string): chain is Chain {
		return chain in endpoints;
	}

	export enum Plan {
		Free,
		Build,
		Accelerate,
		Scale,
		Business
	}

	export type ApiKey = Readonly<[endpoint: string, token: string, plan?: Plan]>;

	export const rateLimits: Record<Plan, number> = {
		[Plan.Free]: 15,
		[Plan.Build]: 50,
		[Plan.Accelerate]: 125,
		[Plan.Scale]: 250,
		[Plan.Business]: 500
	};

	export type DebugTraceRaw = Omit<RPC.Debug.Trace, "type" | "calls"> & {
		type: string;
		calls?: DebugTraceRaw[];
	};
}