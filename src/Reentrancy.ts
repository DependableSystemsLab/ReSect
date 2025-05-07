import "basic-type-extensions";
import { format as formatDate } from "date-fns";
import { Etherscan, type RPC, type DebugTraceProvider } from "./providers";
import { CallType, Counter, Hex, extractSelector, type DebugTrace, type MinimalTrace } from "./utils";

export namespace Reentrancy {
	interface ContractInfo {
		address: string;
		isContract: true;
		code: string;
		creationBlock: number;
		creationTxHash: string;
		creationTimestamp: number;
		creator: string;
		contractFactory?: string;
	}

	interface EOAInfo {
		address: string;
		isContract: false;
	}

	type AddressInfo = ContractInfo | EOAInfo;

	function addressToString(addr: AddressInfo): string {
		if (!addr.isContract)
			return `[EOA] ${addr.address}`;
		const timestamp = formatDate(addr.creationTimestamp * 1000, "yyyy-MM-dd HH:mm:ss");
		return `[Contract] ${addr.address} <- ${addr.creator} (${timestamp})`;
	}

	class Traverser<T extends MinimalTrace = MinimalTrace> {
		private readonly beforeCount = new Counter();
		private readonly afterCount = new Counter();
		private readonly currentStack: number[] = [];
		private sender!: EOAInfo;

		constructor(public readonly infos: Map<string, AddressInfo>) { }

		*#traverse(trace: DebugTrace<T>, senderContractDepth: number): Generator<[DebugTrace<T>, number[]]> {
			const to = this.infos.get(trace.to)!;
			if (!to.isContract)
				return;
			const from = this.infos.get(trace.from)!;
			const fromIsSender = Analyzer.inSameGroup(from, this.sender);
			// STATICCALL from sender-controlled contract is always benign
			if (fromIsSender && trace.type === CallType.STATICCALL)
				return;

			const reentrancyDetected = senderContractDepth != -1 && this.beforeCount.get(to.creator);
			if (!(trace.calls?.length)) {
				if (reentrancyDetected)
					yield [trace, this.currentStack.slice()];
				return;
			}

			// Found sender contract
			const toIsSender = Analyzer.inSameGroup(to, this.sender);
			const found = !fromIsSender && toIsSender;
			const newSenderContractDepth = found ? this.currentStack.length : senderContractDepth;

			let before: (() => void) | undefined;
			let after: (() => void) | undefined;
			if (!toIsSender) {
				const counter = senderContractDepth != -1 ? this.afterCount : this.beforeCount;
				before = () => counter.increment(to.creator);
				after = () => counter.decrement(to.creator);
			}
			else if (found && senderContractDepth !== -1) {
				const clone = this.afterCount.clone();
				before = () => {
					this.beforeCount.add(clone);
					this.afterCount.clear();
				}
				after = () => {
					this.beforeCount.minus(clone);
					this.afterCount.add(clone);
				}
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
				yield [trace, this.currentStack.slice()];
		}

		#clear() {
			this.beforeCount.clear();
			this.afterCount.clear();
			this.currentStack.length = 0;
			this.sender = undefined!;
		}

		*traverse(callTrace: DebugTrace<T>): Generator<[DebugTrace<T>, number[]]> {
			this.#clear();
			this.sender = this.infos.get(callTrace.from)! as EOAInfo;
			yield* this.#traverse(callTrace, -1);
		}
	}

	function toTraceList<T extends DebugTrace = DebugTrace>(trace: T, indices: number[]): T[] {
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

	export enum Scope {
		SingleFunction,
		CrossFunction,
		CrossContract
	}

	export enum EntryPoint {
		Fallback,
		MaliciousToken,
		ERCHook,
		Other
	}

	export enum Label {
		None = 0,
		VictimOut = 1 << 0,
		AttackerIn = 1 << 1,
		AttackerOut = 1 << 2,
		VictimIn = 1 << 3
	}

	interface AnnotatedTraceInfo extends MinimalTrace {
		index: number;
		label?: Label;
	}

	export type AnnotatedTrace = DebugTrace<AnnotatedTraceInfo>;

	function hasLabel(trace: AnnotatedTrace, label: Label): boolean {
		if (trace.label === undefined)
			return false;
		return (trace.label & label) !== 0;
	}
	function setLabel(trace: AnnotatedTrace, label: Label) {
		trace.label = (trace.label ?? Label.None) | label;
	}

	export interface AnalysisResult {
		readonly: boolean;
		scope: Scope;
		entryPoint: EntryPoint;
		attackers: AddressInfo[];
		victims: AddressInfo[];
		rootTrace: AnnotatedTrace;
		reTrace: AnnotatedTrace;
		reStack: number[];
	}

	export class Analyzer {
		readonly #rpcProvider: RPC.MultiChainProvider;
		readonly #addrInfos = new Map<Hex.Address, AddressInfo>();

		constructor(
			readonly etherscan: Etherscan,
			readonly debugProvider: DebugTraceProvider,
			rpcProvider?: RPC.MultiChainProvider
		) {
			this.#rpcProvider = rpcProvider ??= etherscan.geth;
		}

		static #getAllAddresses(callTrace: DebugTrace, set: Set<Hex.Address>) {
			set.add(callTrace.from);
			set.add(callTrace.to);
			if (callTrace.calls?.length) {
				for (const call of callTrace.calls)
					this.#getAllAddresses(call, set);
			}
		}

		static getAllAddresses(callTrace: DebugTrace): Set<Hex.Address> {
			const set = new Set<Hex.Address>();
			this.#getAllAddresses(callTrace, set);
			return set;
		}

		static #toAnnotatedTrace(trace: DebugTrace, ctx: { index: number }): AnnotatedTrace {
			const result: AnnotatedTrace = {
				index: ctx.index++,
				from: trace.from,
				to: trace.to,
				type: trace.type,
				input: trace.input,
				label: undefined
			};
			if (trace.calls?.length)
				result.calls = trace.calls.map(c => this.#toAnnotatedTrace(c, ctx));
			return result;
		}

		static toAnnotatedTrace(trace: DebugTrace): AnnotatedTrace {
			return this.#toAnnotatedTrace(trace, { index: 0 });
		}

		static inSameGroup(addrA: AddressInfo, addrB: AddressInfo): boolean {
			const creatorA = addrA.isContract ? addrA.creator : addrA.address;
			const creatorB = addrB.isContract ? addrB.creator : addrB.address;
			return creatorA === creatorB;
		}

		async getAddressInfos(callTrace: DebugTrace, chain: number): Promise<void> {
			const addresses = Analyzer.getAllAddresses(callTrace);
			this.#addrInfos.set(callTrace.from, { address: callTrace.from, isContract: false });
			addresses.delete(callTrace.from);
			const contracts = new Array<Hex.Address>();
			for (const address of addresses) {
				const code = await this.#rpcProvider.getCode(address, "latest", chain);
				const info = {
					address,
					isContract: code !== "0x"
				} as AddressInfo;
				if (info.isContract) {
					info.code = code;
					contracts.push(address);
				}
				this.#addrInfos.set(address, info);
			}
			const creations = await this.etherscan.getContractCreation(contracts, chain);
			for (const creation of creations) {
				if (creation === undefined)
					continue;
				const info = this.#addrInfos.get(creation.contractAddress)! as ContractInfo;
				info.creationBlock = Number.parseInt(creation.blockNumber);
				info.creationTxHash = creation.txHash;
				info.creationTimestamp = Number.parseInt(creation.timestamp);
				info.creator = creation.contractCreator;
				info.contractFactory = creation.contractFactory;
			}
		}

		#annotateTrace(callTrace: AnnotatedTrace, stack: number[]): AnnotatedTrace[] {
			const senderInfo = this.#addrInfos.get(callTrace.from)!;
			const traces = toTraceList(callTrace, stack);
			const lastTrace = traces.last();
			lastTrace.label = Label.VictimIn;
			const victimInfo = this.#addrInfos.get(lastTrace.to)!;

			let searchTargetIsAttacker = true;
			let lastCurrentPartyTrace = lastTrace;
			for (let i = traces.length - 2; i >= 0; i--) {
				const trace = traces[i];
				const next = traces[i + 1];
				const to = this.#addrInfos.get(trace.to)! as ContractInfo;
				if (Analyzer.inSameGroup(to, senderInfo)) {
					if (searchTargetIsAttacker) {
						setLabel(next, Label.AttackerOut);
						setLabel(lastCurrentPartyTrace, Label.VictimIn);
						searchTargetIsAttacker = false;
					}
					lastCurrentPartyTrace = trace;
				}
				else if (Analyzer.inSameGroup(to, victimInfo)) {
					if (!searchTargetIsAttacker) {
						setLabel(next, Label.VictimOut);
						setLabel(lastCurrentPartyTrace, Label.AttackerIn);
						searchTargetIsAttacker = true;
					}
					lastCurrentPartyTrace = trace;
				}
			}
			return traces;
		}

		#analyzeScope(traces: AnnotatedTrace[]): Scope {
			let result = Scope.CrossContract;
			let victimOutIdx = -1;
			for (let i = 0; i < traces.length; i++) {
				const trace = traces[i];
				if (victimOutIdx === -1) {
					if (hasLabel(trace, Label.VictimOut))
						victimOutIdx = i;
				}
				else if (hasLabel(trace, Label.VictimIn)) {
					const targetTrace = traces[victimOutIdx - 1];
					const scope = trace.to !== targetTrace.to ? Scope.CrossContract
						: extractSelector(trace) !== extractSelector(targetTrace)
							? Scope.CrossFunction
							: Scope.SingleFunction;
					result = Math.min(result, scope);
					victimOutIdx = -1;
				}
			}
			return result;
		}

		async *analyze(txHash: Hex.String, chain: number): AsyncGenerator<AnalysisResult> {
			const rawTrace = await this.debugProvider.getDebugTrace(Hex.verifyTxHash(txHash), chain);
			if (rawTrace === null)
				return;
			this.#addrInfos.clear();
			const callTrace = Analyzer.toAnnotatedTrace(rawTrace);
			await this.getAddressInfos(callTrace, chain);
			const sender = callTrace.from;
			const senderInfo = this.#addrInfos.get(sender)!;
			const senderAddresses = Array.from(this.#addrInfos.values())
				.filter(info => Analyzer.inSameGroup(senderInfo, info));
			if (senderAddresses.length <= 1)
				return;
			const traverser = new Traverser<AnnotatedTraceInfo>(this.#addrInfos);
			for (const [trace, stack] of traverser.traverse(callTrace)) {
				const result = {
					reTrace: trace,
					reStack: stack,
					rootTrace: callTrace,
					attackers: senderAddresses
				} as AnalysisResult;
				const traces = this.#annotateTrace(callTrace, stack);
				const victimInfo = this.#addrInfos.get(traces.last().to)!;
				result.victims = Array.from(this.#addrInfos.values())
					.filter(info => Analyzer.inSameGroup(victimInfo, info));
				result.scope = this.#analyzeScope(traces);

				yield result;
			}
		}

		static toString(result: AnalysisResult): string {
			let str = "\n";
			str += `Readonly: ${result.readonly}\n`;
			str += `Scope: ${Scope[result.scope]}\n`;
			str += `Entry Point: ${result.entryPoint}\n`;
			str += `Trace Index: ${result.reTrace.index}\n`;
			str += `Trace Stack: ${result.reStack}\n`;
			str += "Attackers:\n";
			for (const addr of result.attackers)
				str += `\t${addressToString(addr)}\n`;
			str += "Victims:\n";
			for (const addr of result.victims)
				str += `\t${addressToString(addr)}\n`;
			str += "\n";
			return str;
		}
	}
}