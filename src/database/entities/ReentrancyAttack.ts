import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
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
	@PrimaryGeneratedColumn("increment", { type: "smallint" })
	id!: number;

	@Column("text")
	name?: string;

	@Column("enum", {
		enum: ReentrancyType,
		enumName: "AttackType",
	})
	type?: ReentrancyAttack.Type;

	@Column("money", { nullable: true })
	loss?: number | null;

	@Column("enum", {
		enum: ReentrancyScope,
		enumName: "ReentrancyScope",
		nullable: true
	})
	scope?: ReentrancyAttack.Scope | null;

	@Column("enum", {
		name: "entry_point",
		enum: ReentrancyEntryPoint,
		enumName: "EntryPoint",
		nullable: true
	})
	entryPoint?: ReentrancyAttack.EntryPoint | null;

	@Column("integer", { name: "erc_standard", nullable: true })
	ercStandard?: number | null;

	@Column("integer", { name: "strategy", nullable: true })
	strategyId?: number | null;

	@Column("text", { nullable: true })
	origin?: string | null;

	@ManyToOne(
		() => AttackStrategy,
		{ persistence: false }
	)
	@JoinColumn({ name: "strategy" })
	strategy?: AttackStrategy | null;

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