import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Transaction } from "./Transaction";


@Entity("Address")
export class Address {
	@PrimaryColumn("character", { length: 40 })
	address!: string;

	@Column("boolean", { name: "is_contract" })
	isContract!: boolean;

	@Column("text", { nullable: true })
	code?: string;

	@Column("integer", {
		name: "creation_block",
		nullable: true
	})
	creationBlock?: number;

	@Column("character", {
		name: "creation_tx_hash",
		length: 64, nullable: true
	})
	creationTxHash?: string;

	@Column("character", {
		length: 40,
		nullable: true
	})
	creator?: string;

	@Column("character", {
		name: "contract_factory",
		length: 40, nullable: true
	})
	contractFactory?: string;

	@ManyToOne(
		() => Transaction,
		t => t.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creation_tx_hash" })
	creationTransaction?: Transaction;

	@ManyToOne(
		() => Address,
		a => a.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creator" })
	creatorAddress?: Address;

	@ManyToOne(
		() => Address,
		{ persistence: false }
	)
	@JoinColumn({ name: "contract_factory" })
	contractFactoryAddress?: Address;

	@OneToMany(
		() => Address,
		a => a.creatorAddress,
		{ persistence: false }
	)
	createdContracts?: Address[];
}