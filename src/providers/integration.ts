import { Block, Database, Transaction } from "../database";
import { Hex } from "../utils";
import type { DebugTraceProvider, RPC } from "./common";


export type DbExtensionContext = DebugTraceProvider<RPC.Debug.TraceInfo> & {
	readonly db: Database;
	readonly provider: RPC.MultiChainProvider;
}

export async function getDebugTraceWithDb(this: DbExtensionContext, txHash: Hex.TxHash, chain: number): Promise<RPC.Debug.Trace | null> {
	let result = await this.db.getDebugTrace(txHash);
	if (result)
		return result;
	result = await this.getDebugTrace(txHash);
	if (result) {
		if (!await this.db.has(Transaction, Hex.removePrefix(txHash))) {
			const tx = await this.provider.getTransactionByHash(txHash, chain);
			if (tx == null)
				throw new Error(`Transaction ${txHash} not found`);
			if (!await this.db.has(Block, new Block(chain, Hex.toNumber(tx.blockNumber)))) {
				const block = await this.provider.getBlockByNumber(tx.blockNumber, false, chain);
				if (block == null)
					throw new Error(`Block ${tx.blockHash} not found`);
				await this.db.saveBlock(block as RPC.Block, chain);
			}
			await this.db.saveTransaction(tx);
		}
		await this.db.saveDebugTrace(result, txHash);
	}
	return result;
}