import { type Hex, removeHexPrefix, hexToString } from "./hex.js";

export function parseInput(input: Hex): [selector?: string, parameter?: string] {
	input = removeHexPrefix(hexToString(input));
	if (input === "")
		return [undefined, undefined];
	if (input.length < 8)
		throw new TypeError(`Invalid input: ${input}`);
	return input.length == 8
		? ["0x" + input, undefined]
		: ["0x" + input.substring(0, 8), "0x" + input.substring(8)];
}

export enum CallType {
	CALL = "CALL",
	STATICCALL = "STATICCALL",
	DELEGATECALL = "DELEGATECALL",
	CREATE = "CREATE",
	CREATE2 = "CREATE2"
}