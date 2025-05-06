import { IsNull } from "type-fest";
import { Block, Database, Transaction } from "../database";
import { Hex } from "../utils";
import type { RPC } from "./common";


type Provider = RPC.Provider & RPC.Debug.Provider;
export type IntegrationContext<K extends keyof Provider | null = keyof RPC.Provider> =
	& (IsNull<K> extends true ? {} : RPC.MultiChainProvider<Pick<Provider, NonNullable<K>>>)
	& {
		readonly db: Database;
	}

type RPCFuncWithChain<Target extends keyof Provider> =
	Provider[Target] extends (...args: infer P) => infer R
	? (...args: [...P, chain: number]) => R
	: never;

type IntegrationFunction<
	Target extends keyof Provider,
	Ctx extends keyof Provider | null = null
> = (
	this: IntegrationContext<Ctx>,
	original: RPCFuncWithChain<Target>,
	...args: Parameters<RPCFuncWithChain<Target>>
) => ReturnType<RPCFuncWithChain<Target>>

// TODO: if `blockNumber` is specified, the database result may be inaccurate
export const getCode: IntegrationFunction<
	"getCode"
> = async function (this, original, address, blockNumber, chain) {
	let code = await this.db.getCode(address);
	if (code !== null)
		return code;
	code = await original(address, blockNumber, chain);
	if (code !== null)
		await this.db.saveCode(address, code, chain);
	return code;
}

async function saveBlockIfNotExists(
	this: IntegrationContext<"getBlockByNumber">,
	blockNumber: Hex.String,
	chain: number
) {
	if (await this.db.has(Block, new Block(chain, Hex.toNumber(blockNumber))))
		return;
	const block = await this.getBlockByNumber(blockNumber, false, chain);
	if (block == null)
		throw new Error(`Block ${blockNumber} on chain ${chain} not found`);
	await this.db.saveBlock(block as RPC.Block, chain);
}

export const getTransactionByHash: IntegrationFunction<
	"getTransactionByHash",
	"getBlockByNumber"
> = async function (this, original, txHash, chain) {
	let result = await this.db.getTransaction(txHash);
	if (result)
		return result;
	result = await original(txHash, chain);
	if (result) {
		await saveBlockIfNotExists.call(this, result.blockNumber, chain);
		await this.db.saveTransaction(result, chain);
	}
	return result;
}

export const debugTraceTransaction: IntegrationFunction<
	"debugTraceTransaction",
	"getTransactionByHash" | "getBlockByNumber"
> = async function (this, original, txHash, options, chain) {
	let result = await this.db.getDebugTrace(txHash);
	if (result)
		return result;
	result = await original(txHash, options, chain);
	if (result) {
		if (!await this.db.has(Transaction, Hex.removePrefix(txHash))) {
			const tx = await this.getTransactionByHash(txHash, chain);
			if (tx == null)
				throw new Error(`Transaction ${txHash} not found`);
			await saveBlockIfNotExists.call(this, tx.blockNumber, chain);
			await this.db.saveTransaction(tx, chain);
		}
		await this.db.saveDebugTrace(result, txHash);
	}
	return result;
}