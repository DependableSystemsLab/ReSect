import "basic-type-extensions";
import chalk from "chalk";
import { format as formatDate } from "date-fns";
import { Etherscan, type RPC, type DebugTraceProvider } from "./providers";
import { CallType, Counter, Hex, extractSelector, type DebugTrace, type MinimalTrace } from "./utils";
import { abiFromBytecode, type abi } from "@shazow/whatsabi";
import { ERC1155, ERC1363, ERC20, ERC721, ERC777 } from "./config/ERC";

export namespace Reentrancy {
	interface ContractInfo {
		address: Hex.Address;
		isContract: true;
		code: Hex.String;
		creationBlock: number;
		creationTxHash: Hex.TxHash;
		creationTimestamp: number;
		creator: Hex.Address;
		contractFactory?: Hex.Address;
		abi: abi.ABI;
	}

	interface EOAInfo {
		address: Hex.Address;
		isContract: false;
	}

	type AddressInfo = ContractInfo | EOAInfo;

	function addressToString(addr: AddressInfo): string {
		if (!addr.isContract)
			return chalk`{grey [EOA]} {cyanBright ${addr.address}}`;
		const timestamp = formatDate(addr.creationTimestamp * 1000, "yyyy-MM-dd HH:mm:ss");
		return chalk`{grey [Contract]} {cyanBright ${addr.address}} <- {blue ${addr.creator}} ({magentaBright ${timestamp}})`;
	}

	function inSameGroup(addrA: AddressInfo, addrB: AddressInfo): boolean {
		const creatorA = addrA.isContract ? addrA.creator : addrA.address;
		const creatorB = addrB.isContract ? addrB.creator : addrB.address;
		return creatorA === creatorB;
	}

	class Traverser<T extends MinimalTrace = MinimalTrace> {
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

	export enum EntranceType {
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
		selector?: Hex.Selector | null;
		label?: Label;
	}

	export type AnnotatedTrace = DebugTrace<AnnotatedTraceInfo>;

	export interface Entrance {
		type: EntranceType;
		trace: AnnotatedTraceInfo;
	}

	function entranceToString({ type, trace }: Entrance): string {
		let str = chalk`{red [${EntranceType[type]}]} {inverse ${trace.type}}: {cyanBright ${trace.from}} -> {cyanBright ${trace.to}}`;
		const selector = extractSelector(trace);
		if (selector !== undefined)
			str += chalk` ({yellowBright ${selector ?? "fallback"}})`;
		return str;
	}

	function hasLabel(trace: AnnotatedTrace, label: Label): boolean {
		if (trace.label === undefined)
			return false;
		return (trace.label & label) !== 0;
	}
	function setLabel(trace: AnnotatedTrace, label: Label) {
		trace.label = (trace.label ?? Label.None) | label;
	}

	export class AnalysisResult {
		readonly!: boolean;
		scope!: Scope;
		attackers!: AddressInfo[];
		victims!: AddressInfo[];
		rootTrace!: AnnotatedTrace;
		reTrace!: AnnotatedTraceInfo;
		reStack!: number[];
		entrances!: Entrance[];

		constructor(init?: Partial<AnalysisResult>) {
			Object.assign(this, init);
		}

		#fieldToString(name: string, value?: any): string {
			return chalk`${name}: {green ${value}}\n`;
		}

		toString(): string {
			let str = "\n";
			str += this.#fieldToString("Readonly", this.readonly);
			str += this.#fieldToString("Scope", Scope[this.scope]);
			str += this.#fieldToString("Trace Index", this.reTrace.index);
			str += this.#fieldToString("Trace Stack", this.reStack);
			str += this.#fieldToString("Attackers", `${chalk.greenBright(this.attackers.length)} addresses`);
			for (const addr of this.attackers)
				str += `\t${addressToString(addr)}\n`;
			str += this.#fieldToString("Victims", `${chalk.greenBright(this.victims.length)} addresses`);
			for (const addr of this.victims)
				str += `\t${addressToString(addr)}\n`;
			str += this.#fieldToString("Entrances", `${chalk.greenBright(this.entrances.length)} entries`);
			for (const entrance of this.entrances)
				str += `\t${entranceToString(entrance)}\n`;
			str += "\n";
			return str;
		}
	}

	const hookRecipientSelectors = [
		ERC721.Recipient.abis.onERC721Received.selector,
		ERC777.Recipient.abis.tokensReceived.selector,
		ERC1155.Recipient.abis.onERC1155Received.selector,
		ERC1155.Recipient.abis.onERC1155BatchReceived.selector,
		ERC1363.Recipient.abis.onTransferReceived.selector
	];

	export class Analyzer {
		readonly #rpcProvider: RPC.MultiChainProvider;
		readonly #addrInfos = new Map<Hex.Address, AddressInfo>();
		#senderInfo!: EOAInfo;
		#victimInfo!: ContractInfo;

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
				label: undefined,
				selector: extractSelector(trace)
			};
			if (trace.calls?.length)
				result.calls = trace.calls.map(c => this.#toAnnotatedTrace(c, ctx));
			return result;
		}

		static toAnnotatedTrace(trace: DebugTrace): AnnotatedTrace {
			return this.#toAnnotatedTrace(trace, { index: 0 });
		}

		/**
		 * Get all addresses in the call trace and fetch their code from the blockchain.
		 */
		async #fetchAddressInfos(callTrace: DebugTrace, chain: number): Promise<void> {
			const addresses = Analyzer.getAllAddresses(callTrace);
			this.#senderInfo = { address: callTrace.from, isContract: false };
			this.#addrInfos.set(callTrace.from, this.#senderInfo);
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
					info.abi = abiFromBytecode(code);
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
				info.contractFactory = String.isNullOrEmpty(creation.contractFactory) ? undefined : creation.contractFactory;
			}
		}

		#annotateTrace(callTrace: AnnotatedTrace, stack: number[]): AnnotatedTrace[] {
			const traces = toTraceList(callTrace, stack);
			const lastTrace = traces.last();
			this.#victimInfo = this.#addrInfos.get(lastTrace.to)! as ContractInfo;
			let searchTargetIsAttacker = true;
			let lastCurrentPartyTrace = lastTrace;
			for (let i = traces.length - 2; i >= 0; i--) {
				const trace = traces[i];
				const next = traces[i + 1];
				const to = this.#addrInfos.get(trace.to)! as ContractInfo;
				if (inSameGroup(to, this.#senderInfo)) {
					if (searchTargetIsAttacker) {
						setLabel(next, Label.AttackerOut);
						setLabel(lastCurrentPartyTrace, Label.VictimIn);
						searchTargetIsAttacker = false;
					}
					lastCurrentPartyTrace = trace;
				}
				else if (inSameGroup(to, this.#victimInfo)) {
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

		*#analyzeScope(traces: readonly AnnotatedTrace[]): Generator<Scope> {
			const victimGroups = new Array<Map<Hex.Address, Set<Hex.Selector | null>>>();
			let inGroup = false;
			for (const trace of traces) {
				if (trace.selector === undefined)
					continue;
				/*if (trace.selector !== null) {
					const functions = (this.#addrInfos.get(trace.to)! as ContractInfo).abi;
					if (!functions.find(f => f.type === "function" && f.selector === trace.selector))
						trace.selector = null;
				}*/
				if (hasLabel(trace, Label.VictimIn)) {
					inGroup = true;
					const map = new Map<Hex.Address, Set<Hex.Selector | null>>();
					map.set(trace.to, new Set([trace.selector]));
					victimGroups.push(map);
				}
				else if (hasLabel(trace, Label.VictimOut))
					inGroup = false;
				else if (inGroup && inSameGroup(this.#victimInfo, this.#addrInfos.get(trace.to)!)) {
					const map = victimGroups.last()!;
					if (!map.has(trace.to))
						map.set(trace.to, new Set([trace.selector]));
					else
						map.get(trace.to)!.add(trace.selector);
				}
			}
			let prevGroup = victimGroups[0];
			for (let i = 1; i < victimGroups.length; i++) {
				const curGroup = victimGroups[i];
				let scope = Scope.CrossContract;
				for (const [address, selectors] of curGroup) {
					const prevSelectors = prevGroup.get(address);
					if (prevSelectors === undefined) // cross contract
						continue;
					scope = Scope.CrossFunction;
					if (Array.from(selectors).some(selector => prevSelectors.has(selector))) {
						scope = Scope.SingleFunction;
						break;
					}
				}
				yield scope;
				prevGroup = curGroup;
			}
		}

		*#analyzeEntrances(traces: readonly AnnotatedTrace[]): Generator<Entrance> {
			for (const trace of traces) {
				if (!hasLabel(trace, Label.AttackerIn))
					continue;
				if (trace.selector === null) {
					yield { type: EntranceType.Fallback, trace };
					continue;
				}
				const to = this.#addrInfos.get(trace.to)! as ContractInfo;
				const type = ERC20.check(to.abi)
					? EntranceType.MaliciousToken
					// TODO: Could reentrancy possibly be initiated with CREATE?
					: hookRecipientSelectors.includes(trace.selector!)
						? EntranceType.ERCHook
						: EntranceType.Other;
				yield { type, trace };
			}
		}

		async *analyze(txHash: Hex.String, chain: number): AsyncGenerator<AnalysisResult> {
			const rawTrace = await this.debugProvider.getDebugTrace(Hex.verifyTxHash(txHash), chain);
			if (rawTrace === null)
				return;
			this.#addrInfos.clear();
			const callTrace = Analyzer.toAnnotatedTrace(rawTrace);
			await this.#fetchAddressInfos(callTrace, chain);
			const senderAddresses = Array.from(this.#addrInfos.values())
				.filter(info => inSameGroup(this.#senderInfo, info));
			if (senderAddresses.length <= 1)
				return;
			const traverser = new Traverser<AnnotatedTraceInfo>(this.#addrInfos);
			for (const stack of traverser.traverse(callTrace)) {
				const traces = this.#annotateTrace(callTrace, stack);
				const result = new AnalysisResult({
					scope: Scope.CrossContract,
					reTrace: traces.last(),
					reStack: stack,
					rootTrace: callTrace,
					attackers: senderAddresses,
					victims: Array.from(this.#addrInfos.values())
						.filter(info => inSameGroup(this.#victimInfo, info))
				}) as AnalysisResult;
				const lastVictimIn = traces.findLast(t => hasLabel(t, Label.VictimIn))!;
				result.readonly = lastVictimIn.type === CallType.STATICCALL;
				for (const scope of this.#analyzeScope(traces)) {
					result.scope = Math.min(result.scope, scope);
					if (scope === Scope.SingleFunction)
						break;
				}
				result.entrances = Array.from(this.#analyzeEntrances(traces));
				yield result;
			}
		}
	}
}