import type { SetFieldType } from "type-fest";
import { Database } from "../database";
import { Hex } from "../utils";

export enum CallType {
	CALL = "CALL",
	STATICCALL = "STATICCALL",
	DELEGATECALL = "DELEGATECALL",
	CALLCODE = "CALLCODE",
	CREATE = "CREATE",
	CREATE2 = "CREATE2",
	SELFDESTRUCT = "SELFDESTRUCT"
}

export interface MinimalTrace {
	from: string;
	to: string;
	type: CallType;
	input?: string;
	output?: string;
}

export interface Trace extends MinimalTrace {
	value: string;
	gas: string;
	gasUsed: string;
}

export type CallTrace<T extends MinimalTrace = MinimalTrace> = T & {
	traceAddress: number[];
}

export type DebugTrace<T extends MinimalTrace = MinimalTrace> = T & {
	calls?: DebugTrace<T>[];
}

export interface TraceProvider<T extends MinimalTrace = MinimalTrace> {
	getCallTraces(txHash: string): Promise<CallTrace<T>[]>;
}

export interface DebugTraceProvider<T extends MinimalTrace = MinimalTrace> {
	getDebugTrace(txHash: string): Promise<DebugTrace<T>>;
}

interface DbContext {
	readonly db: Database;
}

export async function getDebugTraceWithDb(this: DebugTraceProvider<Trace> & DbContext, txHash: string): Promise<DebugTrace<Trace>> {
	let result = await this.db.getDebugTrace(txHash);
	if (result)
		return result;
	result = await this.getDebugTrace(txHash);
	await this.db.saveDebugTrace(result, txHash);
	return result;
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
		}
	}

	export type BlockTag = "earliest" | "latest" | "safe" | "finalized" | "pending";

	export type BlockNumber = string | BlockTag;

	export interface CallRequest {
		from?: string;
		to: string;
		gas?: string;
		gasPrice?: string;
		value?: string;
		input?: string;
	}

	export interface Block<T extends string | Transaction = string> {
		baseFeePerGas: string;
		difficulty: string;
		extraData: string;
		gasLimit: string;
		gasUsed: string;
		hash: string;
		logsBloom: string;
		miner: string;
		mixHash: string;
		nonce: string;
		number: string;
		parentHash: string;
		receiptsRoot: string;
		sha3Uncles: string;
		size: string;
		stateRoot: string;
		timestamp: string;
		totalDifficulty: string;
		transactions: T[];
		transactionsRoot: string;
		uncles: string[];
	}

	export interface Transaction {
		blockHash: string;
		blockNumber: string;
		from: string;
		gas: string;
		gasPrice: string;
		hash: string;
		input: string;
		nonce: string;
		to: string;
		transactionIndex: string;
		value: string;
		v: string;
		r: string;
		s: string;
	}

	export interface Provider {
		blockNumber(): Promise<string>;
		getBlockByNumber(blockNumber: BlockNumber, full: boolean): Promise<Block | Block<Transaction> | null>;
		getTransactionByHash(txHash: string): Promise<Transaction | null>;
		getCode(address: string, blockNumber: BlockNumber): Promise<string>;
		getStorageAt(address: string, position: string, blockNumber: BlockNumber): Promise<string>;
		call(request: CallRequest, blockNumber: BlockNumber): Promise<string>;
	}

	export type MultiChainProvider = {
		[M in keyof Provider]: Provider[M] extends (...args: any[]) => infer R
		? (...args: [...Parameters<Provider[M]>, chain?: number]) => R
		: Provider[M];
	}

	const blockTags = ["earliest", "latest", "safe", "finalized", "pending"] as const satisfies BlockTag[];

	export class ExtendedProvider {
		readonly #provider: MultiChainProvider;

		constructor(provider: MultiChainProvider) {
			this.#provider = provider;
		}

		#convertBlockNumber(blockNumber: Hex | BlockTag | undefined): string {
			blockNumber ??= "latest";
			if (typeof blockNumber !== "string" || !blockTags.includes(blockNumber as BlockTag))
				blockNumber = Hex.verify(blockNumber);
			return blockNumber;
		}

		async blockNumber(chainId?: number): Promise<number> {
			const result = await this.#provider.blockNumber(chainId);
			return Number.parseInt(result, 16);
		}

		getBlockByNumber(blockNumber: Hex | BlockTag, full?: false, chainId?: number): Promise<Block | null>;
		getBlockByNumber(blockNumber: Hex | BlockTag, full: true, chainId?: number): Promise<Block<Transaction> | null>;
		getBlockByNumber(blockNumber: Hex | BlockTag, full?: boolean, chainId?: number): Promise<Block | Block<Transaction> | null>;
		async getBlockByNumber(blockNumber: Hex | BlockTag, full: boolean = false, chainId?: number): Promise<Block | Block<Transaction> | null> {
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getBlockByNumber(blockNumber, full, chainId);
			return result;
		}

		async getTransactionByHash(txHash: Hex, chainId?: number): Promise<Transaction | null> {
			txHash = Hex.verifyTxHash(txHash);
			const result = await this.#provider.getTransactionByHash(txHash, chainId);
			return result;
		}

		async getCode(address: Hex, blockNumber?: Hex | BlockTag, chainId?: number): Promise<Buffer | null> {
			address = Hex.verifyAddress(address);
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getCode(address, blockNumber, chainId).then(Hex.removePrefix);
			return result === "" ? null : Buffer.from(result, "hex");
		}

		async getStorageAt(address: Hex, position: Hex, blockNumber?: Hex | BlockTag, chainId?: number): Promise<bigint> {
			address = Hex.verifyAddress(address);
			position = Hex.verify(position);
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.getStorageAt(address, position, blockNumber, chainId).then(Hex.removePrefix);
			return BigInt(result);
		}

		async call(request: SetFieldType<CallRequest, keyof CallRequest, Hex>, blockNumber?: Hex | BlockTag, chainId?: number): Promise<Buffer> {
			const req: CallRequest = {
				from: request.from ? Hex.verifyAddress(request.from) : undefined,
				to: Hex.verifyAddress(request.to),
				gas: request.gas ? Hex.verify(request.gas) : undefined,
				gasPrice: request.gasPrice ? Hex.verify(request.gasPrice) : undefined,
				value: request.value ? Hex.verify(request.value) : undefined,
				input: request.input ? Hex.verify(request.input) : undefined
			};
			blockNumber = this.#convertBlockNumber(blockNumber);
			const result = await this.#provider.call(req, blockNumber, chainId).then(Hex.removePrefix);
			return Buffer.from(result, "hex");
		}
	}
}