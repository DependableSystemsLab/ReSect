import { Chain as AllChain, Chain, type ChainName } from "../config/Chain";
import { Database } from "../database";
import { Hex } from "../utils";
import { verifyChain, RPC, type DebugTraceProvider, type CallTraceProvider } from "./common";
import { integration } from "./integration";


export class CacheProvider
	extends RPC.MultiChainProviderBase
	implements RPC.MultiChainProvider, RPC.Debug.MultiChainProvider, DebugTraceProvider<RPC.Debug.Trace>, CallTraceProvider<RPC.Trace.Trace> {

	#chainName: ChainName;
	readonly db: Database;

	constructor(database: Database, chain: ChainName | number = Chain.Ethereum) {
		super(() => { throw new CacheProviderError(); });
		this.db = database;
		this.#chainName = verifyChain(chain, Chain, "CacheProvider");
	}

	override get name(): string {
		return "CacheProvider";
	}
	get chain(): number {
		return AllChain[this.#chainName];
	}
	set chain(chain: ChainName | number) {
		this.#chainName = verifyChain(chain, Chain, "CacheProvider");
	}

	protected override getUrl(chain: ChainName | number): string {
		throw new CacheProviderError();
	}

	blockNumber(chain?: ChainName | number): Promise<Hex.String> {
		throw new CacheProviderError();
	}

	getBlockByNumber(blockNumber: RPC.BlockNumber, full: boolean, chain?: ChainName | number): Promise<RPC.Block | RPC.Block<RPC.Transaction> | null> {
		throw new CacheProviderError();
	}

	@integration()
	getTransactionByHash(txHash: Hex.TxHash, chain?: ChainName | number): Promise<RPC.Transaction | null> {
		throw new CacheProviderError();
	}

	@integration()
	getCode(address: Hex.Address, blockNumber: RPC.BlockNumber, chain?: ChainName | number): Promise<Hex.String> {
		throw new CacheProviderError();
	}

	getStorageAt(address: Hex.Address, position: Hex.String, blockNumber: RPC.BlockNumber, chain?: ChainName | number): Promise<Hex.String> {
		throw new CacheProviderError();
	}

	call(request: RPC.CallRequest, blockNumber: RPC.BlockNumber, chain?: ChainName | number): Promise<Hex.String> {
		throw new CacheProviderError();
	}

	@integration()
	async traceTransaction(txHash: Hex.TxHash, chain?: ChainName | number): Promise<RPC.Trace.Trace[] | null> {
		throw new CacheProviderError();
	}

	getCallTraces(txHash: Hex.TxHash, chain?: number): Promise<RPC.Trace.Trace[] | null> {
		throw new CacheProviderError();
	}

	@integration()
	async debugTraceTransaction(txHash: Hex.TxHash, options: RPC.Debug.DebugTransactionOptions, chain?: ChainName | number): Promise<RPC.Debug.Trace | null> {
		throw new CacheProviderError();
	}

	getDebugTrace(txHash: Hex.TxHash, chain?: number) {
		return this.debugTraceTransaction(txHash, { tracer: "callTracer" }, chain);
	}
}

export class CacheProviderError extends Error {
	constructor(message?: string) {
		super(message ?? "CacheProvider cannot be used to send actual requests. Please use a real provider for analysis.");
	}
}
