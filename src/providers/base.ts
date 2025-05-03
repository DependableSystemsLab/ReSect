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
	traceTransaction(txHash: string): Promise<CallTrace<T>[]>;
}

export interface DebugTraceProvider<T extends MinimalTrace = MinimalTrace> {
	debugTraceTransaction(txHash: string): Promise<DebugTrace<T>>;
}

export abstract class DebugTraceProviderWithDatabase implements DebugTraceProvider<Trace> {
	protected constructor(protected readonly db: Database) { }

	protected abstract _debugTraceTransaction(txHash: string): Promise<DebugTrace<Trace>>;

	public async debugTraceTransaction(txHash: string): Promise<DebugTrace<Trace>> {
		let result = await this.db.getDebugTrace(txHash);
		if (result)
			return result;
		result = await this._debugTraceTransaction(txHash);
		await this.db.saveDebugTrace(result, txHash);
		return result;
	}
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