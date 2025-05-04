import { Block, Transaction } from "../database";
import { RPC } from "../providers";
import { Hex } from "../utils";

export namespace JsonRpcConverter {
	export function blockToEntity(block: RPC.Block, chainId: number): Block {
		const entity = new Block();
		entity.number = Hex.toNumber(block.number);
		entity.blockchainId = chainId;
		entity.hash = Hex.removePrefix(block.hash);
		entity.parentHash = Hex.removePrefix(block.parentHash);
		entity.timestamp = new Date(Hex.toNumber(block.timestamp) * 1000);
		entity.gasLimit = Hex.toBigInt(block.gasLimit);
		entity.gasUsed = Hex.toBigInt(block.gasUsed);
		entity.baseFeePerGas = Hex.toBigInt(block.baseFeePerGas);
		entity.miner = Hex.removePrefix(block.miner);
		entity.size = Hex.toNumber(block.size);
		return entity;
	}

	export function transactionToEntity(transaction: RPC.Transaction): Transaction {
		const entity = new Transaction();
		entity.hash = Hex.removePrefix(transaction.hash);
		entity.blockchainId = Hex.toNumber(transaction.chainId);
		entity.blockNumber = Hex.toNumber(transaction.blockNumber);
		entity.blockIndex = Hex.toNumber(transaction.transactionIndex);
		entity.sender = Hex.removePrefix(transaction.from);
		entity.receiver = Hex.removePrefix(transaction.to);
		if (entity.receiver === "")
			entity.receiver = undefined;
		return entity;
	}
}