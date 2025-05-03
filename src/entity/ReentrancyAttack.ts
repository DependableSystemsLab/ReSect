import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { AttackStrategy } from "./AttackStrategy";
import { Transaction } from "./Transaction";


@Entity("ReentrancyAttack")
export class ReentrancyAttack {
	@PrimaryColumn("integer")
	id!: number;

	@Column("text")
	name!: string;

	@Column("enum", {
		enum: ReentrancyAttack.Type,
		enumName: "AttackType",
	})
	type!: ReentrancyAttack.Type;

	@Column("money", { nullable: true })
	loss?: number;

	@Column("enum", {
		enum: ReentrancyAttack.Scope,
		enumName: "ReentrancyScope",
		nullable: true
	})
	scope?: ReentrancyAttack.Scope;

	@Column("enum", {
		name: "entry_point",
		enum: ReentrancyAttack.EntryPoint,
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
	export enum Type {
		Attack = "Attack",
		WhitehatAttack = "Whitehat Attack",
		RugPull = "Rug Pull"
	}

	export enum EntryPoint {
		Fallback = "Fallback",
		MaliciousToken = "Malicious Token",
		ERCHook = "ERC Hook",
		ApplicationHook = "Application Hook"
	}

	export enum Scope {
		SingleFunction = "Single Function",
		CrossFunction = "Cross Function",
		CrossContract = "Cross Contract",
		CrossProject = "Cross Project",
		CrossChain = "Cross Chain"
	}
}