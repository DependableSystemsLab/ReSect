import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Hex } from "../../utils";
import type { Block } from "./Block";
import { Chain } from "./Chain";
import { Transaction } from "./Transaction";


@Entity("Contract")
export class Contract {
	@PrimaryColumn("character", { length: 40 })
	address!: Hex.AddressNP;

	@PrimaryColumn("integer", { name: "chain_id" })
	chainId!: number;

	@Column("bytea", { nullable: true })
	code?: Buffer | null;

	@Column("character", {
		name: "creation_tx_hash",
		length: 64,
		nullable: true
	})
	@Index()
	creationTxHash?: Hex.TxHashNP | null;

	@Column("character", {
		length: 40,
		nullable: true
	})
	creator?: Hex.AddressNP | "GENESIS" | null;

	@Column("character", {
		name: "contract_factory",
		length: 40,
		nullable: true
	})
	contractFactory?: Hex.AddressNP | null;

	@ManyToOne(
		() => Chain,
		{ persistence: false }
	)
	@JoinColumn({ name: "chain_id" })
	chain?: Chain;

	@ManyToOne(
		() => Transaction,
		t => t.createdContracts,
		{ persistence: false }
	)
	@JoinColumn({ name: "creation_tx_hash" })
	creationTransaction?: Transaction | null;

	get creationBlock(): Block | null | undefined {
		return this.creationTransaction == null
			? this.creationTransaction
			: this.creationTransaction.block;
	}

	constructor();
	constructor(address: Hex.AddressNP | Hex.Address, chainId: number);
	constructor(address?: Hex.AddressNP | Hex.Address, chainId?: number) {
		if (address !== undefined && chainId !== undefined) {
			this.address = Hex.removePrefix(address);
			this.chainId = chainId;
		}
	}
}