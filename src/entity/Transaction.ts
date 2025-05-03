import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Blockchain } from "./Blockchain";
import { ReentrancyAttack } from "./ReentrancyAttack";
import { CallTrace } from "./CallTrace";
import { Address } from "./Address";


@Entity("Transaction")
export class Transaction {
	@PrimaryColumn("character", { length: 64 })
	hash!: string;

	@Column("integer", { name: "blockchain" })
	blockchainId!: number;

	@Column("timestamp")
	timestamp!: Date;

	@Column("character", { length: 40 })
	sender!: string;

	@Column("character", { length: 40, nullable: true })
	receiver?: string;

	@Column("integer", { name: "associated_attack" })
	attackId!: number;

	@Column("enum", {
		enum: Transaction.Action,
		enumName: "TransactionAction",
		nullable: true,
		array: true
	})
	actions?: Transaction.Action[];

	@ManyToOne(
		() => Blockchain,
		{ persistence: false }
	)
	@JoinColumn({ name: "blockchain" })
	blockchain?: Blockchain;

	@ManyToOne(
		() => ReentrancyAttack,
		ra => ra.transactions,
		{ persistence: false }
	)
	@JoinColumn({ name: "associated_attack" })
	attack?: ReentrancyAttack;

	@OneToMany(
		() => CallTrace,
		trace => trace.transaction,
		{ persistence: false }
	)
	traces?: CallTrace[];

	@OneToMany(
		() => Address,
		a => a.creationTransaction,
		{ persistence: false }
	)
	createdContracts?: Address[];
}

export namespace Transaction {
	export enum Action {
		VulnerableContractDeployment = "VulnerableContractDeployment",
		AttackContractDeployment = "AttackContractDeployment",
		AttackPreparation = "AttackPreparation",
		Exploit = "Exploit"
	}
}