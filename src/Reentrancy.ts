import { whatsabi, type providers, type AutoloadConfig } from "@shazow/whatsabi";
import "basic-type-extensions";
import { CallType, Etherscan, type RPC, type DebugTrace, type DebugTraceProvider } from "./providers";
import { Chain, type ChainName } from "./config/Chain";
import { Counter, Hex, splitInput } from "./utils";

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

	class Traverser {
		private readonly beforeCount = new Counter();
		private readonly afterCount = new Counter();
		private readonly currentStack: number[] = [];
		private sender!: EOAInfo;

		constructor(public readonly infos: Map<string, AddressInfo>) { }

		*#traverse(trace: DebugTrace, senderContractDepth: number): Generator<number[]> {
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
					yield this.currentStack.slice();
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
				for (const stack of this.#traverse(trace.calls[i], newSenderContractDepth)) {
					reentrancyDetectedInCalls = true;
					yield stack;
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

		*traverse(callTrace: DebugTrace): Generator<number[]> {
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

	export type AnnotatedTrace = Omit<DebugTrace, "calls"> & {
		selector?: string;
		parameter?: string;
		label?: Label;
		calls?: AnnotatedTrace[];
	};

	export interface AnalysisResult {
		readonly: boolean;
		scope: Scope;
		entryPoint: EntryPoint;
		attackers: AddressInfo[];
		victims: AddressInfo[];
		trace: AnnotatedTrace;
		stack: number[];
	}

	function hasLabel(trace: AnnotatedTrace, label: Label): boolean {
		if (trace.label === undefined)
			return false;
		return (trace.label & label) !== 0;
	}
	function setLabel(trace: AnnotatedTrace, label: Label) {
		trace.label = (trace.label ?? Label.None) | label;
	}

	export class Analyzer {
		readonly #rpcProvider: RPC.Provider;
		readonly #autoload: (address: string) => Promise<whatsabi.AutoloadResult>;

		constructor(
			readonly chain: ChainName,
			readonly etherscan: Etherscan,
			readonly traceProvider: DebugTraceProvider,
			rpcProvider?: RPC.Provider
		) {
			const chainId = Chain[chain];
			const whatsabiConfig: AutoloadConfig = {
				provider: {
					getCode: address => this.#rpcProvider.getCode(address, "latest"),
					getStorageAt: (address, slot) => this.#rpcProvider.getStorageAt(address, Hex.verify(slot), "latest"),
					call: ({ to, data }) => this.#rpcProvider.call({ to, input: data }, "latest"),
					getAddress: () => { throw new Error("Not implemented"); },
				} satisfies providers.Provider,
				abiLoader: new whatsabi.loaders.EtherscanV2ABILoader({ apiKey: etherscan.apiKey, chainId })
			};
			this.#autoload = (address: string) => whatsabi.autoload(address, whatsabiConfig);
			this.#rpcProvider = rpcProvider ??= etherscan.geth;
		}

		static #getAllAddresses(callTrace: DebugTrace, set: Set<string>) {
			set.add(callTrace.from);
			set.add(callTrace.to);
			if (callTrace.calls?.length) {
				for (const call of callTrace.calls)
					this.#getAllAddresses(call, set);
			}
		}

		static getAllAddresses(callTrace: DebugTrace): Set<string> {
			const set = new Set<string>();
			this.#getAllAddresses(callTrace, set);
			return set;
		}

		static toAnnotatedTrace(trace: DebugTrace): AnnotatedTrace {
			const [selector, parameter] = splitInput(trace.input ?? "0x");
			const result: AnnotatedTrace = {
				from: trace.from,
				to: trace.to,
				type: trace.type,
				selector,
				parameter,
				label: undefined
			};
			if (trace.calls?.length)
				result.calls = trace.calls.map(this.toAnnotatedTrace.bind(this));
			return result;
		}

		static inSameGroup(addrA: AddressInfo, addrB: AddressInfo): boolean {
			const creatorA = addrA.isContract ? addrA.creator : addrA.address;
			const creatorB = addrB.isContract ? addrB.creator : addrB.address;
			return creatorA === creatorB;
		}

		async getAddressInfos(callTrace: DebugTrace): Promise<Map<string, AddressInfo>> {
			const result = new Map<string, AddressInfo>();
			const addresses = Analyzer.getAllAddresses(callTrace);
			result.set(callTrace.from, { address: callTrace.from, isContract: false });
			addresses.delete(callTrace.from);
			const contracts = new Array<string>();
			for (const address of addresses) {
				const code = await this.#rpcProvider.getCode(address, "latest");
				const info = {
					address,
					isContract: code !== "0x"
				} as AddressInfo;
				if (info.isContract) {
					info.code = code;
					contracts.push(address);
				}
				result.set(address, info);
			}
			const creations = await this.etherscan.getContractCreation(contracts);
			for (const creation of creations) {
				const info = result.get(creation.contractAddress)! as ContractInfo;
				info.creationBlock = Number.parseInt(creation.blockNumber);
				info.creationTxHash = creation.txHash;
				info.creationTimestamp = Number.parseInt(creation.timestamp);
				info.creator = creation.contractCreator;
				info.contractFactory = creation.contractFactory;
			}
			return result;
		}

		async *analyze(txHash: Hex): AsyncGenerator<AnalysisResult> {
			const rawTrace = await this.traceProvider.getDebugTrace(Hex.toString(txHash));
			const callTrace = Analyzer.toAnnotatedTrace(rawTrace);
			const infos = await this.getAddressInfos(callTrace);
			const sender = callTrace.from;
			const senderInfo = infos.get(sender)!;
			const senderAddresses = Array.from(infos.values())
				.filter(info => Analyzer.inSameGroup(senderInfo, info));
			if (senderAddresses.length <= 1)
				return;
			const traverser = new Traverser(infos);
			for (const stack of traverser.traverse(callTrace)) {
				const result = {
					stack,
					trace: callTrace,
					attackers: senderAddresses
				} as AnalysisResult;

				const traces = toTraceList(callTrace, stack);
				const lastTrace = traces.last();
				lastTrace.label = Label.VictimIn;
				const victimInfo = infos.get(lastTrace.to)!;
				result.victims = Array.from(infos.values())
					.filter(info => Analyzer.inSameGroup(victimInfo, info));

				let searchTargetIsAttacker = true;
				let lastCurrentPartyTrace = lastTrace;
				for (let i = traces.length - 2; i >= 0; i--) {
					const trace = traces[i];
					const next = traces[i + 1];
					const to = infos.get(trace.to)! as ContractInfo;
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

				result.scope = Scope.CrossContract;
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
							: trace.selector !== targetTrace.selector ? Scope.CrossFunction : Scope.SingleFunction;
						if (scope < result.scope)
							result.scope = scope;
						victimOutIdx = -1;
					}
				}

				yield result;
			}
		}

		static toString(result: AnalysisResult): string {
			let str = "\n";
			str += `Readonly: ${result.readonly}\n`;
			str += `Scope: ${result.scope}\n`;
			str += `Entry Point: ${result.entryPoint}\n`;
			str += `Stack: ${result.stack}\n`;
			str += "Attackers:\n";
			for (const addr of result.attackers)
				str += `\t[${addr.isContract ? "Contract" : "EOA"}] ${addr.address}\n`;
			str += "Victims:\n";
			for (const addr of result.victims)
				str += `\t[${addr.isContract ? "Contract" : "EOA"}] ${addr.address}\n`;
			str += "\n";
			return str;
		}
	}
}