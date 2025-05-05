import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex, CallType } from "../../utils";
import { Transaction } from "./Transaction";


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
	depth!: number;

	@Column("character", { length: 40 })
	from!: Hex.AddressNP;

	@Column("character", { length: 40 })
	to!: Hex.AddressNP;

	@Column("enum", {
		enum: CallType,
		enumName: "CallType",
	})
	type!: CallType;

	@Column("numeric", { precision: 31, scale: 0 })
	value?: bigint;

	@Column("bigint")
	gas!: bigint;

	@Column("bigint", { name: "gas_used" })
	gasUsed!: bigint;

	@Column("bytea", { nullable: true })
	input!: Buffer;

	@Column("bytea", { nullable: true })
	output?: Buffer;

	@Column("text", { nullable: true })
	error?: string;

	@Column("integer", {
		name: "parent_index",
		nullable: true
	})
	parentIndex?: number;

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
	parent?: CallTrace;

	@OneToMany(
		() => CallTrace,
		t => t.parent,
		{ persistence: false }
	)
	children?: CallTrace[];

	get levelIndex(): number {
		return this.parentIndex === undefined
			? this.index
			: this.index - this.parentIndex - 1;
	}

	get selector(): Hex.Selector | undefined {
		if (this.input === undefined || this.input.length < 4)
			return undefined;
		if (this.type.endsWith("CALL") || this.type === CallType.CALLCODE)
			return ("0x" + this.input.toString("hex", 0, 4)) as Hex.Selector;
		return undefined;
	}

	get stack(): number[] {
		const result: number[] = [this.levelIndex];
		let parent: CallTrace | undefined = this.parent;
		while (parent) {
			result.push(parent.levelIndex);
			parent = parent.parent;
		}
		return result.reverse();
	}

	get inputAsHex(): Hex.String {
		return `0x${this.input.toString("hex")}`;
	}
	set inputAsHex(value: Hex) {
		value = Hex.toString(value);
		this.input = Buffer.from(Hex.removePrefix(value), "hex");
	}

	get outputAsHex(): Hex.String | undefined {
		if (this.output === undefined)
			return undefined;
		return `0x${this.output.toString("hex")}`;
	}
	set outputAsHex(value: Hex | undefined) {
		if (value === undefined)
			this.output = undefined;
		else {
			value = Hex.toString(value);
			this.output = Buffer.from(Hex.removePrefix(value), "hex");
		}
	}
}