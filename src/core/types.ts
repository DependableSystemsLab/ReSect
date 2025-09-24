import "basic-type-extensions";
import { Hex, type DebugTrace, type MinimalTrace } from "../utils";
import { type abi } from "@shazow/whatsabi";


export interface ContractInfo {
	address: Hex.Address;
	isContract: true;
	code: Hex.String;
	creationBlock: number;
	creationTxHash: Hex.TxHash;
	creationTimestamp: number;
	creator: Hex.Address;
	contractFactory?: Hex.Address;
	author: Hex.Address | "GENESIS";
	abi: abi.ABI;
}

export interface EOAInfo {
	address: Hex.Address;
	isContract: false;
}

export type AddressInfo = ContractInfo | EOAInfo;

export enum Scope {
	SingleFunction,
	CrossFunction,
	CrossContract
}

export enum EntranceType {
	Fallback,
	MaliciousToken,
	ERCHook,
	Other
}

export enum Label {
	None = 0,
	VictimOut = 1 << 0,
	AttackerIn = 1 << 1,
	AttackerOut = 1 << 2,
	VictimIn = 1 << 3
}

export interface AnnotatedTraceInfo extends MinimalTrace {
	index: number;
	selector?: Hex.Selector | null;
	label?: Label;
}

export type AnnotatedTrace = DebugTrace<AnnotatedTraceInfo>;

export interface Entrance {
	type: EntranceType;
	trace: AnnotatedTraceInfo;
}

export class TraceNotFoundError extends Error {
	constructor(public readonly txHash: Hex.TxHash, message?: string) {
		super(message ?? `Debug trace for transaction ${txHash} not found`);
	}
}