import "basic-type-extensions";
import { CallTrace as Entity } from "../database";
import { Hex, type CallTrace, type DebugTrace, type MinimalTrace, type Trace } from "../utils";

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

	export function buildEntityHierarchy(entities: Entity[], sort: boolean = true): Entity[] {
		if (sort)
			entities.sortByKey(e => e.index);
		if (entities.some((e, i) => e.index !== i))
			throw new Error("Invalid array of call traces: index mismatch");
		for (const entity of entities) {
			if (entity.parentIndex === undefined)
				throw new Error("parentIndex not set");
			if (entity.parentIndex === null)
				continue;
			const parent = entities[entity.parentIndex];
			parent.children ??= [];
			entity.parent = parent;
			parent.children.push(entity);
		}
		return entities;
	}

	function _setEntityFromTrace(entity: Entity, trace: Trace): Entity {
		entity.from = Hex.removePrefix(trace.from);
		entity.to = Hex.removePrefix(trace.to);
		entity.type = trace.type;
		entity.inputAsHex = trace.input;
		entity.gas = Hex.toBigInt(trace.gas);
		entity.gasUsed = Hex.toBigInt(trace.gasUsed);
		if (trace.value)
			entity.value = Hex.toBigInt(trace.value);
		if (trace.output)
			entity.outputAsHex = trace.output;
		if (trace.error)
			entity.error = trace.error;
		return entity;
	}

	function _setTraceFromEntity(trace: Trace, entity: Entity): Trace {
		if (entity.from)
			trace.from = `0x${entity.from}`;
		if (entity.to)
			trace.to = `0x${entity.to}`;
		if (entity.type)
			trace.type = entity.type;
		if (entity.input)
			trace.input = entity.inputAsHex!;
		if (entity.gas)
			trace.gas = Hex.toString(entity.gas);
		if (entity.gasUsed)
			trace.gasUsed = Hex.toString(entity.gasUsed);
		if (entity.value)
			trace.value = Hex.toString(entity.value);
		if (entity.output)
			trace.output = `0x${entity.output.toString("hex")}`;
		if (entity.error)
			trace.error = entity.error;
		return trace;
	}

	function* _debugTraceToEntities(
		debugTrace: DebugTrace<Trace>,
		depth: number, levelIndex: number, parentIndex: number | null
	): Generator<Entity> {
		const trace = new Entity();
		trace.parentIndex = parentIndex;
		trace.index = parentIndex === null ? levelIndex : parentIndex + levelIndex + 1;
		trace.depth = depth;
		_setEntityFromTrace(trace, debugTrace);
		yield trace;
		if (debugTrace.calls?.length) {
			for (let i = 0; i < debugTrace.calls.length; i++) {
				const child = debugTrace.calls[i];
				yield* _debugTraceToEntities(child, depth + 1, i, trace.index);
			}
		}
	}

	export function debugTraceToEntities(debugTrace: DebugTrace<Trace>, txHash: Hex.String): Entity[] {
		const hash = Hex.removePrefix(Hex.verifyTxHash(txHash));
		const traces = Array.from(_debugTraceToEntities(debugTrace, 0, 0, null));
		for (const trace of traces)
			trace.txHash = hash;
		return traces;
	}

	export function entityToDebugTrace(entity: Entity): DebugTrace<Trace> {
		const trace = {} as DebugTrace<Trace>;
		_setTraceFromEntity(trace, entity);
		if (entity.children?.length)
			trace.calls = entity.children.map(entityToDebugTrace);
		return trace;
	}

	export function callTracesToEntities(callTraces: CallTrace<Trace>[], txHash: Hex.String, sort: boolean = true): Entity[] {
		const debugTrace = callTracesToDebugTrace(callTraces, true, sort);
		return debugTraceToEntities(debugTrace, txHash);
	}

	export function entitiesToCallTraces(entities: Entity[]): CallTrace<Trace>[] {
		entities = buildEntityHierarchy(entities);
		return entities.map(entity => {
			const trace = {} as CallTrace<Trace>;
			const stack = entity.stack;
			if (stack === undefined)
				throw new Error("Parent chain incomplete");
			trace.traceAddress = stack;
			_setTraceFromEntity(trace, entity);
			return trace;
		});
	}
}