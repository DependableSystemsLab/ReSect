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
	output?: Hex.String;
}

export type CallTrace<T extends MinimalTrace = MinimalTrace> = T & {
	traceAddress: number[];
};

export type DebugTrace<T extends MinimalTrace = MinimalTrace> = T & {
	calls?: DebugTrace<T>[];
};

export type ReverseDebugTrace<T extends MinimalTrace = MinimalTrace> = T & {
	caller?: ReverseDebugTrace<T>;
};

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
};

export function verifyCallTypes<T extends TypeUnverifiedDebugTrace>(debugTrace: T): TypeVerifiedDebugTrace<T> {
	debugTrace.type = toCallType(debugTrace.type);
	if (debugTrace.calls?.length) {
		for (const call of debugTrace.calls)
			verifyCallTypes(call);
	}
	return debugTrace as TypeVerifiedDebugTrace<T>;
}

/**
 * Extracts the selector from a trace input.
 * @returns A 4-byte hex string representing the selector,
 * or `null` if the input is empty,
 * or `undefined` if the trace type is not a call type.
 */
export function extractSelector(input: Hex): Hex.Selector | null | undefined;
export function extractSelector(trace: { type: CallType, input: Hex; }): Hex.Selector | null | undefined;
export function extractSelector(param: Hex | { type: CallType, input: Hex; }): Hex.Selector | null | undefined {
	let { type, input: rawInput } = typeof param === "object" && "type" in param ? param : { input: param };
	if (type?.includes("CALL") !== true) // CALL, STATICCALL, DELEGATECALL, CALLCODE
		return undefined;
	const input = Hex.removePrefix(Hex.toString(rawInput));
	if (input === "") // Fallback
		return null;
	if (input.length < 8)
		throw new TypeError(`Invalid input: ${input}`);
	return `0x${input.slice(0, 8)}` as Hex.Selector;
}