import "basic-type-extensions";
import { createThrottledFetch } from "fetch-throttler";
import { Arrayable } from "type-fest";
import { Chain } from "../config/Chain";
import { Database } from "../database";
import { toURLSearchParams, Hex, type QueryObject, type NumStr } from "../utils";
import type { RPC } from "./common";
import { integration } from "./integration";


const fetchInstances = new Map<string, typeof fetch>();
function getFetch(apiKey: string | Etherscan.ApiKey) {
	const [key, tier = Etherscan.APITier.Free] = typeof apiKey == "string" ? [apiKey] : apiKey;
	let fetchInst = fetchInstances.get(key);
	if (!fetchInst) {
		const rateLimit = Etherscan.rateLimits[tier][0];
		fetchInst = createThrottledFetch({
			interval: 1000,
			maxConcurrency: rateLimit,
			maxRetry: 2,
			shouldRetry(res) {
				if (!(res instanceof Response) || !res.ok)
					return;
				return res.clone().json().then(json => {
					if (json.error != undefined)
						return true;
					if ("status" in json && json.status !== "1")
						return true;
				});
			}
		});
		fetchInstances.set(key, fetchInst);
	}
	return [key, fetchInst] as const;
}

export class Etherscan implements RPC.MultiChainProvider {
	static readonly BASE_URL = "https://api.etherscan.io/v2/api";

	#reqId: number = 0;
	#chain: number = 1;
	readonly #fetchPairs: (readonly [string, typeof fetch])[];

	readonly db: Database | undefined;

	constructor(
		apiKey: Arrayable<string | Etherscan.ApiKey> | Record<string, string | Etherscan.ApiKey>,
		chain: number = Chain.Ethereum,
		database?: Database
	) {
		this.#chain = chain;
		const apiKeys = typeof apiKey === "string"
			? [apiKey]
			: !Array.isArray(apiKey)
				? Object.values(apiKey) as (string | Etherscan.ApiKey)[]
				: apiKey.length === 2 && typeof apiKey[0] === "string" && typeof apiKey[1] === "number"
					? [apiKey as unknown as Etherscan.ApiKey]
					: apiKey as (string | Etherscan.ApiKey)[];
		this.#fetchPairs = apiKeys.map(getFetch);
		this.db = database;
	}

	get chain() {
		return this.#chain;
	}
	set chain(chain: number) {
		if (!Chain[chain])
			throw new Error(`Unsupported chain ID: ${chain}`);
		this.#chain = chain;
	}

	static #setBlockRange(
		params: Record<string, any>,
		range: Etherscan.BlockRange,
		paramNames: [start: string, end: string] = ["startblock", "endblock"]
	) {
		const [start, end] = range == "all" ? [0, 1e10] : range;
		if (start != undefined)
			params[paramNames[0]] = start;
		if (end != undefined)
			params[paramNames[1]] = end;
	}

	async #request<T>(
		module: string,
		action: string,
		chain?: number,
		params?: QueryObject,
		verifyStatus: boolean = true
	): Promise<T> {
		const [apiKey, fetchFunc] = this.#fetchPairs[this.#reqId++ % this.#fetchPairs.length];
		params ??= {};
		const searchParams = toURLSearchParams({
			...params,
			module,
			action,
			apikey: apiKey,
			chainid: chain ?? this.chain
		});
		const url = new URL(Etherscan.BASE_URL);
		url.search = searchParams.toString();
		const response = await fetchFunc(url.href, {
			method: "GET",
			headers: {
				"Accept": "application/json"
			}
		});
		if (!response.ok)
			throw new Error(`Etherscan API error: ${response.status} ${response.statusText}`);
		const resp = await response.json() as Etherscan.Response<T> | RPC.Response<T> | RPC.Error;
		if ("error" in resp)
			throw new Error(`Etherscan API error: ${resp.error.message} (${resp.error.slug})`);
		if (verifyStatus && "status" in resp && resp.status !== "1")
			throw new Error(`Etherscan API error: ${resp.status} ${resp.message} ${resp.result}`);
		return resp.result;
	}

	async #requestWithPagination<T extends unknown[]>(
		module: string,
		action: string,
		chain?: number,
		params?: Record<string, string | number | undefined>,
		pagination?: Etherscan.Pagination
	): Promise<T> {
		if (params) {
			delete params.page;
			delete params.offset;
		}
		if (pagination == undefined)
			return this.#request<T>(module, action, chain, params);
		if (Array.isArray(pagination)) {
			let [page, offset] = pagination;
			page ??= 1;
			offset ??= 1000;
			return this.#request<T>(module, action, chain, { ...params, page, offset });
		}
		let curPage = 1;
		const result = await this.#request<T>(module, action, chain, { ...params, page: 1, offset: 1000 });
		while (result.length == 1000 * curPage) {
			const next = await this.#request<T>(module, action, chain, { ...params, page: ++curPage, offset: 1000 });
			result.push(...next);
		}
		return result;
	}

	protected verifyBlockTag(tag: RPC.BlockNumber): "earliest" | "latest" | "pending" {
		if (tag == "earliest" || tag == "latest" || tag == "pending")
			return tag;
		throw new Error(`Unsupported block tag: ${tag}`);
	}

	blockNumber(chain?: number) {
		return this.#request<Hex.String>("proxy", "eth_blockNumber", chain);
	}

	getBlockByNumber(blockNumber: RPC.BlockNumber, full: boolean, chain?: number) {
		return this.#request<RPC.Block | null>("proxy", "eth_getBlockByNumber", chain, { tag: blockNumber, boolean: full });
	}

	@integration()
	getTransactionByHash(hash: Hex.TxHash, chain?: number) {
		return this.#request<RPC.Transaction | null>("proxy", "eth_getTransactionByHash", chain, { txhash: hash });
	}

	call(request: RPC.CallRequest, tag: RPC.BlockNumber, chain?: number) {
		tag = this.verifyBlockTag(tag);
		return this.#request<Hex.String>("proxy", "eth_call", chain, {
			from: request.from,
			to: request.to,
			data: request.input,
			gas: request.gas,
			gasPrice: request.gasPrice,
			value: request.value,
			tag
		});
	}

	@integration()
	getCode(address: Hex.Address, tag: RPC.BlockNumber, chain?: number) {
		tag = this.verifyBlockTag(tag);
		return this.#request<Hex.String>("proxy", "eth_getCode", chain, { address, tag });
	}

	getStorageAt(address: Hex.Address, position: Hex.String, tag: RPC.BlockNumber, chain?: number) {
		return this.#request<Hex.String>("proxy", "eth_getStorageAt", chain, { address, position, tag });
	}

	async getBlockNumberByTimestamp(timestamp?: number, closest: "before" | "after" = "before", chain?: number): Promise<number | null> {
		timestamp ??= Math.floor(Date.now() / 1000);
		if (timestamp < 0)
			throw new Error(`Invalid timestamp: ${timestamp}`);
		const result = await this.#request<number | string>("block", "getblocknobytime", chain, { timestamp, closest });
		const blockNumber = typeof result === "number" ? result : Number.parseInt(result);
		return Number.isNaN(blockNumber) ? null : blockNumber;
	}

	getTransactionsByAddress(
		address: Hex.String,
		blockRange: Etherscan.BlockRange = "all",
		pagination?: Etherscan.Pagination,
		chain?: number
	): Promise<Etherscan.TransactionByAddress[]> {
		const params = {
			address: Hex.verifyAddress(address),
			sort: "asc"
		};
		Etherscan.#setBlockRange(params, blockRange);
		return this.#requestWithPagination<Etherscan.TransactionByAddress[]>(
			"account", "txlist", chain, params, pagination
		);
	}

	async getContractCreation(contractAddresses: Arrayable<Hex.String>, chain?: number): Promise<(Etherscan.ContractCreation | null)[]> {
		if (!Array.isArray(contractAddresses))
			contractAddresses = [contractAddresses];
		chain ??= this.#chain;
		const addresses = contractAddresses.map(Hex.verifyAddress);
		const results = new Map<Hex.Address, Etherscan.ContractCreation | null>();
		if (this.db) {
			for (const contract of await this.db.getContracts(addresses)) {
				if ("eoaAddress" in contract)
					results.set(contract.eoaAddress, null);
				else if (contract.contractCreator)
					results.set(contract.contractAddress, contract);
			}
			if (results.size === addresses.length)
				return addresses.map(a => results.get(a)!);
			contractAddresses = addresses.filter(c => !results.has(c));
		}

		const request = async (contractAddresses: Hex.String[]) => {
			const creations = await this.#request<Etherscan.ContractCreation[] | null>("contract", "getcontractcreation", chain, { contractAddresses }, false);
			creations?.forEach(c => results.set(c.contractAddress, c));
			for (const addr of contractAddresses as Hex.Address[]) {
				if (!results.has(addr))
					results.set(addr, null);
			}
		};
		if (contractAddresses.length <= 5)
			await request(contractAddresses);
		else {
			const slices = new Array<Hex.String[]>(Math.ceil(contractAddresses.length / 5));
			for (let i = 0; i < contractAddresses.length; i += 5)
				slices[i / 5] = contractAddresses.slice(i, i + 5);
			await slices.forEachAsync(request);
		}

		if (this.db) {
			const eoas = (contractAddresses as Hex.Address[]).filter(c => results.get(c) === null);
			const newCreations = contractAddresses.map(c => results.get(c as Hex.Address)).filter(c => c != undefined);
			const txHashes = newCreations.map(c => c.txHash)
				.filter((tx): tx is Hex.TxHash => !tx.startsWith("GENESIS_"))
				.unique();
			const existing = await this.db.filterTxHashes(txHashes);
			if (existing.length < txHashes.length) {
				const missing = Array.difference(txHashes, existing);
				const txs = await missing.mapAsync(txHash => this.getTransactionByHash(txHash, chain));
				for (let i = 0; i < txs.length; i++) {
					if (txs[i] == null)
						throw new Error(`Transaction ${missing[i]} not found`);
				}
				await this.db.saveTransactions(txs as RPC.Transaction[], chain);
			}
			if (eoas.length > 0)
				await this.db.saveEOAs(eoas, chain ?? this.#chain);
			if (newCreations.length > 0)
				await this.db.saveContracts(newCreations, chain ?? this.#chain);
		}
		return addresses.map(a => results.get(a)!);
	}

	getLogs(address: Hex.String, topics?: string[], topicOpr?: "and" | "or", blockRange?: Etherscan.BlockRange, pagination?: Etherscan.Pagination, chain?: number): Promise<any[]>;
	getLogs(topics: string[], address?: Hex.String, topicOpr?: "and" | "or", blockRange?: Etherscan.BlockRange, pagination?: Etherscan.Pagination, chain?: number): Promise<any[]>;
	getLogs(
		param1: Hex.String | string[],
		param2?: string[] | Hex.String,
		topicOpr: "and" | "or" = "and",
		blockRange: Etherscan.BlockRange = "all",
		pagination?: Etherscan.Pagination,
		chain?: number
	): Promise<Etherscan.Log[]> {
		let [address, topics] = Array.isArray(param1)
			? [param2 as Hex.String | undefined, param1]
			: [param1, param2 as string[] | undefined];
		if (topics) {
			if (!Array.isArray(topics) || topics.length == 0 || topics.length > 4)
				throw new Error(`Invalid topics: ${topics}`);
		}
		const params: Record<string, string> = {};
		if (address !== undefined)
			params.address = Hex.verifyAddress(address);
		if (topics !== undefined) {
			for (let i = 0; i < topics.length; ++i) {
				params[`topic${i}`] = topics[i];
				if (i > 0)
					params[`topic${i - 1}_${i}_opr`] = topicOpr;
			}
		}
		Etherscan.#setBlockRange(params, blockRange, ["fromBlock", "toBlock"]);
		return this.#requestWithPagination<Etherscan.Log[]>(
			"logs", "getLogs", chain, params, pagination
		);
	}
}

export namespace Etherscan {
	export enum APITier {
		Free,
		Standard,
		Advanced,
		Professional,
		ProPlus
	}

	export type ApiKey = readonly [key: string, tier?: APITier];

	export const rateLimits: Record<APITier, [perSecond: number, perDay: number]> = {
		[Etherscan.APITier.Free]: [5, 100_000],
		[Etherscan.APITier.Standard]: [10, 200_000],
		[Etherscan.APITier.Advanced]: [20, 500_000],
		[Etherscan.APITier.Professional]: [30, 1_000_000],
		[Etherscan.APITier.ProPlus]: [30, 1_500_000]
	};

	export type BlockRange = [startBlock?: number, endBlock?: number] | "all";
	export type Pagination = [page?: number, offset?: number] | "all";
	export type Topics = [topic0: Hex.Topic, topic1?: Hex.Topic, topic2?: Hex.Topic, topic3?: Hex.Topic];

	export interface Response<T = any> {
		status: string;
		message: string;
		result: T;
	}

	export interface TransactionByAddress {
		blockNumber: NumStr;
		timeStamp: NumStr;
		hash: Hex.TxHash;
		nonce: NumStr;
		blockHash: Hex.BlockHash;
		transactionIndex: NumStr;
		from: Hex.Address;
		to: Hex.Address | "";
		value: NumStr;
		gas: NumStr;
		gasPrice: NumStr;
		isError: "0" | "1";
		txreceipt_status: "0" | "1";
		input: Hex.String;
		contractAddress: Hex.Address | "";
		cumulativeGasUsed: NumStr;
		gasUsed: NumStr;
		confirmations: NumStr;
		methodId: Hex.Selector;
		functionName: string;
	}

	export interface ContractCreation {
		contractAddress: Hex.Address;
		/**
		 * EOA address of the sender of the transaction within which the contract was created.
		 */
		contractCreator: Hex.Address | "GENESIS";
		txHash: Hex.TxHash | `GENESIS_${Hex.AddressNP}`;
		blockNumber: NumStr;
		timestamp: NumStr;
		/**
		 * The address of the other contract that sent the creation bytecode, if applicable.
		 */
		contractFactory: Hex.Address | "";
		creationBytecode: Hex.String;
	}

	export interface Log {
		address: Hex.Address;
		topics: Topics;
		data: Hex.String;
		blockNumber: Hex.String;
		timeStamp: Hex.String;
		gasPrice: Hex.String;
		gasUsed: Hex.String;
		logIndex: Hex.String;
		transactionHash: Hex.TxHash;
		transactionIndex: Hex.String;
	}
}