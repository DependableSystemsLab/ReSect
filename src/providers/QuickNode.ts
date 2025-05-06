import { Chain as AllChain, type ChainName } from "../config/Chain";
import type { QuickNodeApiKey } from "../config/credentials";
import { Database } from "../database";
import { Hex } from "../utils";
import { verifyChain, RPC, type DebugTraceProvider } from "./common";
import { debugTraceTransaction, getCode } from "./integration";


const endpoints = {
	Ethereum: null,
	EthereumSepolia: "ethereum-sepolia",
	EthereumHolesky: "ethereum-holesky",
	Abstract: "abstract-mainnet",
	AbstractSepolia: "abstract-testnet",
	ArbitrumOne: "arbitrum-mainnet",
	ArbitrumNova: "nova-mainnet",
	ArbitrumSepolia: "arbitrum-sepolia",
	AvalancheCChain: "avalanche-mainnet",
	AvalancheFuji: "avalanche-testnet",
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
	Linea: "linea-mainnet",
	Mantle: "mantle-mainnet",
	MantleSepolia: "mantle-sepolia",
	Optimism: "optimism",
	OptimismSepolia: "optimism-sepolia",
	Polygon: "matic",
	PolygonAmoy: "matic-amoy",
	Scroll: "scroll-mainnet",
	ScrollSepolia: "scroll-testnet",
	Unichain: "unichain-mainnet",
	UnichainSepolia: "unichain-sepolia",
	Xai: "xai-mainnet",
	XaiSepolia: "xai-testnet",
	zkSync: "zksync-mainnet",
	zkSyncSepolia: "zksync-sepolia"
} satisfies Partial<Record<ChainName, string | null>>;

export class QuickNode
	extends RPC.MultiChainProviderBase<QuickNode.Chain>
	implements RPC.MultiChainProvider, RPC.Debug.MultiChainProvider, DebugTraceProvider<RPC.Debug.Trace> {
	#chainName: QuickNode.Chain;

	constructor(
		readonly apiKey: QuickNodeApiKey,
		chain?: QuickNode.Chain | number
	) {
		super();
		this.#chainName = chain ? this.verifyChain(chain) : "Ethereum";
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
		const chainEndpoint = endpoints[chain];
		const prefix = chainEndpoint === null ? this.apiKey[0] : `${this.apiKey[0]}.${chainEndpoint}`;
		return `https://${prefix}.quiknode.pro/${this.apiKey[1]}`;
	}

	blockNumber(chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_blockNumber", [], chain);
	}
	getBlockByNumber(blockNumber: RPC.BlockNumber, full: boolean, chain?: QuickNode.Chain | number) {
		return this.request<RPC.Block | RPC.Block<RPC.Transaction> | null>("eth_getBlockByNumber", [blockNumber, full], chain);
	}
	getTransactionByHash(txHash: Hex.TxHash, chain?: QuickNode.Chain | number) {
		return this.request<RPC.Transaction | null>("eth_getTransactionByHash", [txHash], chain);
	}
	getCode(address: Hex.Address, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_getCode", [address, blockNumber], chain);
	}
	getStorageAt(address: Hex.Address, position: Hex.String, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_getStorageAt", [address, position, blockNumber], chain);
	}
	call(request: RPC.CallRequest, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		return this.request<Hex.String>("eth_call", [request, blockNumber], chain);
	}

	debugTraceTransaction(txHash: Hex.TxHash, options: RPC.Debug.DebugTransactionOptions, chain?: QuickNode.Chain | number) {
		return this.request<RPC.Debug.Trace | null>("debug_traceTransaction", [txHash, options], chain);
	}

	getDebugTrace(txHash: Hex.TxHash, chain?: number) {
		return this.debugTraceTransaction(txHash, { tracer: "callTracer" }, chain);
	}
}

export class QuickNodeWithDb extends QuickNode {
	readonly db: Database;

	constructor(
		apiKey: QuickNodeApiKey,
		chain: QuickNode.Chain | number,
		db?: Database
	) {
		super(apiKey, chain);
		this.db = db ?? Database.default;
	}

	override getCode(address: Hex.Address, blockNumber: RPC.BlockNumber, chain?: QuickNode.Chain | number) {
		chain = chain === undefined ? this.chain : AllChain[this.verifyChain(chain)];
		return getCode.call(
			this,
			super.getCode.bind(this),
			address, blockNumber, chain
		);
	}

	override debugTraceTransaction(txHash: Hex.TxHash, options: RPC.Debug.DebugTransactionOptions, chain?: QuickNode.Chain | number) {
		chain = chain === undefined ? this.chain : AllChain[this.verifyChain(chain)];
		return debugTraceTransaction.call(
			this,
			super.debugTraceTransaction.bind(this),
			txHash, options, chain
		);
	}
}

export namespace QuickNode {
	export type Chain = keyof typeof endpoints;

	export const chains = Object.freeze(Object.keys(endpoints) as Chain[]);

	export function supports(chain: string): chain is Chain {
		return chain in endpoints;
	}
}