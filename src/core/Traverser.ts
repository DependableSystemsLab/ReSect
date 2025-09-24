import "basic-type-extensions";
import { CallType, Counter, type DebugTrace, type MinimalTrace } from "../utils";
import type { AddressInfo, EOAInfo } from "./types";
import { inSameGroup } from "./functions";


export class Traverser<T extends MinimalTrace = MinimalTrace> {
	private readonly beforeCount = new Counter<AddressInfo>();
	private readonly afterCount = new Counter<AddressInfo>();
	private readonly currentStack: number[] = [];
	private sender!: EOAInfo;

	constructor(public readonly infos: Map<string, AddressInfo>) { }

	*#traverse(trace: DebugTrace<T>, senderContractDepth: number): Generator<number[]> {
		const to = this.infos.get(trace.to)!;
		if (!to.isContract)
			return;
		const from = this.infos.get(trace.from)!;
		const fromIsSender = inSameGroup(from, this.sender);
		// STATICCALL from sender-controlled contract is always benign
		if (fromIsSender && trace.type === CallType.STATICCALL)
			return;

		const reentrancyDetected = senderContractDepth !== -1
			&& this.beforeCount.enumerate().some(([addr, count]) => count > 0 && inSameGroup(addr, to));
		if (!(trace.calls?.length)) {
			if (reentrancyDetected)
				yield this.currentStack.slice();
			return;
		}

		// Found sender contract
		const toIsSender = inSameGroup(to, this.sender);
		const found = !fromIsSender && toIsSender;
		const newSenderContractDepth = found ? this.currentStack.length : senderContractDepth;

		let before: (() => void) | undefined;
		let after: (() => void) | undefined;
		if (!toIsSender) {
			const counter = senderContractDepth !== -1 ? this.afterCount : this.beforeCount;
			before = () => counter.increment(to);
			after = () => counter.decrement(to);
		}
		else if (found && senderContractDepth !== -1) {
			const clone = this.afterCount.clone();
			before = () => {
				this.beforeCount.add(clone);
				this.afterCount.clear();
			};
			after = () => {
				this.beforeCount.minus(clone);
				this.afterCount.add(clone);
			};
		}

		before?.();
		let reentrancyDetectedInCalls = false;
		for (let i = 0; i < trace.calls.length; i++) {
			this.currentStack.push(i);
			for (const result of this.#traverse(trace.calls[i], newSenderContractDepth)) {
				reentrancyDetectedInCalls = true;
				yield result;
			}
			this.currentStack.pop();
		}
		after?.();

		if (!reentrancyDetectedInCalls && reentrancyDetected)
			yield this.currentStack.slice();
	}

	#clear() {
		this.beforeCount.clear();
		this.afterCount.clear();
		this.currentStack.length = 0;
		this.sender = undefined!;
	}

	*traverse(callTrace: DebugTrace<T>): Generator<number[]> {
		this.#clear();
		this.sender = this.infos.get(callTrace.from)! as EOAInfo;
		yield* this.#traverse(callTrace, -1);
	}
}