import { Address } from "./Address";
import { AttackStrategy } from "./AttackStrategy";
import { Blockchain } from "./Blockchain";
import { CallTrace } from "./CallTrace";
import { ReentrancyAttack } from "./ReentrancyAttack";
import { Transaction } from "./Transaction";
import { Block } from "./Block";

export const entities = Object.freeze([
	Address,
	AttackStrategy,
	Blockchain,
	Block,
	CallTrace,
	ReentrancyAttack,
	Transaction
]);

export * from "./Address";
export * from "./AttackStrategy";
export * from "./Blockchain";
export * from "./Block";
export * from "./CallTrace";
export * from "./ReentrancyAttack";
export * from "./Transaction";