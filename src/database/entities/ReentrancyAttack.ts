import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { AttackStrategy } from "./AttackStrategy";
import { Transaction } from "./Transaction";


enum ReentrancyType {
	Attack = "Attack",
	WhitehatAttack = "Whitehat Attack",
	RugPull = "Rug Pull"
}

enum ReentrancyEntryPoint {
	Fallback = "Fallback",
	MaliciousToken = "Malicious Token",
	ERCHook = "ERC Hook",
	ApplicationHook = "Application Hook"
}

enum ReentrancyScope {
	SingleFunction = "Single Function",
	CrossFunction = "Cross Function",
	CrossContract = "Cross Contract",
	CrossProject = "Cross Project",
	CrossChain = "Cross Chain"
}

@Entity("ReentrancyAttack")
export class ReentrancyAttack {
	@PrimaryColumn("integer")
	id!: number;

	@Column("text")
	name!: string;

	@Column("enum", {
		enum: ReentrancyType,
		enumName: "AttackType",
	})
	type!: ReentrancyAttack.Type;

	@Column("money", { nullable: true })
	loss?: number;

	@Column("enum", {
		enum: ReentrancyScope,
		enumName: "ReentrancyScope",
		nullable: true
	})
	scope?: ReentrancyAttack.Scope;

	@Column("enum", {
		name: "entry_point",
		enum: ReentrancyEntryPoint,
		enumName: "EntryPoint",
		nullable: true
	})
	entryPoint?: ReentrancyAttack.EntryPoint;

	@Column("integer", { name: "erc_standard", nullable: true })
	ercStandard?: number;

	@Column("integer", { name: "strategy", nullable: true })
	strategyId?: number;

	@Column("text", { nullable: true })
	origin?: string;

	@ManyToOne(
		() => AttackStrategy,
		{ persistence: false }
	)
	@JoinColumn({ name: "strategy" })
	strategy?: AttackStrategy;

	@OneToMany(
		() => Transaction,
		transaction => transaction.attack,
		{ persistence: false }
	)
	transactions!: Transaction[];
}

export namespace ReentrancyAttack {
	export const Type = ReentrancyType;
	export const EntryPoint = ReentrancyEntryPoint;
	export const Scope = ReentrancyScope;

	export type Type = ReentrancyType;
	export type EntryPoint = ReentrancyEntryPoint;
	export type Scope = ReentrancyScope;
}