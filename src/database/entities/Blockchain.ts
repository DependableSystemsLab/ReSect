import { Column, Entity, PrimaryColumn } from "typeorm";


@Entity("Blockchain")
export class Blockchain {
	@PrimaryColumn("integer")
	id!: number;

	@Column("character varying", { length: 64 })
	name!: string;

	@Column("smallint")
	layer!: number;

	@Column("character varying", { length: 8 })
	currency!: string;
}