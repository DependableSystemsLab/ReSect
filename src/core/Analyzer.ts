import "basic-type-extensions";
import { abiFromBytecode } from "@shazow/whatsabi";
import chalk from "chalk";
import { checkTrace, ERC1155, ERC1363, ERC20, ERC223, ERC677, ERC721, ERC777 } from "../config/ERC";
import { TraceConverter } from "../converters";
import { ReentrancyAttack } from "../database/entities/ReentrancyAttack";
import { type CallTraceProvider, type DebugTraceProvider, Etherscan, type RPC } from "../providers";
import { CallType, type DebugTrace, extractSelector, Hex, type MinimalTrace, type ReverseDebugTrace } from "../utils";
import { addressToString, hasLabel, inSameGroup, setLabel, toTraceList } from "./functions";
import { Traverser } from "./Traverser";
import type { AddressInfo, AnnotatedTrace, AnnotatedTraceInfo, ContractInfo, Entrance, EOAInfo } from "./types";
import { Label, Scope, TraceNotFoundError } from "./types";
import { nonReentrant, resetReentrancyLock } from "./ReentrancyGuard";


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

	static #entranceToString({ type, trace }: Entrance): string {
		const name = Object.entries(ReentrancyAttack.EntryPoint).find(([, v]) => v === type)![0];
		let str = chalk`{red [${name}]} {inverse ${trace.type}}: {cyanBright ${trace.from}} -> {cyanBright ${trace.to}}`;
		const selector = extractSelector(trace);
		if (selector !== undefined)
			str += chalk` ({yellowBright ${selector ?? "fallback"}})`;
		return str;
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
			str += `\t${AnalysisResult.#entranceToString(entrance)}\n`;
		str += "\n";
		return str;
	}
}

const hookRecipientSelectors = [
	ERC223.Recipient.abis.tokenReceived.selector,
	ERC677.Recipient.abis.onTokenTransfer.selector,
	ERC721.Recipient.abis.onERC721Received.selector,
	ERC777.Sender.abis.tokensToSend.selector,
	ERC777.Recipient.abis.tokensReceived.selector,
	ERC1155.Recipient.abis.onERC1155Received.selector,
	ERC1155.Recipient.abis.onERC1155BatchReceived.selector,
	ERC1363.Spender.abis.onApprovalReceived.selector,
	ERC1363.Recipient.abis.onTransferReceived.selector
];

export class Analyzer {
	readonly #rpcProvider: RPC.MultiChainProvider;
	// Shared between sessions
	readonly #addrInfos = new Map<Hex.Address, AddressInfo>();
	readonly #debugTraces = new Map<Hex.TxHash, DebugTrace>();
	// Unique to each session
	#senderInfo!: EOAInfo;
	#victimInfo!: ContractInfo;

	constructor(
		readonly etherscan: Etherscan,
		readonly debugProvider: DebugTraceProvider,
		readonly traceProvider?: CallTraceProvider,
		rpcProvider?: RPC.MultiChainProvider
	) {
		this.#rpcProvider = rpcProvider ??= etherscan;
	}

	static #getAllAddresses(trace: DebugTrace, set: Set<Hex.Address>) {
		set.add(trace.from);
		if (trace.to !== undefined)
			set.add(trace.to);
		if (trace.calls?.length) {
			for (const call of trace.calls)
				this.#getAllAddresses(call, set);
		}
	}

	static getAllAddresses(trace: DebugTrace): Set<Hex.Address> {
		const set = new Set<Hex.Address>();
		this.#getAllAddresses(trace, set);
		return set;
	}

	static #toAnnotatedTrace(trace: DebugTrace, ctx: { index: number; }): AnnotatedTrace {
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
	 * @param initCode The init code in hex format without 0x prefix
	 * @param input The input in hex format without 0x prefix
	 */
	static isInitCodeFromInput(initCode: string, input: string): boolean {
		if (initCode.length > input.length)
			return false;
		const SLICE_LENGTH = 16; // 8 bytes
		const MATCH_COUNT = 4; // 4 random matches
		const head = initCode.slice(0, SLICE_LENGTH);
		const tail = initCode.slice(-SLICE_LENGTH);
		for (let idx = 0; idx < input.length; idx += 2) { // move to the next byte
			idx = input.indexOf(head, idx);
			if (idx === -1 || idx + initCode.length > input.length)
				break;
			if (tail !== input.slice(idx + initCode.length - SLICE_LENGTH, idx + initCode.length))
				continue;
			for (let k = 0; k < MATCH_COUNT; ++k) {
				const offset = Math.randomInteger(SLICE_LENGTH, initCode.length - SLICE_LENGTH);
				const initCodeSlice = initCode.slice(offset, offset + SLICE_LENGTH);
				const inputSlice = input.slice(idx + offset, idx + offset + SLICE_LENGTH);
				if (initCodeSlice !== inputSlice)
					continue;
			}
			return true;
		}
		return false;
	}

	static *#findCreateTraces(trace: ReverseDebugTrace, calls?: DebugTrace[]): Generator<ReverseDebugTrace> {
		if (trace.type === CallType.CREATE || trace.type === CallType.CREATE2)
			yield trace;
		if (!calls?.length)
			return;
		for (const call of calls) {
			const { calls: subCalls, ...subTrace } = call;
			const reverseTrace = subTrace as ReverseDebugTrace;
			reverseTrace.caller = trace;
			yield* this.#findCreateTraces(reverseTrace, subCalls);
		}
	}

	static findCreateTraces(callTrace: DebugTrace): ReverseDebugTrace[] {
		const { calls, ...trace } = callTrace;
		return Array.from(this.#findCreateTraces(trace, calls));
	}

	static findCreateTrace<T extends MinimalTrace>(callTrace: DebugTrace<T>, address: Hex.Address): DebugTrace<T> | undefined {
		if (callTrace.to === address && (callTrace.type === CallType.CREATE || callTrace.type === CallType.CREATE2))
			return callTrace;
		if (!callTrace.calls?.length)
			return undefined;
		for (const call of callTrace.calls) {
			const result = this.findCreateTrace(call, address);
			if (result)
				return result;
		}
	}

	async #getDebugTrace(txHash: Hex.TxHash, chain: number): Promise<DebugTrace> {
		let trace: DebugTrace | null | undefined = this.#debugTraces.get(txHash);
		if (!trace) {
			trace = await this.debugProvider.getDebugTrace(txHash, chain);
			if (trace === null && this.traceProvider) {
				const traces = await this.traceProvider.getCallTraces(txHash, chain);
				if (traces !== null)
					trace = TraceConverter.callTracesToDebugTrace(traces);
			}
			if (trace === null)
				throw new TraceNotFoundError(txHash);
			this.#debugTraces.set(txHash, trace);
		}
		return trace;
	}

	async #fetchAddressInfos(addresses: Iterable<Hex.Address>, chain: number) {
		const addrSet = addresses instanceof Set ? addresses as Set<Hex.Address> : new Set(addresses);
		const addrs = Array.from(addrSet.difference(new Set(this.#addrInfos.keys())));
		const creations = await this.etherscan.getContractCreation(addrs, chain);
		const contracts = new Array<Hex.Address>();
		const factoryCreationTxns = new Set<Hex.TxHash>();
		for (let i = 0; i < creations.length; ++i) {
			const creation = creations[i];
			const address = addrs[i];
			let info: AddressInfo;
			if (creation === null) {
				info = {
					address,
					isContract: false
				};
			}
			else {
				contracts.push(address);
				let code = await this.#rpcProvider.getCode(address, "latest", chain);
				if (code === "0x") {
					const trace = await this.#getDebugTrace(creation.txHash as Hex.TxHash, chain);
					const createTrace = Analyzer.findCreateTrace(trace, address);
					if (createTrace === undefined)
						throw new Error(`Failed to find create trace for ${address}`);
					code = createTrace.output ?? "0x"; // CREATE traces could return nothing, example: 0x8c07a96fd504f34211771c2fa7ce37f9565f6f00
				}
				info = {
					address,
					isContract: true,
					code,
					abi: abiFromBytecode(code),
					creationBlock: Number.parseInt(creation.blockNumber),
					creationTxHash: creation.txHash,
					creationTimestamp: Number.parseInt(creation.timestamp),
					creator: creation.contractCreator
				} as ContractInfo;
				if (String.isNullOrEmpty(creation.contractFactory))
					info.author = creation.contractCreator;
				else {
					info.contractFactory = creation.contractFactory;
					factoryCreationTxns.add(creation.txHash as Hex.TxHash);
				}
			}
			this.#addrInfos.set(address, info);
		}
		// Fetch creation traces
		const missingCreationTxns = factoryCreationTxns.difference(new Set(this.#debugTraces.keys()));
		if (missingCreationTxns.size > 0)
			await Array.from(missingCreationTxns).mapAsync(txHash => this.#getDebugTrace(txHash, chain));
		// Determine contract authors
		const creationTraces = new Map<Hex.Address, ReverseDebugTrace>();
		for (const hash of factoryCreationTxns) {
			const trace = this.#debugTraces.get(hash)!;
			const createTraces = Analyzer.findCreateTraces(trace);
			for (const createTrace of createTraces) {
				if (createTrace.to !== undefined)
					creationTraces.set(createTrace.to, createTrace);
			}
		}
		const authorFactories = new Map<Hex.Address, Hex.Address>();
		for (const contract of contracts) {
			const info = this.#addrInfos.get(contract)! as ContractInfo;
			if (info.contractFactory === undefined || info.author)
				continue;
			const creationTrace = creationTraces.get(info.address);
			if (creationTrace === undefined)
				throw new Error(`Creation trace for ${info.address} not found`);
			const initCode = Hex.removePrefix(creationTrace.input);
			let cur = creationTrace;
			while (cur.caller && Analyzer.isInitCodeFromInput(initCode, cur.caller.input))
				cur = cur.caller;
			if (cur.caller === undefined) // Author is the sender of the current transaction
				info.author = cur.from;
			else { // Author is the contract factory
				const factoryInfo = this.#addrInfos.get(cur.to!) as ContractInfo | undefined;
				if (factoryInfo?.author)
					info.author = factoryInfo.author;
				else
					authorFactories.set(contract, cur.from);
			}
		}
		function unionFind(addr: Hex.Address): Hex.Address {
			const parent = authorFactories.get(addr);
			if (parent === undefined)
				return addr;
			const root = unionFind(parent);
			authorFactories.set(addr, root);
			return root;
		}
		authorFactories.keys().forEach(unionFind);
		const missingAuthorFactories = new Set<Hex.Address>(authorFactories.values());
		if (missingAuthorFactories.size === 0)
			return;
		await this.#fetchAddressInfos(missingAuthorFactories, chain);
		for (const [contract, factory] of authorFactories) {
			const info = this.#addrInfos.get(contract) as ContractInfo;
			const factoryInfo = this.#addrInfos.get(factory) as ContractInfo;
			info.author = factoryInfo.author;
		}
	}

	#annotateTrace(callTrace: AnnotatedTrace, stack: number[]): AnnotatedTrace[] {
		const traces = toTraceList(callTrace, stack);
		const lastTrace = traces.last();
		this.#victimInfo = this.#addrInfos.get(lastTrace.to!)! as ContractInfo;
		let searchTargetIsAttacker = true;
		let lastCurrentPartyTrace = lastTrace;
		for (let i = traces.length - 2; i >= 0; i--) {
			const trace = traces[i];
			const next = traces[i + 1];
			const to = this.#addrInfos.get(trace.to!)! as ContractInfo;
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
			if (trace.to === undefined)
				throw new Error("Trace to address is undefined");
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
				yield { type: ReentrancyAttack.EntryPoint.Fallback, trace };
				continue;
			}
			const type = checkTrace(trace, ERC20.abis)
				? ReentrancyAttack.EntryPoint.MaliciousToken
				// TODO: Could reentrancy possibly be initiated with CREATE?
				: hookRecipientSelectors.includes(trace.selector!)
					? ReentrancyAttack.EntryPoint.ERCHook
					: ReentrancyAttack.EntryPoint.ApplicationHook;
			yield { type, trace };
		}
	}

	reset(preserveCache: boolean = false) {
		this.#senderInfo = undefined!;
		this.#victimInfo = undefined!;
		if (!preserveCache) {
			this.#addrInfos.clear();
			this.#debugTraces.clear();
		}
		resetReentrancyLock(this, { targetMember: "analyze" });
	}

	@nonReentrant()
	async *analyze(txHash: Hex.String, chain: number): AsyncGenerator<AnalysisResult> {
		// Fetch debug trace
		const txn = Hex.verifyTxHash(txHash);
		const rawTrace = await this.#getDebugTrace(txn, chain);
		if (rawTrace === null)
			throw new TraceNotFoundError(txn);
		this.#debugTraces.set(txn, rawTrace);
		// Set sender info
		this.#senderInfo = this.#addrInfos.get(rawTrace.from) as EOAInfo;
		if (!this.#senderInfo) {
			this.#senderInfo = { address: rawTrace.from, isContract: false };
			this.#addrInfos.set(rawTrace.from, this.#senderInfo);
		}
		// Get address infos
		const callTrace = Analyzer.toAnnotatedTrace(rawTrace);
		await this.#fetchAddressInfos(Analyzer.getAllAddresses(callTrace), chain);
		const senderAddresses = Array.from(this.#addrInfos.values())
			.filter(info => inSameGroup(this.#senderInfo, info));
		if (senderAddresses.length <= 1)
			return;
		// Traverse the call trace to find reentrancy
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
			traces.forEach(t => t.label = undefined); // Reset labels
		}
	}
}