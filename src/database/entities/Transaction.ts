import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from "typeorm";
import { Hex } from "../../utils";
import { Chain } from "./Chain";
import { Contract } from "./Contract";
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
	hash!: Hex.TxHashNP;

	@Column("integer", { name: "chain" })
	chainId!: number;

	@Column("integer", { name: "block_number", nullable: true })
	blockNumber?: number;

	@Column("integer", { name: "block_index", nullable: true })
	blockIndex?: number;

	@Column("character", { length: 40 })
	sender!: Hex.AddressNP;

	@Column("character", { length: 40, nullable: true })
	receiver?: Hex.AddressNP;

	@Column("smallint", { name: "associated_attack", nullable: true })
	attackId?: number;

	@Column("enum", {
		enum: TransactionAction,
		enumName: "TransactionAction",
		nullable: true,
		array: true
	})
	actions?: Transaction.Action[];

	@ManyToOne(
		() => Chain,
		{ persistence: false }
	)
	@JoinColumn({ name: "chain" })
	chain?: Chain;

	@ManyToOne(
		() => Block,
		{ persistence: false }
	)
	@JoinColumn([
		{ name: "chain", referencedColumnName: "chainId" },
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
		() => Contract,
		a => a.creationTransaction,
		{ persistence: false }
	)
	createdContracts?: Contract[];

	get timestamp(): Date | undefined {
		return this.block?.timestamp;
	}

	constructor();
	constructor(txHash: Hex.TxHashNP | Hex.TxHash);
	constructor(txHash?: Hex.TxHashNP | Hex.TxHash) {
		if (txHash !== undefined)
			this.hash = Hex.removePrefix(txHash);
	}
}

export namespace Transaction {
	export const Action = TransactionAction;
	export type Action = TransactionAction;
}