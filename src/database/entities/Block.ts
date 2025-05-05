import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import type { Hex } from "../../utils";
import { Blockchain } from "./Blockchain";


@Entity("Block")
export class Block {
	@PrimaryColumn("integer")
	number!: number;

	@PrimaryColumn("integer", { name: "blockchain" })
	blockchainId!: number;

	@Column("character", { length: 64 })
	@Index({ unique: true })
	hash!: Hex.BlockHashNP;

	@Column("character", { length: 64, name: "parent_hash" })
	parentHash!: Hex.BlockHashNP;

	@Column("timestamp")
	timestamp!: Date;

	@Column("bigint", { name: "gas_limit" })
	gasLimit!: bigint;

	@Column("bigint", { name: "gas_used" })
	gasUsed!: bigint;

	@Column("bigint", { name: "base_fee_per_gas", nullable: true })
	baseFeePerGas?: bigint;

	@Column("character", { length: 40 })
	miner!: Hex.AddressNP;

	@Column("integer")
	size!: number;

	@ManyToOne(
		() => Blockchain,
		{ persistence: false }
	)
	@JoinColumn({ name: "blockchain", referencedColumnName: "id" })
	blockchain?: Blockchain;

	constructor();
	constructor(number: number, blockchainId: number);
	constructor(number?: number, blockchainId?: number) {
		if (number != undefined && blockchainId != undefined) {
			this.number = number;
			this.blockchainId = blockchainId;
		}
	}
}
