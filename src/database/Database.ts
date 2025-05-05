import { Promisable } from "type-fest";
import { DataSource, type DataSourceOptions, type EntityTarget, type ObjectLiteral } from "typeorm";
import { Block, CallTrace, Transaction } from "./entities";
import { typeormConfig } from "../config/typeorm";
import { JsonRpcConverter, TraceConverter } from "../converters";
import type { DebugTrace, RPC, Trace } from "../providers";
import { Hex } from "../utils";


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

	async saveDebugTrace(trace: DebugTrace<Trace>, txHash: Hex): Promise<CallTrace[]> {
		const traces = TraceConverter.debugTraceToEntities(trace, txHash);
		const manager = await this.getRepository(CallTrace);
		return await manager.save(traces);
	}

	async getDebugTrace(txHash: Hex): Promise<DebugTrace<Trace> | undefined> {
		const repo = await this.getRepository(CallTrace);
		txHash = Hex.toString(txHash);
		const traces = await repo.find({
			where: { txHash },
			relations: undefined,
			order: { index: "ASC" }
		});
		if (traces.length === 0)
			return undefined;
		const topTrace = TraceConverter.buildEntityHierarchy(traces, false)[0];
		return TraceConverter.entityToDebugTrace(topTrace);
	}
}