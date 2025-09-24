import "basic-type-extensions";
import chalk from "chalk";
import { format as formatDate } from "date-fns";
import { extractSelector, type DebugTrace } from "../utils";
import { EntranceType, Label, type AddressInfo, type AnnotatedTrace, type Entrance } from "./types";


export function addressToString(addr: AddressInfo): string {
	if (!addr.isContract)
		return chalk`{grey [EOA]} {cyanBright ${addr.address}}`;
	const timestamp = formatDate(addr.creationTimestamp * 1000, "yyyy-MM-dd HH:mm:ss");
	return chalk`{grey [Contract]} {cyanBright ${addr.address}} <- {blue ${addr.creator}} ({magentaBright ${timestamp}})`;
}

export function inSameGroup(addrA: AddressInfo, addrB: AddressInfo): boolean {
	const creatorA = addrA.isContract ? addrA.author : addrA.address;
	const creatorB = addrB.isContract ? addrB.author : addrB.address;
	return creatorA === creatorB;
}

export function toTraceList<T extends DebugTrace = DebugTrace>(trace: T, indices: number[]): T[] {
	const result = new Array<T>(indices.length + 1);
	result[0] = trace;
	let current = trace;
	for (let i = 0; i < indices.length; i++) {
		const index = indices[i];
		if (!(current.calls?.length) || index < 0 || index >= current.calls.length)
			throw new Error(`Invalid index ${index} for call trace`);
		const next = current.calls[index];
		current = result[i + 1] = next as T;
	}
	return result;
}

export function entranceToString({ type, trace }: Entrance): string {
	let str = chalk`{red [${EntranceType[type]}]} {inverse ${trace.type}}: {cyanBright ${trace.from}} -> {cyanBright ${trace.to}}`;
	const selector = extractSelector(trace);
	if (selector !== undefined)
		str += chalk` ({yellowBright ${selector ?? "fallback"}})`;
	return str;
}

export function hasLabel(trace: AnnotatedTrace, label: Label): boolean {
	if (trace.label === undefined)
		return false;
	return (trace.label & label) !== 0;
}
export function setLabel(trace: AnnotatedTrace, label: Label) {
	trace.label = (trace.label ?? Label.None) | label;
}