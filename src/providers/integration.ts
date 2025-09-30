import { IsNull } from "type-fest";
import { Block, Database, Transaction } from "../database";
import { Hex } from "../utils";
import type { RPC } from "./common";


type Provider = RPC.Provider & RPC.Debug.Provider & RPC.Trace.Provider;
export type IntegrationContext<K extends keyof Provider | null = keyof RPC.Provider> =
	& (IsNull<K> extends true ? {} : RPC.MultiChainProvider<Pick<Provider, NonNullable<K>>>)
	& {
		readonly db: Database;
	};

type RPCFuncWithChain<Target extends keyof Provider> =
	Provider[Target] extends (...args: infer P) => infer R
	? (...args: [...P, chain: number]) => R
	: never;


async function saveBlockIfNotExists(
	this: any,
	database: Database,
	blockNumber: Hex.String,
	chain: number
) {
	if (typeof this.getBlockByNumber !== "function")
		throw new IntegrationError(`Method getBlockByNumber not found`);
	if (await database.has(Block, new Block(chain, Hex.toNumber(blockNumber))))
		return;
	const block = await this.getBlockByNumber(blockNumber, false, chain);
	if (block == null)
		throw new Error(`Block ${blockNumber} on chain ${chain} not found`);
	await database.saveBlock(block as RPC.Block, chain);
}

async function saveTransactionIfNotExists(
	this: any,
	database: Database,
	txHash: Hex.String,
	chain: number
) {
	if (typeof this.getTransactionByHash !== "function")
		throw new IntegrationError(`Method getTransactionByHash not found`);
	if (await database.has(Transaction, Hex.removePrefix(txHash)))
		return;
	const tx = await this.getTransactionByHash(txHash, chain);
	if (tx == null)
		throw new Error(`Transaction ${txHash} not found`);
	await saveBlockIfNotExists.call(this, database, tx.blockNumber, chain);
	await database.saveTransaction(tx, chain);
}

export class IntegrationError extends Error { }

export interface IntegrationOptions {
	method?: keyof Provider;
	read?: boolean;
	write?: boolean;
	defaultChain?: number | (() => number);
}

export function integration(
	database: Database | (() => Database | null | undefined) = function (this: any) { return this.db; },
	{ method, read = true, write = true, defaultChain = function (this: any) { return this.chain; } }: IntegrationOptions = {}
): MethodDecorator {
	const getDatabase = typeof database !== "function"
		? () => database
		: function (this: any) {
			const db = database.call(this);
			if (db == null)
				return null;
			if (!(db instanceof Database))
				throw new IntegrationError(`Function doesn't return a Database instance`);
			return db;
		};
	const getDefaultChain = typeof defaultChain !== "function"
		? () => {
			if (defaultChain === undefined)
				throw new IntegrationError(`Default chain is not specified`);
			return defaultChain;
		}
		: function (this: any) {
			const chain = defaultChain.call(this);
			if (typeof chain !== "number")
				throw new IntegrationError(`Default chain is not ${chain === undefined ? "specified" : "a number"}`);
			return chain;
		};
	return function (target, propertyKey, descriptor) {
		const original = descriptor.value;
		if (typeof original !== "function")
			throw new IntegrationError(`@integration can only be applied to methods`);
		const rpcMethod = method ?? propertyKey as keyof Provider;
		switch (rpcMethod) {
			// TODO: if `blockNumber` is specified, the database result may be inaccurate
			case "getCode": {
				descriptor.value = async function (this: any, ...args: Parameters<RPCFuncWithChain<"getCode">>) {
					const db = getDatabase.call(this);
					if (db == null)
						return original.call(this, ...args);
					const [address, blockNumber, chain = getDefaultChain()] = args;
					let code: Hex.String | null;
					if (read) {
						code = await db.getCode(address);
						if (code !== null)
							return code;
					}
					code = await original.call(this, address, blockNumber, chain);
					if (write && code !== null)
						await db.saveCode(address, code, chain);
					return code;
				} as any;
				break;
			}
			case "getTransactionByHash": {
				descriptor.value = async function (this: any, ...args: Parameters<RPCFuncWithChain<"getTransactionByHash">>) {
					const db = getDatabase.call(this);
					if (db == null)
						return original.call(this, ...args);
					const [txHash, chain = getDefaultChain()] = args;
					let tx: RPC.Transaction | null;
					if (read) {
						tx = await db.getTransaction(txHash);
						if (tx !== null)
							return tx;
					}
					tx = await original.call(this, txHash, chain);
					if (write && tx !== null) {
						await saveBlockIfNotExists.call(this, db, tx.blockNumber, chain);
						await db.saveTransaction(tx, chain);
					}
					return tx;
				} as any;
				break;
			}
			case "traceTransaction": {
				descriptor.value = async function (this: any, ...args: Parameters<RPCFuncWithChain<"traceTransaction">>) {
					const db = getDatabase.call(this);
					if (db == null)
						return original.call(this, ...args);
					const [txHash, chain = getDefaultChain()] = args;
					let traces: RPC.Trace.Trace[] | null;
					if (read) {
						traces = await db.getCallTraces(txHash);
						if (traces !== null)
							return traces;
					}
					traces = await original.call(this, txHash, chain);
					if (write && traces !== null) {
						await saveTransactionIfNotExists.call(this, db, txHash, chain);
						await db.saveCallTraces(traces, txHash);
					}
					return traces;
				} as any;
				break;
			}
			case "debugTraceTransaction": {
				descriptor.value = async function (this: any, ...args: Parameters<RPCFuncWithChain<"debugTraceTransaction">>) {
					const db = getDatabase.call(this);
					if (db == null)
						return original.call(this, ...args);
					const [txHash, options, chain = getDefaultChain()] = args;
					let trace: RPC.Debug.Trace | null;
					if (read) {
						trace = await db.getDebugTrace(txHash);
						if (trace !== null)
							return trace;
					}
					trace = await original.call(this, txHash, options, chain);
					if (write && trace !== null) {
						await saveTransactionIfNotExists.call(this, db, txHash, chain);
						await db.saveDebugTrace(trace, txHash);
					}
					return trace;
				} as any;
				break;
			}
			default:
				throw new IntegrationError(`Method ${String(rpcMethod)} is not supported for integration`);
		}
	};
}