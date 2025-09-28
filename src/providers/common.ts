import type { Fetch } from "fetch-throttler";
import { chainNames, type ChainName } from "../config/Chain";
import { Hex, type CallTrace, type DebugTrace, type MinimalTrace } from "../utils";


export function verifyChain<T extends ChainName = ChainName>(
	chain: string | number,
	chains: T[] | Record<T, any>,
	serviceName?: string
): T {
	if (typeof chain === "number") {
		const name = chainNames.get(chain);
		if (!name)
			throw new Error(`Invalid chain ID: ${chain}`);
		chain = name;
	}
	if (typeof chain !== "string")
		throw new TypeError(`Invalid chain name: ${chain}`);
	const exists = Array.isArray(chains) ? chains.includes(chain as T) : chain in chains;
	if (!exists)
		throw new Error(serviceName ? `Service ${serviceName} does not support ${chain}` : `Chain ${chain} not supported`);
	return chain as T;
}

export interface CallTraceProvider<T extends MinimalTrace = MinimalTrace> {
	getCallTraces(txHash: Hex.TxHash, chain?: number): Promise<CallTrace<T>[] | null>;
}

export interface DebugTraceProvider<T extends MinimalTrace = MinimalTrace> {
	getDebugTrace(txHash: Hex.TxHash, chain?: number): Promise<DebugTrace<T> | null>;
}

export namespace RPC {
	export interface Response<T = any> {
		id: number;
		jsonrpc: string;
		result: T;
	}

	export interface Error {
		error: {
			id: string;
			slug: string;
			message: string;
		};
	}

	export type BlockTag = "earliest" | "latest" | "safe" | "finalized" | "pending";

	export type BlockNumber = Hex.String | BlockTag;

	export interface CallRequest {
		from?: Hex.Address;
		to: Hex.Address;
		gas?: Hex.String;
		gasPrice?: Hex.String;
		value?: Hex.String;
		input?: Hex.String;
	}

	export interface Block<T extends Hex.TxHash | Transaction = Hex.TxHash> {
		baseFeePerGas?: Hex.String;
		difficulty: Hex.String;
		extraData: Hex.String;
		gasLimit: Hex.String;
		gasUsed: Hex.String;
		hash: Hex.BlockHash;
		logsBloom: Hex.String;
		miner: Hex.Address;
		mixHash: Hex.String;
		nonce: Hex.String;
		number: Hex.String;
		parentHash: Hex.BlockHash;
		receiptsRoot: Hex.String;
		sha3Uncles: Hex.String;
		size: Hex.String;
		stateRoot: Hex.String;
		timestamp: Hex.String;
		totalDifficulty: Hex.String;
		transactions: T[];
		transactionsRoot: Hex.String;
		uncles: Hex.BlockHash[];
	}

	export interface Transaction {
		blockHash: Hex.BlockHash;
		blockNumber: Hex.String;
		from: Hex.Address;
		gas: Hex.String;
		gasPrice: Hex.String;
		maxFeePerGas?: Hex.String;
		maxPriorityFeePerGas?: Hex.String;
		hash: Hex.TxHash;
		input: Hex.String;
		nonce: Hex.String;
		to: Hex.Address | null;
		transactionIndex: Hex.String;
		value: Hex.String;
		type: Hex.String;
		accessList?: {
			address: Hex.Address;
			storageKeys: Hex.String[];
		}[];
		v: Hex.String;
		r: Hex.String;
		s: Hex.String;
	}

	export interface Provider {
		blockNumber(): Promise<Hex.String>;
		getBlockByNumber(blockNumber: BlockNumber, full: boolean): Promise<Block | Block<Transaction> | null>;
		getTransactionByHash(txHash: Hex.TxHash): Promise<Transaction | null>;
		getCode(address: Hex.Address, blockNumber: BlockNumber): Promise<Hex.String>;
		getStorageAt(address: Hex.Address, position: Hex.String, blockNumber: BlockNumber): Promise<Hex.String>;
		call(request: CallRequest, blockNumber: BlockNumber): Promise<Hex.String>;
	}

	export type MultiChainProvider<P extends object = Provider> = {
		[M in keyof P]: P[M] extends (...args: any[]) => infer R
		? (...args: [...Parameters<P[M]>, chain?: number]) => R
		: P[M];
	} & { chain: number; };

	export abstract class MultiChainProviderBase<N extends ChainName = ChainName> {
		static #rpcId = 0;

		#fetch: Fetch;
		abstract readonly name: string;

		constructor(fetch: Fetch = globalThis.fetch) {
			this.#fetch = fetch;
		}

		protected abstract getUrl(chain?: N | number): string;

		protected async request<T>(method: string, params: unknown[], chain?: N | number, fetch?: Fetch): Promise<T> {
			const result = await (fetch ?? this.#fetch)(this.getUrl(chain), {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: MultiChainProviderBase.#rpcId++,
					method,
					params
				})
			});
			if (!result.ok)
				throw result;
			const json = await result.json() as RPC.Response<T> | RPC.Error;
			if ("error" in json) {
				const error = json.error;
				throw new Error(`${this.name} API error: ${error.message} (${error.slug})`);
			}
			return json.result;
		}
	}

	const blockTags = ["earliest", "latest", "safe", "finalized", "pending"] as const satisfies BlockTag[];

	export namespace ExtendedProvider {
		export type BlockNumber = BlockTag | Hex.Number | Hex.String;

		export interface CallRequest {
			from?: Hex.String;
			to: Hex.String;
			gas?: Hex;
			gasPrice?: Hex;
			value?: Hex;
			input?: Hex;
		}
	}

	export class ExtendedProvider {
		readonly #provider: MultiChainProvider;

		constructor(provider: MultiChainProvider) {
			this.#provider = provider;
		}

		#convertBlockNumber(blockNumber: ExtendedProvider.BlockNumber | undefined): Hex.String | BlockTag {
			blockNumber ??= "latest";
			if (typeof blockNumber !== "string" || !blockTags.includes(blockNumber as BlockTag))
				blockNumber = Hex.toString(blockNumber);
			return blockNumber;
		}

		async blockNumber(chainId?: number): Promise<number> {
			const result = await this.#provider.blockNumber(chainId);
			return Number.parseInt(result, 16);
		}

		getBlockByNumber(blockNumber: ExtendedProvider.BlockNumber, full?: false, chainId?: number): Promise<Block | null>;
		getBlockByNumber(blockNumber: ExtendedProvider.BlockNumber, full: true, chainId?: number): Promise<Block<Transaction> | null>;
		getBlockByNumber(blockNumber: ExtendedProvider.BlockNumber, full?: boolean, chainId?: number): Promise<Block | Block<Transaction> | null>;
		async getBlockByNumber(blockNumber: ExtendedProvider.BlockNumber, full: boolean = false, chainId?: number): Promise<Block | Block<Transaction> | null> {
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getBlockByNumber(blockNumber, full, chainId);
			return result;
		}

		async getTransactionByHash(txHash: Hex.String, chainId?: number): Promise<Transaction | null> {
			const result = await this.#provider.getTransactionByHash(Hex.verifyTxHash(txHash), chainId);
			return result;
		}

		async getCode(address: Hex.String, blockNumber?: ExtendedProvider.BlockNumber, chainId?: number): Promise<Buffer | null> {
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getCode(Hex.verifyAddress(address), blockNumber, chainId).then(Hex.removePrefix);
			return result === "" ? null : Buffer.from(result, "hex");
		}

		async getStorageAt(address: Hex.String, position: Hex, blockNumber?: ExtendedProvider.BlockNumber, chainId?: number): Promise<bigint> {
			position = Hex.toString(position);
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getStorageAt(Hex.verifyAddress(address), position, blockNumber, chainId).then(Hex.removePrefix);
			return BigInt(result);
		}

		async call(request: ExtendedProvider.CallRequest, blockNumber?: ExtendedProvider.BlockNumber, chainId?: number): Promise<Buffer> {
			const req: CallRequest = {
				from: request.from ? Hex.verifyAddress(request.from) : undefined,
				to: Hex.verifyAddress(request.to),
				gas: request.gas ? Hex.toString(request.gas) : undefined,
				gasPrice: request.gasPrice ? Hex.toString(request.gasPrice) : undefined,
				value: request.value ? Hex.toString(request.value) : undefined,
				input: request.input ? Hex.toString(request.input) : undefined
			};
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.call(req, blockNumber, chainId).then(Hex.removePrefix);
			return Buffer.from(result, "hex");
		}
	}
}

export namespace RPC.Trace {
	export type Trace = CallTrace;
}

export namespace RPC.Debug {
	export interface TraceInfo extends MinimalTrace {
		value?: Hex.String;
		gas?: Hex.String;
		gasUsed?: Hex.String;
		error?: string;
	}

	export type Trace = DebugTrace<TraceInfo>;

	export interface DebugTransactionOptions {
		tracer?: "callTracer" | "prestateTracer";
		tracerConfig?: {
			onlyTopCall?: boolean;
			diffMode?: boolean;
		};
		timeout?: number;
	}

	export interface Provider {
		debugTraceTransaction(txHash: Hex.TxHash, options: DebugTransactionOptions): Promise<Trace | null>;
	}

	export type MultiChainProvider = RPC.MultiChainProvider<Provider>;
}