import { Transform } from "class-transformer";
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex, CallType, Transformer } from "../../utils";
import { Transaction } from "./Transaction";
import type { EntityOnlyRelations, EntityWithRelations, FullEntity, RelationKeys } from "./types";


@Entity("CallTrace")
export class CallTrace {
	@PrimaryColumn("character", {
		name: "tx_hash",
		length: 64
	})
	txHash!: Hex.TxHashNP;

	@PrimaryColumn("integer")
	index!: number;

	@Column("smallint")
	depth?: number;

	@Column("integer", { name: "level_index" })
	levelIndex?: number;

	@Column("character", { length: 40 })
	from?: Hex.AddressNP;

	@Column("character", { length: 40, nullable: true })
	to?: Hex.AddressNP | null;

	@Column("enum", {
		enum: CallType,
		enumName: "CallType",
	})
	type?: CallType;

	@Transform(Transformer.bigint.nullable.fn)
	@Column("numeric", {
		precision: 31,
		scale: 0,
		nullable: true
	})
	value?: bigint | null;

	@Transform(Transformer.bigint.nullable.fn)
	@Column("bigint", { nullable: true })
	gas?: bigint | null;

	@Transform(Transformer.bigint.nullable.fn)
	@Column("bigint", { name: "gas_used", nullable: true })
	gasUsed?: bigint | null;

	@Column("bytea")
	input?: Buffer;

	@Column("bytea", { nullable: true })
	output?: Buffer | null;

	@Column("text", { nullable: true })
	error?: string | null;

	@Column("integer", {
		name: "parent_index",
		nullable: true
	})
	parentIndex?: number | null;

	@ManyToOne(
		() => Transaction,
		t => t.traces,
		{ persistence: false }
	)
	@JoinColumn(({ name: "tx_hash" }))
	transaction?: Transaction;

	@ManyToOne(
		() => CallTrace,
		t => t.children,
		{ persistence: false }
	)
	@JoinColumn([
		{ name: "tx_hash", referencedColumnName: "txHash" },
		{ name: "parent_index", referencedColumnName: "index" }
	])
	parent?: CallTrace | null;

	@OneToMany(
		() => CallTrace,
		t => t.parent,
		{ persistence: false }
	)
	children?: CallTrace[];

	get selector(): Hex.Selector | null | undefined {
		if (this.input === undefined || this.type === undefined)
			return undefined;
		if (this.input.length < 4)
			return null;
		if (this.type.endsWith("CALL") || this.type === CallType.CALLCODE)
			return ("0x" + this.input.toString("hex", 0, 4)) as Hex.Selector;
		return null;
	}

	get stack(): number[] | undefined {
		if (this.levelIndex === undefined)
			return undefined;
		const result: number[] = [this.levelIndex];
		let parent: CallTrace | null | undefined = this.parent;
		while (parent !== null) {
			if (parent?.levelIndex === undefined)
				return undefined;
			result.push(parent.levelIndex);
			parent = parent.parent;
		}
		return result.reverse();
	}

	get inputAsHex(): Hex.String | undefined {
		return this.input ? `0x${this.input.toString("hex")}` : undefined;
	}
	set inputAsHex(value: Hex) {
		value = Hex.toString(value);
		this.input = Buffer.from(Hex.removePrefix(value), "hex");
	}

	get outputAsHex(): Hex.String | null | undefined {
		return this.output == null ? this.output : `0x${this.output.toString("hex")}`;
	}
	set outputAsHex(value: Hex | null) {
		if (value == null)
			this.output = null;
		else {
			value = Hex.toString(value);
			this.output = Buffer.from(Hex.removePrefix(value), "hex");
		}
	}

	constructor();
	constructor(txHash: Hex.TxHash | Hex.TxHashNP, index: number);
	constructor(txHash?: Hex.TxHash | Hex.TxHashNP, index?: number) {
		if (txHash != null && index != null) {
			this.txHash = Hex.removePrefix(txHash);
			this.index = index;
		}
	}
}

export namespace CallTrace {
	export const relations = Object.freeze(["transaction", "parent", "children"]) satisfies RelationKeys<CallTrace>;
	export type Relations = typeof relations[number];
	export type Full = FullEntity<CallTrace, Relations>;
	export type WithRelations<T extends CallTrace.Relations, U extends CallTrace = CallTrace> = EntityWithRelations<CallTrace, T, U>;
	export type OnlyRelations<T extends CallTrace.Relations, U extends CallTrace = CallTrace> = EntityOnlyRelations<CallTrace, Relations, T, U>;
}