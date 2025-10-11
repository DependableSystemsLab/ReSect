import { Transform, Type } from "class-transformer";
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Transformer, type Hex } from "../../utils";
import { Chain } from "./Chain";
import type { EntityOnlyRelations, EntityWithRelations, FullEntity, RelationKeys } from "./types";


@Entity("Block")
export class Block {
	@PrimaryColumn("integer")
	number!: number;

	@PrimaryColumn("integer", { name: "chain" })
	chainId!: number;

	@Column("character", { length: 64 })
	@Index({ unique: true })
	hash?: Hex.BlockHashNP;

	@Column("character", { length: 64, name: "parent_hash" })
	parentHash?: Hex.BlockHashNP;

	@Column("timestamp")
	timestamp?: Date;

	@Transform(Transformer.bigint.fn)
	@Column("bigint", { name: "gas_limit" })
	gasLimit?: bigint;

	@Transform(Transformer.bigint.fn)
	@Column("bigint", { name: "gas_used" })
	gasUsed?: bigint;

	@Transform(Transformer.bigint.nullable.fn)
	@Column("bigint", { name: "base_fee_per_gas", nullable: true })
	baseFeePerGas?: bigint | null;

	@Column("character", { length: 40 })
	miner?: Hex.AddressNP;

	@Column("integer")
	size?: number;

	@Column("integer", { name: "transaction_count", nullable: true })
	transactionCount?: number | null;

	@Type(() => Chain)
	@ManyToOne(
		() => Chain,
		{ persistence: false }
	)
	@JoinColumn({ name: "chain" })
	chain?: Chain;

	constructor();
	constructor(number: number, chainId: number);
	constructor(number?: number, chainId?: number) {
		if (number != undefined && chainId != undefined) {
			this.number = number;
			this.chainId = chainId;
		}
	}
}

export namespace Block {
	export const relations = Object.freeze(["chain"]) satisfies RelationKeys<Block>;
	export type Relations = typeof relations[number];
	export type Full = FullEntity<Block, Relations>;
	export type WithRelations<T extends Block.Relations, U extends Block = Block> = EntityWithRelations<Block, T, U>;
	export type OnlyRelations<T extends Block.Relations, U extends Block = Block> = EntityOnlyRelations<Block, Relations, T, U>;
}