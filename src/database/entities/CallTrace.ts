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
	depth?: number;

	@Column("character", { length: 40 })
	from?: Hex.AddressNP;

	@Column("character", { length: 40 })
	to?: Hex.AddressNP;

	@Column("enum", {
		enum: CallType,
		enumName: "CallType",
	})
	type?: CallType;

	@Column("numeric", {
		precision: 31,
		scale: 0,
		nullable: true
	})
	value?: bigint | null;

	@Column("bigint")
	gas?: bigint;

	@Column("bigint", { name: "gas_used" })
	gasUsed?: bigint;

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

	get levelIndex(): number | undefined {
		return this.parentIndex === undefined ? undefined
			: this.parentIndex === null ? this.index
				: this.index - this.parentIndex - 1;
	}

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
		const levelIdx = this.levelIndex;
		if (levelIdx === undefined)
			return undefined;
		const result: number[] = [levelIdx];
		let parent: CallTrace | null | undefined = this.parent;
		while (parent) {
			const levelIdx = parent.levelIndex;
			if (levelIdx === undefined)
				return undefined;
			result.push(levelIdx);
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
}