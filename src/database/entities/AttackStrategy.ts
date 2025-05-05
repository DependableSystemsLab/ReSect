import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";


@Entity("AttackStrategy")
export class AttackStrategy {
	@PrimaryGeneratedColumn("increment", { type: "smallint" })
	id!: number;

	@Column("character varying", { length: 64 })
	name!: string;

	@Column("smallint", { name: "parent", nullable: true })
	parentId?: number;

	@Column("text", { nullable: true })
	description?: string;

	@OneToMany(
		() => AttackStrategy,
		strategy => strategy.parentStrategy,
		{ persistence: false }
	)
	subStrategies!: AttackStrategy[];

	@ManyToOne(
		() => AttackStrategy,
		strategy => strategy.subStrategies,
		{ persistence: false }
	)
	@JoinColumn({ name: "parent" })
	parentStrategy?: AttackStrategy;
}