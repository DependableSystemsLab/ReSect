import { Block, Transaction } from "../database";
import { RPC } from "../providers";
import { Hex } from "../utils";

export namespace JsonRpcConverter {
	export function blockToEntity(block: RPC.Block, chainId: number): Block {
		const entity = new Block(Hex.toNumber(block.number), chainId);
		entity.hash = Hex.removePrefix(block.hash);
		entity.parentHash = Hex.removePrefix(block.parentHash);
		entity.timestamp = new Date(Hex.toNumber(block.timestamp) * 1000);
		entity.gasLimit = Hex.toBigInt(block.gasLimit);
		entity.gasUsed = Hex.toBigInt(block.gasUsed);
		if (block.baseFeePerGas !== undefined)
			entity.baseFeePerGas = Hex.toBigInt(block.baseFeePerGas);
		entity.miner = Hex.removePrefix(block.miner);
		entity.size = Hex.toNumber(block.size);
		return entity;
	}

	export function transactionToEntity(transaction: RPC.Transaction): Transaction {
		const entity = new Transaction(transaction.hash);
		entity.chainId = Hex.toNumber(transaction.chainId);
		entity.blockNumber = Hex.toNumber(transaction.blockNumber);
		entity.blockIndex = Hex.toNumber(transaction.transactionIndex);
		entity.sender = Hex.removePrefix(transaction.from);
		entity.receiver = Hex.removePrefix(transaction.to);
		if (entity.receiver === "")
			entity.receiver = null;
		return entity;
	}

	export function entityToTransaction(entity: Transaction): RPC.Transaction {
		const tx = {
			hash: Hex.addPrefix(entity.hash)
		} as RPC.Transaction;
		if (entity.chainId)
			tx.chainId = Hex.toString(entity.chainId);
		if (entity.blockNumber)
			tx.blockNumber = Hex.toString(entity.blockNumber);
		if (entity.blockIndex)
			tx.transactionIndex = Hex.toString(entity.blockIndex);
		if (entity.sender)
			tx.from = Hex.addPrefix(entity.sender);
		if (entity.receiver)
			tx.to = Hex.addPrefix(entity.receiver);
		if (entity.block?.hash)
			tx.blockHash = Hex.addPrefix(entity.block.hash);
		return tx;
	}
}