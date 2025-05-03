export enum CallType {
	CALL = "CALL",
	STATICCALL = "STATICCALL",
	DELEGATECALL = "DELEGATECALL",
	CALLCODE = "CALLCODE",
	CREATE = "CREATE",
	CREATE2 = "CREATE2",
	SELFDESTRUCT = "SELFDESTRUCT"
}

export interface Trace {
	from: string;
	to: string;
	type: CallType;
	input?: string;
	output?: string;
}

export type CallTrace<T extends Trace = Trace> = T & {
	traceAddress: number[];
}

export type DebugTrace<T extends Trace = Trace> = T & {
	calls?: DebugTrace<T>[];
}

export interface TraceProvider<T extends Trace = Trace> {
	traceTransaction(txHash: string): Promise<CallTrace<T>[]>;
}

export interface DebugTraceProvider<T extends Trace = Trace> {
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