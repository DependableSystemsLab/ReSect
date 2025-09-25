import { Exclude, Type } from "class-transformer";
import type { SetFieldType } from "type-fest";
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex } from "../../utils";
import { Chain } from "./Chain";
import { Contract } from "./Contract";
import { Block } from "./Block";
import { CallTrace } from "./CallTrace";
import { ReentrancyAttack } from "./ReentrancyAttack";
import type { EntityOnlyRelations, EntityWithRelations, FullEntity, RelationKeys } from "./types";

@Entity("Transaction")
export class Transaction {
	@PrimaryColumn("character", { length: 64 })
	hash!: Hex.TxHashNP;

	@Column("integer", { name: "chain" })
	@Index()
	chainId?: number;

	@Column("integer", { name: "block_number", nullable: true })
	@Index()
	blockNumber?: number | null;

	@Column("integer", { name: "block_index", nullable: true })
	blockIndex?: number | null;

	@Column("character", { length: 40 })
	sender?: Hex.AddressNP;

	@Column("character", { length: 40, nullable: true })
	receiver?: Hex.AddressNP | null;

	@Column("smallint", { name: "associated_attack", nullable: true })
	attackId?: number | null;

	@Column("integer", { default: 0 })
	tags?: Transaction.Tags;

	@Type(() => Chain)
	@ManyToOne(
		() => Chain,
		{ persistence: false }
	)
	@JoinColumn({ name: "chain" })
	chain?: Chain;

	@Type(() => Block)
	@ManyToOne(
		() => Block,
		{ persistence: false }
	)
	@JoinColumn([
		{ name: "chain", referencedColumnName: "chainId" },
		{ name: "block_number", referencedColumnName: "number" }
	])
	block?: Block | null;

	@Type(() => ReentrancyAttack)
	@ManyToOne(
		() => ReentrancyAttack,
		ra => ra.transactions,
		{ persistence: false }
	)
	@JoinColumn({ name: "associated_attack" })
	attack?: ReentrancyAttack | null;

	@Exclude()
	@OneToMany(
		() => CallTrace,
		trace => trace.transaction,
		{ persistence: false }
	)
	traces?: CallTrace[];

	@Exclude()
	@OneToMany(
		() => Contract,
		a => a.creationTransaction,
		{ persistence: false }
	)
	createdContracts?: Contract[];

	get timestamp(): Date | null | undefined {
		return this.block == null ? this.block : this.block.timestamp;
	}

	constructor();
	constructor(txHash: Hex.TxHashNP | Hex.TxHash);
	constructor(txHash?: Hex.TxHashNP | Hex.TxHash) {
		if (txHash !== undefined)
			this.hash = Hex.removePrefix(txHash);
	}

	hasTags(tag: Transaction.Tags): boolean {
		return (this.tags ?? 0 & tag) === tag;
	}
}

export namespace Transaction {
	export enum Tags {
		None = 0,
		VulnerableContractDeployment = 1 << 0,
		AttackContractDeployment = 1 << 1,
		AttackPreparation = 1 << 2,
		Exploit = 1 << 3,
		RandomlySelected = 1 << 4
	}

	export const relations = Object.freeze(["chain", "block", "attack", "traces", "createdContracts"]) satisfies RelationKeys<Transaction>;
	export type Relations = typeof relations[number];
	export type Full = FullEntity<Transaction, Relations>;
	export type WithRelations<T extends Transaction.Relations, U extends Transaction = Transaction> = EntityWithRelations<Transaction, T, U>;
	export type OnlyRelations<T extends Transaction.Relations, U extends Transaction = Transaction> = EntityOnlyRelations<Transaction, Relations, T, U>;

	export type WithAttack = OnlyRelations<"block" | "chain" | "attack", SetFieldType<Full, "attack", ReentrancyAttack>>;
}