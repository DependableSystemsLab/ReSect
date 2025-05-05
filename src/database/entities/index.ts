import { Contract } from "./Contract";
import { AttackStrategy } from "./AttackStrategy";
import { Chain } from "./Chain";
import { CallTrace } from "./CallTrace";
import { ReentrancyAttack } from "./ReentrancyAttack";
import { Transaction } from "./Transaction";
import { Block } from "./Block";

export const entities = Object.freeze([
	Contract,
	AttackStrategy,
	Chain,
	Block,
	CallTrace,
	ReentrancyAttack,
	Transaction
]);

export * from "./Contract";
export * from "./AttackStrategy";
export * from "./Chain";
export * from "./Block";
export * from "./CallTrace";
export * from "./ReentrancyAttack";
export * from "./Transaction";