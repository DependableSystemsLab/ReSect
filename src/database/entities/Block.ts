import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Blockchain } from "./Blockchain";


@Entity("Block")
export class Block {
	@PrimaryColumn("integer")
	number!: number;

	@PrimaryColumn("integer", { name: "blockchain" })
	blockchainId!: number;

	@Column("character", { length: 64 })
	@Index({ unique: true })
	hash!: string;

	@Column("character", { length: 64, name: "parent_hash" })
	parentHash!: string;

	@Column("timestamp")
	timestamp!: Date;

	@Column("bigint", { name: "gas_limit" })
	gasLimit!: bigint;

	@Column("bigint", { name: "gas_used" })
	gasUsed!: bigint;

	@Column("bigint", { name: "base_fee_per_gas", nullable: true })
	baseFeePerGas?: bigint;

	@Column("character", { length: 40 })
	miner!: string;

	@Column("integer")
	size!: number;

	@ManyToOne(
		() => Blockchain,
		{ persistence: false }
	)
	@JoinColumn({ name: "blockchain", referencedColumnName: "id" })
	blockchain?: Blockchain;
}
