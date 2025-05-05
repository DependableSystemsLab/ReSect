import { Contract } from "../database";
import { Etherscan } from "../providers";
import { Hex } from "../utils";

export namespace EtherscanConverter {
	export function contractCreationToEntity(creation: Etherscan.ContractCreation): Contract {
		const entity = new Contract();
		entity.address = creation.contractAddress;
		entity.creationTxHash = Hex.removePrefix(creation.txHash);
		entity.creator = Hex.removePrefix(creation.contractCreator);
		const factory = Hex.removePrefix(creation.contractFactory);
		if (factory !== "")
			entity.contractFactory = factory;
		return entity;
	}

	export function entityToContractCreation(entity: Contract): Etherscan.ContractCreation {
		const creation = {
			contractAddress: `0x${entity.address}`
		} as Etherscan.ContractCreation;
		if (entity.creationTxHash)
			creation.txHash = `0x${entity.creationTxHash}`;
		if (entity.creator)
			creation.contractCreator = `0x${entity.creator}`;
		if (entity.contractFactory)
			creation.contractFactory = `0x${entity.contractFactory}`;
		const block = entity.creationBlock;
		if (block) {
			creation.blockNumber = block.number.toString();
			creation.timestamp = (block.timestamp.getTime() / 1000).toString();
		}
		return creation;
	}
}