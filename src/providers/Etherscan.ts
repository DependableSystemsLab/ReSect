import "basic-type-extensions";
import { createThrottledFetch } from "fetch-throttler";
import { Arrayable } from "type-fest";
import { toURLSearchParams, Hex, type QueryObject } from "../utils";
import type { RPC } from "./base";
import type { Database } from "../database";


const fetchInstances = new Map<string, typeof fetch>();
function getFetch(apiKey: string | readonly [key: string, tier: Etherscan.APITier]) {
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

export class Etherscan {
	static readonly BASE_URL = "https://api.etherscan.io/v2/api";

	#chainId: number = 1;
	readonly #db: Database | undefined;
	readonly #fetch: typeof fetch;

	readonly apiKey: string;
	readonly geth: Etherscan.Geth;

	constructor(
		apiKey: string | readonly [key: string, tier: Etherscan.APITier],
		chainId: number = 1,
		database?: Database
	) {
		this.#chainId = chainId;
		[this.apiKey, this.#fetch] = getFetch(apiKey);
		this.geth = new Etherscan.Geth(apiKey, chainId);
		if (database)
			this.#db = database;
	}

	get chainId() {
		return this.#chainId;
	}
	set chainId(chainId: number) {
		this.#chainId = chainId;
		this.geth.chainId = chainId;
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
		params?: QueryObject
	): Promise<T> {
		params ??= {};
		const searchParams = toURLSearchParams({
			...params,
			module,
			action,
			apikey: this.apiKey,
			chainid: chain ?? this.chainId
		});
		const url = new URL(Etherscan.BASE_URL);
		url.search = searchParams.toString();
		const response = await this.#fetch(url.href, {
			method: "GET",
			headers: {
				"Accept": "application/json"
			}
		});
		const resp = await response.json() as Etherscan.Response<T>;
		if (!response.ok)
			throw new Error(`Etherscan API error: ${response.status} ${response.statusText}`);
		if (resp.status !== "1")
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

	getBlockNumberByTimestamp(timestamp?: number, closest: "before" | "after" = "before", chain?: number): Promise<number> {
		timestamp ??= Math.floor(Date.now() / 1000);
		if (timestamp < 0)
			throw new Error(`Invalid timestamp: ${timestamp}`);
		return this.#request<number>("block", "getblocknobytime", chain, { timestamp, closest });
	}

	getTransactionsByAddress(
		address: Hex,
		blockRange: Etherscan.BlockRange = "all",
		pagination?: Etherscan.Pagination,
		chain?: number
	): Promise<Etherscan.TransactionByAddress[]> {
		address = Hex.verifyAddress(address);
		const params = { address, sort: "asc" };
		Etherscan.#setBlockRange(params, blockRange);
		return this.#requestWithPagination<Etherscan.TransactionByAddress[]>(
			"account", "txlist", chain, params, pagination
		);
	}

	async getContractCreation(contractAddresses: Arrayable<Hex>, chain?: number): Promise<(Etherscan.ContractCreation | undefined)[]> {
		if (!Array.isArray(contractAddresses))
			contractAddresses = [contractAddresses];
		const addresses = contractAddresses.map(Hex.verifyAddress);
		const results = new Map<string, Etherscan.ContractCreation>();
		if (this.#db) {
			await this.#db.getContracts(addresses)
				.then(cs => cs.forEach(c => results.set(c.contractAddress, c)));
			if (results.size === addresses.length)
				return addresses.map(a => results.get(a));
			contractAddresses = addresses.filter(c => !results.has(c));
		}
		if (contractAddresses.length <= 5) {
			await this.#request<Etherscan.ContractCreation[]>("contract", "getcontractcreation", chain, { contractAddresses })
				.then(rs => rs.forEach(c => results.set(c.contractAddress, c)));
		}
		else {
			const slices = new Array(Math.ceil(contractAddresses.length / 5));
			for (let i = 0; i < contractAddresses.length; i += 5)
				slices[i / 5] = contractAddresses.slice(i, i + 5);
			await slices.forEachAsync(slice => {
				this.#request<Etherscan.ContractCreation[]>("contract", "getcontractcreation", chain, { contractAddresses: slice })
					.then(rs => rs.forEach(c => results.set(c.contractAddress, c)));
			});
		}
		if (this.#db) {
			const newCreations = contractAddresses.map(c => results.get(c as string)).filter(c => c !== undefined);
			if (newCreations.length > 0)
				await this.#db.saveContracts(newCreations);
		}
		return addresses.map(a => results.get(a));
	}

	getLogs(address: Hex, topics?: string[], topicOpr?: "and" | "or", blockRange?: Etherscan.BlockRange, pagination?: Etherscan.Pagination, chain?: number): Promise<any[]>;
	getLogs(topics: string[], address?: Hex, topicOpr?: "and" | "or", blockRange?: Etherscan.BlockRange, pagination?: Etherscan.Pagination, chain?: number): Promise<any[]>;
	getLogs(
		param1: Hex | string[],
		param2?: string[] | Hex,
		topicOpr: "and" | "or" = "and",
		blockRange: Etherscan.BlockRange = "all",
		pagination?: Etherscan.Pagination,
		chain?: number
	): Promise<Etherscan.Log[]> {
		let [address, topics] = Array.isArray(param1)
			? [param2 as Hex | undefined, param1]
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

	export const rateLimits: Record<Etherscan.APITier, [perSecond: number, perDay: number]> = {
		[Etherscan.APITier.Free]: [5, 100_000],
		[Etherscan.APITier.Standard]: [10, 200_000],
		[Etherscan.APITier.Advanced]: [20, 500_000],
		[Etherscan.APITier.Professional]: [30, 1_000_000],
		[Etherscan.APITier.ProPlus]: [30, 1_500_000]
	};

	export type BlockRange = [startBlock?: number, endBlock?: number] | "all";
	export type Pagination = [page?: number, offset?: number] | "all";
	export type Topics = [topic0: string, topic1?: string, topic2?: string, topic3?: string];

	export interface Response<T = any> {
		status: string;
		message: string;
		result: T;
	}

	export interface TransactionByAddress {
		blockNumber: string;
		timeStamp: string;
		hash: string;
		nonce: string;
		blockHash: string;
		transactionIndex: string;
		from: string;
		to: string;
		value: string;
		gas: string;
		gasPrice: string;
		isError: "0" | "1"
		txreceipt_status: string;
		input: string;
		contractAddress: string;
		cumulativeGasUsed: string;
		gasUsed: string;
		confirmations: string;
		methodId: string;
		functionName: string;
	}

	export interface ContractCreation {
		contractAddress: string;
		/**
		 * EOA address of the sender of the transaction within which the contract was created.
		 */
		contractCreator: string;
		txHash: string;
		blockNumber: string;
		timestamp: string;
		/**
		 * The address of the other contract that sent the creation bytecode, if applicable.
		 */
		contractFactory: string;
		creationBytecode: string;
	}

	export interface Log {
		address: string;
		topics: Topics;
		data: string;
		blockNumber: string;
		timeStamp: string;
		gasPrice: string;
		gasUsed: string;
		logIndex: string;
		transactionHash: string;
		transactionIndex: string;
	}
}

export namespace Etherscan {
	export class Geth implements RPC.MultiChainProvider {
		readonly #fetch: typeof fetch;
		readonly apiKey: string;

		constructor(
			apiKey: string | readonly [key: string, tier: Etherscan.APITier],
			public chainId: number = 1
		) {
			[this.apiKey, this.#fetch] = getFetch(apiKey);
		}

		async #request<T>(
			action: string,
			chain?: number,
			params?: QueryObject
		): Promise<T> {
			params ??= {};
			const searchParams = toURLSearchParams({
				...params,
				module: "proxy",
				action,
				apikey: this.apiKey,
				chainid: chain ?? this.chainId
			});
			const url = new URL(Etherscan.BASE_URL);
			url.search = searchParams.toString();
			const response = await this.#fetch(url.href, {
				method: "GET",
				headers: {
					"Accept": "application/json"
				}
			});
			const resp = await response.json() as RPC.Response<T> | RPC.Error;
			if (!response.ok)
				throw new Error(`Etherscan API error: ${response.status} ${response.statusText}`);
			if ("error" in resp)
				throw new Error(`Etherscan API error: ${resp.error.message} (${resp.error.slug})`);
			return resp.result;
		}

		#verifyBlockTag(tag: RPC.BlockNumber): "earliest" | "latest" | "pending" {
			if (tag == "earliest" || tag == "latest" || tag == "pending")
				return tag;
			throw new Error(`Unsupported block tag: ${tag}`);
		}

		blockNumber(chain?: number): Promise<string> {
			return this.#request<string>("eth_blockNumber", chain);
		}

		getBlockByNumber(blockNumber: RPC.BlockNumber, full: boolean, chain?: number): Promise<RPC.Block> {
			return this.#request<RPC.Block>("eth_getBlockByNumber", chain, { tag: blockNumber, boolean: full });
		}

		getTransactionByHash(hash: string, chain?: number): Promise<RPC.Transaction> {
			return this.#request<RPC.Transaction>("eth_getTransactionByHash", chain, { txhash: hash });
		}

		call(request: RPC.CallRequest, tag: RPC.BlockNumber, chain?: number): Promise<string> {
			tag = this.#verifyBlockTag(tag);
			return this.#request<string>("eth_call", chain, {
				from: request.from,
				to: request.to,
				data: request.input,
				gas: request.gas,
				gasPrice: request.gasPrice,
				value: request.value,
				tag
			});
		}

		getCode(address: string, tag: RPC.BlockNumber, chain?: number): Promise<string> {
			tag = this.#verifyBlockTag(tag);
			return this.#request<string>("eth_getCode", chain, { address, tag });
		}

		getStorageAt(address: string, position: string, tag: RPC.BlockNumber, chain?: number): Promise<string> {
			return this.#request<string>("eth_getStorageAt", chain, { address, position, tag });
		}
	}
}