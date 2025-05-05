import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex } from "../../utils";
import type { Block } from "./Block";
import type { Chain } from "./Chain";
import { Transaction } from "./Transaction";


@Entity("Contract")
export class Contract {
	@PrimaryColumn("character", { length: 40 })
	address!: Hex.AddressNP;

	@Column("bytea", { nullable: true })
	code?: Buffer | null;

	@Column("character", {
		name: "creation_tx_hash",
		length: 64,
		nullable: true
	})
	creationTxHash?: Hex.TxHashNP | null;

	@Column("character", {
		length: 40,
		nullable: true
	})
	creator?: Hex.AddressNP | null;

	@Column("character", {
		name: "contract_factory",
		length: 40,
		nullable: true
	})
	contractFactory?: Hex.AddressNP | null;

	@ManyToOne(
		() => Transaction,
		t => t.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creation_tx_hash" })
	creationTransaction?: Transaction | null;

	@ManyToOne(
		() => Contract,
		{ persistence: false }
	)
	@JoinColumn({ name: "contract_factory" })
	contractFactoryAddress?: Contract | null;

	get chain(): Chain | undefined {
		return this.creationTransaction?.block?.chain;
	}

	get creationBlock(): Block | null | undefined {
		return this.creationTransaction == null
			? this.creationTransaction
			: this.creationTransaction.block;
	}

	constructor();
	constructor(address: Hex.AddressNP | Hex.Address);
	constructor(address?: Hex.AddressNP | Hex.Address) {
		if (address !== undefined)
			this.address = Hex.removePrefix(address);
	}
}