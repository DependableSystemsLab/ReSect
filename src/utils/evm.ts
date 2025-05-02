import { CallType } from "src/providers/base.js";
import { type Hex, removeHexPrefix, hexToString } from "./hex.js";

export function splitInput(input: Hex): [selector?: string, parameter?: string] {
	input = removeHexPrefix(hexToString(input));
	if (input === "")
		return [undefined, undefined];
	if (input.length < 8)
		throw new TypeError(`Invalid input: ${input}`);
	return input.length == 8
		? ["0x" + input, undefined]
		: ["0x" + input.substring(0, 8), "0x" + input.substring(8)];
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