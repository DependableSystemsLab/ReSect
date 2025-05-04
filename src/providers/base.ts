import { Database } from "../database";

export enum CallType {
	CALL = "CALL",
	STATICCALL = "STATICCALL",
	DELEGATECALL = "DELEGATECALL",
	CALLCODE = "CALLCODE",
	CREATE = "CREATE",
	CREATE2 = "CREATE2",
	SELFDESTRUCT = "SELFDESTRUCT"
}

export interface MinimalTrace {
	from: string;
	to: string;
	type: CallType;
	input?: string;
	output?: string;
}

export interface Trace extends MinimalTrace {
	value: string;
	gas: string;
	gasUsed: string;
}

export type CallTrace<T extends MinimalTrace = MinimalTrace> = T & {
	traceAddress: number[];
}

export type DebugTrace<T extends MinimalTrace = MinimalTrace> = T & {
	calls?: DebugTrace<T>[];
}

export interface TraceProvider<T extends MinimalTrace = MinimalTrace> {
	getCallTraces(txHash: string): Promise<CallTrace<T>[]>;
}

export interface DebugTraceProvider<T extends MinimalTrace = MinimalTrace> {
	getDebugTrace(txHash: string): Promise<DebugTrace<T>>;
}

interface DbContext {
	readonly db: Database;
}

export async function getDebugTraceWithDb(this: DebugTraceProvider<Trace> & DbContext, txHash: string): Promise<DebugTrace<Trace>> {
	let result = await this.db.getDebugTrace(txHash);
	if (result)
		return result;
	result = await this.getDebugTrace(txHash);
	await this.db.saveDebugTrace(result, txHash);
	return result;
}

export namespace RPC {
	export interface Response<T = any> {
		id: number;
		jsonrpc: string;
		result: T;
	}

	export interface Error {
		error: {
			id: string;
			slug: string;
			message: string;
		}
	}
}