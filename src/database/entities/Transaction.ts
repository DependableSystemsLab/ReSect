import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Address } from "./Address";
import { Block } from "./Block";
import { CallTrace } from "./CallTrace";
import { ReentrancyAttack } from "./ReentrancyAttack";


enum TransactionAction {
	VulnerableContractDeployment = "VulnerableContractDeployment",
	AttackContractDeployment = "AttackContractDeployment",
	AttackPreparation = "AttackPreparation",
	Exploit = "Exploit"
}

@Entity("Transaction")
export class Transaction {
	@PrimaryColumn("character", { length: 64 })
	hash!: string;

	@Column("integer", { name: "blockchain" })
	blockchainId!: number;

	@Column("integer", { name: "block_number" })
	blockNumber!: number;

	@Column("integer", { name: "block_index" })
	blockIndex!: number;

	@Column("character", { length: 40 })
	sender!: string;

	@Column("character", { length: 40, nullable: true })
	receiver?: string;

	@Column("integer", { name: "associated_attack" })
	attackId?: number;

	@Column("enum", {
		enum: TransactionAction,
		enumName: "TransactionAction",
		nullable: true,
		array: true
	})
	actions?: Transaction.Action[];

	@ManyToOne(
		() => Block,
		{ persistence: false }
	)
	@JoinColumn([
		{ name: "blockchain", referencedColumnName: "blockchainId" },
		{ name: "block_number", referencedColumnName: "number" }
	])
	block?: Block;

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

	get timestamp(): Date | undefined {
		return this.block?.timestamp;
	}
}

export namespace Transaction {
	export const Action = TransactionAction;
	export type Action = TransactionAction;
}