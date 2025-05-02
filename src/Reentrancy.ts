import { whatsabi, type providers, type AutoloadConfig } from "@shazow/whatsabi";
import { Etherscan, Tenderly } from "./providers/index.js";
import { Mainnet, Testnet, type ChainName } from "./config/Chain.js";
import * as creds from "./config/credentials.js";
import { Counter, parseInput, CallType, type Hex } from "./utils/index.js";


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

	interface MinimalTrace {
		from: string;
		to: string;
		type: CallType;
		calls?: MinimalTrace[];
	}

	class Traverser {
		private readonly beforeCount = new Counter();
		private readonly afterCount = new Counter();
		private readonly currentStack: number[] = [];
		private sender!: EOAInfo;

		constructor(public readonly infos: Map<string, AddressInfo>) { }

		private *_traverse(trace: MinimalTrace, senderContractDepth: number): Generator<number[]> {
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
			const found = !fromIsSender && Analyzer.inSameGroup(to, this.sender);
			const newSenderContractDepth = found ? this.currentStack.length : senderContractDepth;

			let before: (() => void) | undefined;
			let after: (() => void) | undefined;
			if (!found) {
				const counter = senderContractDepth != -1 ? this.afterCount : this.beforeCount;
				before = () => counter.increment(to.creator);
				after = () => counter.decrement(to.creator);
			}
			else if (senderContractDepth !== -1) {
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
				for (const stack of this._traverse(trace.calls[i], newSenderContractDepth)) {
					reentrancyDetectedInCalls = true;
					yield stack;
				}
				this.currentStack.pop();
			}
			after?.();

			if (!reentrancyDetectedInCalls && reentrancyDetected)
				yield this.currentStack.slice();
		}

		private _clear() {
			this.beforeCount.clear();
			this.afterCount.clear();
			this.currentStack.length = 0;
			this.sender = undefined!;
		}

		*traverse(callTrace: MinimalTrace): Generator<number[]> {
			this._clear();
			this.sender = this.infos.get(callTrace.from)! as EOAInfo;
			yield* this._traverse(callTrace, -1);
		}
	}

	function toTraceList<T extends MinimalTrace = MinimalTrace>(trace: T, indices: number[]): T[] {
		const result = new Array<T>(indices.length);
		let current = trace;
		for (let i = 0; i < indices.length; i++) {
			const index = indices[i];
			if (!(current.calls?.length) || index < 0 || index >= current.calls.length)
				throw new Error(`Invalid index ${index} for call trace`);
			const next = current.calls[index];
			current = result[i] = next as T;
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

	export type AnnotatedTrace = Omit<MinimalTrace, "calls"> & {
		selector?: string;
		parameter?: string;
		label?: Label;
		calls?: AnnotatedTrace[];
	};

	export interface Characteristics {
		isReentrancy: true;
		readonly: boolean;
		scope: Scope;
		entryPoint: EntryPoint;
		attackers: string[];
		victims: string[];
		trace: AnnotatedTrace;
		stack: number[];
	}

	export type AnalysisResult = {
		isReentrancy: false;
	} | Characteristics;

	export class Analyzer {
		private readonly _codeCache = new Map<string, string>();
		readonly etherscan: Etherscan;
		readonly tenderly: Tenderly;
		readonly autoload: (address: string) => Promise<whatsabi.AutoloadResult>;

		constructor(readonly chain: ChainName) {
			const chainId = chain in Mainnet
				? Mainnet[chain as keyof typeof Mainnet]
				: Testnet[chain as keyof typeof Testnet];
			this.etherscan = new Etherscan(creds.etherscanApiKey, chainId);
			if (!(chain in creds.tenderlyNodeAccessKeys))
				throw new Error(`No Tenderly access key for ${chain}`);
			// @ts-expect-error
			this.tenderly = new Tenderly(chainId, creds.tenderlyNodeAccessKeys[chain]);
			const whatsabiConfig: AutoloadConfig = {
				provider: {
					getCode: address => this.getCode(address),
					getStorageAt: (address, slot) => this.etherscan.geth.getStorageAt(address, slot),
					call: ({ to, data }) => this.etherscan.geth.call(to, data),
					getAddress: () => { throw new Error("Not implemented"); },
				} satisfies providers.Provider,
				abiLoader: new whatsabi.loaders.EtherscanV2ABILoader({ apiKey: creds.etherscanApiKey, chainId })
			};
			this.autoload = (address: string) => whatsabi.autoload(address, whatsabiConfig);
		}

		private static _getAllAddresses(callTrace: MinimalTrace, set: Set<string>) {
			set.add(callTrace.from);
			set.add(callTrace.to);
			if (callTrace.calls?.length) {
				for (const call of callTrace.calls)
					this._getAllAddresses(call, set);
			}
		}

		static getAllAddresses(callTrace: MinimalTrace): Set<string> {
			const set = new Set<string>();
			this._getAllAddresses(callTrace, set);
			return set;
		}

		static toAnnotatedTrace(trace: Tenderly.DebugCallTrace): AnnotatedTrace {
			const [selector, parameter] = parseInput(trace.input);
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

		private async getCode(address: string): Promise<string> {
			const cache = this._codeCache.get(address);
			if (cache !== undefined)
				return cache;
			const code = await this.etherscan.geth.getCode(address);
			this._codeCache.set(address, code);
			return code;
		}

		async getAddressInfos(callTrace: MinimalTrace): Promise<Map<string, AddressInfo>> {
			const result = new Map<string, AddressInfo>();
			const addresses = Analyzer.getAllAddresses(callTrace);
			result.set(callTrace.from, { address: callTrace.from, isContract: false });
			addresses.delete(callTrace.from);
			const contracts = new Array<string>();
			for (const address of addresses) {
				const code = await this.getCode(address);
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

		async analyze(txHash: Hex): Promise<AnalysisResult> {
			const rawTrace = await this.tenderly.debugTraceTransaction(txHash);
			const callTrace = Analyzer.toAnnotatedTrace(rawTrace);
			const infos = await this.getAddressInfos(callTrace);
			const sender = callTrace.from;
			const senderInfo = infos.get(sender)!;
			const senderAddresses = Array.from(infos.values())
				.filter(info => info.address !== sender && Analyzer.inSameGroup(senderInfo, info));
			if (senderAddresses.length === 0)
				return { isReentrancy: false };
			const traverser = new Traverser(infos);
			const result = {
				isReentrancy: true,
				trace: callTrace
			} as Characteristics;
			for (const stack of traverser.traverse(callTrace)) {
				result.stack = stack;
				const traces = toTraceList(callTrace, stack);
				return result;
			}
			return { isReentrancy: false };
		}
	}
}