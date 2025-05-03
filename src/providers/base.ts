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
	traceTransaction(txHash: string): Promise<CallTrace<T>[]>;
}

export interface DebugTraceProvider<T extends MinimalTrace = MinimalTrace> {
	debugTraceTransaction(txHash: string): Promise<DebugTrace<T>>;
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