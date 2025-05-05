import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex } from "../../utils";
import { Transaction } from "./Transaction";
import type { Block } from "./Block";
import type { Blockchain } from "./Blockchain";

@Entity("Contract")
export class Contract {
	@PrimaryColumn("character", { length: 40 })
	address!: Hex.AddressNP;

	@Column("bytea", { nullable: true })
	code?: Buffer;

	@Column("character", {
		name: "creation_tx_hash",
		length: 64, nullable: true
	})
	creationTxHash!: Hex.TxHashNP;

	@Column("character", {
		length: 40,
		nullable: true
	})
	creator!: Hex.AddressNP;

	@Column("character", {
		name: "contract_factory",
		length: 40,
		nullable: true
	})
	contractFactory?: Hex.AddressNP;

	@ManyToOne(
		() => Transaction,
		t => t.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creation_tx_hash" })
	creationTransaction?: Transaction;

	@ManyToOne(
		() => Contract,
		a => a.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creator" })
	creatorAddress?: Contract;

	@ManyToOne(
		() => Contract,
		{ persistence: false }
	)
	@JoinColumn({ name: "contract_factory" })
	contractFactoryAddress?: Contract;

	@OneToMany(
		() => Contract,
		a => a.creatorAddress,
		{ persistence: false }
	)
	createdContracts?: Contract[];

	get blockchain(): Blockchain | undefined {
		return this.creationTransaction?.block?.blockchain;
	}

	get creationBlock(): Block | undefined {
		return this.creationTransaction?.block;
	}

	constructor();
	constructor(address: Hex.AddressNP | Hex.Address);
	constructor(address?: Hex.AddressNP | Hex.Address) {
		if (address !== undefined)
			this.address = Hex.removePrefix(address);
	}
}