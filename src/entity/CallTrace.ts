import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { CallType } from "../providers";
import { Transaction } from "./Transaction";


@Entity("CallTrace")
export class CallTrace {
	@PrimaryColumn("character", {
		name: "tx_hash",
		length: 64
	})
	txHash!: string;

	@PrimaryColumn("integer")
	index!: number;

	@Column("smallint")
	depth!: number;

	@Column("integer", { name: "level_index" })
	levelIndex!: number;

	@Column("character", { length: 40 })
	from!: string;

	@Column("character", { length: 40 })
	to!: string;

	@Column("enum", {
		enum: CallType,
		enumName: "CallType",
	})
	type!: CallType;

	@Column("numeric", { precision: 31, scale: 0 })
	value!: bigint;

	@Column("bigint")
	gas!: bigint;

	@Column("bigint", { name: "gas_used" })
	gasUsed!: bigint;

	@Column("character", { length: 8, nullable: true })
	selector?: string;

	@Column("text", { nullable: true })
	parameters?: string;

	@Column("text", { nullable: true })
	output?: string;

	@Column("integer", {
		name: "parent_trace_index",
		nullable: true
	})
	parentTraceIndex?: number;

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
		{ name: "tx_hash", referencedColumnName: "tx_hash" },
		{ name: "parent_trace_index", referencedColumnName: "index" }
	])
	parent?: CallTrace;

	@OneToMany(
		() => CallTrace,
		t => t.parent,
		{ persistence: false }
	)
	children?: CallTrace[];

	get stack(): number[] {
		const result: number[] = [this.levelIndex];
		let parent: CallTrace | undefined = this.parent;
		while (parent) {
			result.push(parent.levelIndex);
			parent = parent.parent;
		}
		return result.reverse();
	}
}