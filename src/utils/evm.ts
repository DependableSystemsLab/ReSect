import { Hex } from "./hex";

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
	from: Hex.Address;
	to: Hex.Address;
	type: CallType;
	input: Hex.String;
}

export type CallTrace<T extends MinimalTrace = MinimalTrace> = T & {
	traceAddress: number[];
}

export type DebugTrace<T extends MinimalTrace = MinimalTrace> = T & {
	calls?: DebugTrace<T>[];
}

export function toCallType(type: string): CallType {
	type = type.toUpperCase();
	if (type in CallType)
		return CallType[type as keyof typeof CallType];
	if (type === "SUICIDE")
		return CallType.SELFDESTRUCT;
	throw new TypeError(`Invalid call type: ${type}`);
}

interface TypeUnverifiedDebugTrace {
	type: string;
	calls?: TypeUnverifiedDebugTrace[];
}

export type TypeVerifiedDebugTrace<T extends TypeUnverifiedDebugTrace> = Omit<T, "type" | "calls"> & {
	type: CallType;
	calls?: TypeVerifiedDebugTrace<T>[];
}

export function verifyCallTypes<T extends TypeUnverifiedDebugTrace>(debugTrace: T): TypeVerifiedDebugTrace<T> {
	debugTrace.type = toCallType(debugTrace.type);
	if (debugTrace.calls?.length) {
		for (const call of debugTrace.calls)
			verifyCallTypes(call);
	}
	return debugTrace as TypeVerifiedDebugTrace<T>;
}

export function extractSelector(trace: { type: CallType, input: Hex }): string | undefined {
	const input = Hex.removePrefix(Hex.toString(trace.input));
	if (input === "" || !trace.type.startsWith("CALL") && trace.type !== CallType.CALLCODE)
		return undefined;
	if (input.length < 8)
		throw new TypeError(`Invalid input: ${input}`);
	return `0x${input.slice(0, 8)}`;
}