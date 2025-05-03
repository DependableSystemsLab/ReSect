import "basic-type-extensions";
import type { CallTrace, DebugTrace, MinimalTrace } from "../providers";

export namespace TraceConverter {
	function compareCallTraces(a: CallTrace, b: CallTrace): number {
		const length = Math.max(a.traceAddress.length, b.traceAddress.length);
		for (let i = 0; i < length; i++) {
			const aIndex = a.traceAddress[i] ?? -1;
			const bIndex = b.traceAddress[i] ?? -1;
			if (aIndex < bIndex)
				return -1;
			if (aIndex > bIndex)
				return 1;
		}
		return 0;
	}

	/**
	 * Checks whether `b` is a valid direct successor of `a`.
	 * @param a `traceAddress` of the first call trace
	 * @param b `traceAddress` of the second call trace
	 */
	function verifyAdjacentTraceAddress(a: number[], b: number[]): boolean {
		if (b.length - a.length > 1)
			return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] === b[i])
				continue;
			if (b[i] === undefined)
				return false;
			return i === b.length - 1 && a[i] === b[i] - 1;
		}
		return a.length === b.length - 1 && b.last() === 0;
	}

	export function callTracesToDebugTrace<T extends MinimalTrace = MinimalTrace>(
		callTraces: CallTrace<T>[],
		verify: boolean = true,
		sort: boolean = false
	): DebugTrace<T> {
		if (sort)
			callTraces.sort(compareCallTraces);
		const { traceAddress, ...rest } = callTraces[0];
		if (traceAddress?.length)
			throw new Error("Invalid call traces: first traceAddress must be empty");
		const topTrace = rest as unknown as DebugTrace<T>;
		const stack = [[topTrace, traceAddress ?? []] as const];
		for (let i = 1; i < callTraces.length; i++) {
			const { traceAddress, ...rest } = callTraces[i];
			const last = stack.last();
			if (verify && !verifyAdjacentTraceAddress(last[1], traceAddress))
				throw new Error("Invalid array of call traces: traceAddress mismatch");
			const debugTrace = rest as unknown as DebugTrace<T>;
			const lengthDiff = traceAddress.length - last[1].length;
			if (lengthDiff > 1)
				throw new Error("Invalid array of call traces: traceAddress mismatch");
			if (lengthDiff === 1) {
				last[0].calls ??= [];
				last[0].calls.push(debugTrace);
			}
			else {
				for (let j = 0; j < lengthDiff + 1; j++)
					stack.pop();
				stack.last()[0].calls!.push(debugTrace);
			}
			stack.push([debugTrace, traceAddress]);
		}
		return topTrace;
	}
}