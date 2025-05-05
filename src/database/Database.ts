import { Promisable } from "type-fest";
import { DataSource, In, type DataSourceOptions, type EntityTarget, type ObjectLiteral } from "typeorm";
import { Block, CallTrace, Contract, Transaction } from "./entities";
import { typeormConfig } from "../config/typeorm";
import { EtherscanConverter, JsonRpcConverter, TraceConverter } from "../converters";
import type { Etherscan, RPC } from "../providers";
import { Hex, type Trace, type DebugTrace } from "../utils";


export class Database {
	static #default: Database | undefined;

	static get default() {
		this.#default ??= new Database(typeormConfig);
		return this.#default;
	}

	#source: Promisable<DataSource>;

	constructor(options: DataSourceOptions) {
		this.#source = new DataSource(options).initialize();
	}

	private verifyPrimaryKey<Entity extends ObjectLiteral>(id: number | string | Partial<Entity>, pks: string[], entityName: string): Partial<Entity> {
		if (typeof id != "object" && pks.length > 1)
			throw new Error(`Entity ${entityName} has multiple primary keys`);
		if (typeof id == "object") {
			const missingKeys: string[] = [];
			for (const key of pks) {
				if (id[key] == undefined)
					missingKeys.push(key);
			}
			if (missingKeys.length)
				throw new Error(`Missing primary key(s) for entity ${entityName}: ${missingKeys.join(", ")}`);
		}
		const result: Partial<Entity> = {};
		if (typeof id != "object")
			// @ts-expect-error
			result[pks[0]] = id;
		else {
			for (const key of pks)
				// @ts-expect-error
				result[key] = id[key];
		}
		return result;
	}

	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: number | string): Promise<boolean>;
	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: Partial<Entity>): Promise<boolean>;
	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: number | string | Partial<Entity>): Promise<boolean> {
		const src = await this.#source;
		const metadata = src.getMetadata(entity);
		const pks = metadata.primaryColumns.map(col => col.propertyName);
		const params = this.verifyPrimaryKey(id, pks, metadata.name);
		const filter = pks.map(k => `"${k}" = :${k}`).join(" AND ");
		return src.createQueryBuilder(entity, metadata.name)
			.select(`"${pks[0]}"`)
			.where(filter, params)
			.limit(1)
			.getRawOne()
			.then(result => result != null);
	}

	async getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>) {
		const source = this.#source instanceof DataSource ? this.#source : await this.#source;
		if (!source.isInitialized)
			throw new Error("Database not initialized");
		return source.manager.getRepository(entity);
	}

	async getContracts(addresses: Hex.String[]): Promise<Etherscan.ContractCreation[]> {
		const addrs = addresses.map(a => Hex.removePrefix(Hex.verifyAddress(a)));
		const repo = await this.getRepository(Contract);
		const entities = await repo.find({
			where: { address: In(addrs) },
			relations: { creationBlock: true }
		});
		return entities.map(EtherscanConverter.entityToContractCreation);
	}

	async saveContracts(contracts: Etherscan.ContractCreation[]): Promise<Contract[]> {
		const repo = await this.getRepository(Contract);
		const entities = contracts.map(EtherscanConverter.contractCreationToEntity);
		return await repo.save(entities);
	}

	async saveBlock(block: RPC.Block, chainId: number): Promise<Block> {
		const repo = await this.getRepository(Block);
		const entity = JsonRpcConverter.blockToEntity(block, chainId);
		return await repo.save(entity);
	}

	async saveTransaction(transaction: RPC.Transaction): Promise<Transaction> {
		const repo = await this.getRepository(Transaction);
		const entity = JsonRpcConverter.transactionToEntity(transaction);
		return await repo.save(entity);
	}

	async getDebugTrace(txHash: Hex.String): Promise<DebugTrace<Trace> | undefined> {
		const hash = Hex.removePrefix(Hex.verifyTxHash(txHash));
		const repo = await this.getRepository(CallTrace);
		const traces = await repo.find({
			where: { txHash: hash },
			relations: undefined,
			order: { index: "ASC" }
		});
		if (traces.length === 0)
			return undefined;
		const topTrace = TraceConverter.buildEntityHierarchy(traces, false)[0];
		return TraceConverter.entityToDebugTrace(topTrace);
	}

	async saveDebugTrace(trace: DebugTrace<Trace>, txHash: Hex.TxHash): Promise<CallTrace[]> {
		const traces = TraceConverter.debugTraceToEntities(trace, txHash);
		const manager = await this.getRepository(CallTrace);
		return await manager.save(traces);
	}
}