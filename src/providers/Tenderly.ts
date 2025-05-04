import { ChainName, chainNames } from "../config/Chain";
import { Database } from "../database";
import { verifyCallTypes, Hex, type TypeVerifiedDebugTrace } from "../utils";
import { getDebugTraceWithDb, type DebugTrace, type Trace, type DebugTraceProvider, type RPC } from "./base";


const tenderlyNetwork = {
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
	private _chain!: Tenderly.SupportedNetwork;
	private _accessKey!: string;

	constructor(chain: number | ChainName, accessKey: string) {
		this.node = [chain, accessKey];
	}

	get chain(): Tenderly.SupportedNetwork {
		return this._chain;
	}
	get accessKey(): string {
		return this._accessKey;
	}
	set node(value: Tenderly.Node) {
		let [chain, accessKey] = value;
		if (typeof chain == "number") {
			const chainName = chainNames.get(chain);
			if (chainName == undefined)
				throw new Error(`Unsupported chain ID: ${value}`);
			chain = chainName;
		}
		if (!(chain in tenderlyNetwork))
			throw new Error(`Unsupported network: ${chain}`);
		this._chain = chain as Tenderly.SupportedNetwork;
		this._accessKey = accessKey;
	}
	protected get rpcUrl(): string {
		return `https://${tenderlyNetwork[this._chain]}.gateway.tenderly.co/${this._accessKey}`;
	}

	async #request<T>(method: string, params: unknown[]): Promise<T> {
		const result = await fetch(this.rpcUrl, {
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

	getDebugTrace(txHash: string): Promise<DebugTrace<Trace>> {
		return this.debugTraceTransaction(txHash);
	}

	async debugTraceTransaction(
		txHash: Hex,
		tracer: "callTracer" | "prestateTracer" = "callTracer",
		onlyTopCall = false
	): Promise<Tenderly.DebugTrace> {
		txHash = Hex.verifyTxHash(txHash);
		const trace = await this.#request<Tenderly.DebugTraceRaw>("debug_traceTransaction", [txHash, { tracer, onlyTopCall }]);
		return verifyCallTypes(trace);
	}
}

export class TenderlyWithDb extends Tenderly {
	readonly #ctx: DebugTraceProvider<Trace> & { readonly db: Database };

	constructor(
		chain: number | ChainName,
		accessKey: string,
		db?: Database
	) {
		super(chain, accessKey);
		this.#ctx = {
			db: db ??= Database.default,
			getDebugTrace: txHash => super.getDebugTrace(txHash)
		}
	}

	override async getDebugTrace(txHash: string): Promise<DebugTrace<Trace>> {
		return getDebugTraceWithDb.call(this.#ctx, txHash);
	}
}

export namespace Tenderly {
	export type SupportedNetwork = keyof typeof tenderlyNetwork;

	export type Node =
		| [chain: ChainName, accessKey: string]
		| [chainId: number, accessKey: string]
		| [chain: ChainName | number, accessKey: string];

	export interface DebugTraceRaw {
		type: string;
		from: string;
		to: string;
		value: string;
		gas: string;
		gasUsed: string;
		input: string;
		output: string;
		calls?: DebugTraceRaw[];
	};

	export type DebugTrace = TypeVerifiedDebugTrace<DebugTraceRaw>;
}