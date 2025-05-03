import { Promisable } from "type-fest";
import { DataSource, type DataSourceOptions, type EntityTarget, type ObjectLiteral } from "typeorm";
import { CallTrace } from "./entities";
import { typeormConfig } from "../config/typeorm";
import { TraceConverter } from "../converters";
import type { DebugTrace, Trace } from "../providers";
import { Hex } from "../utils";


export class Database {
	static readonly default = new Database(typeormConfig);

	#source: Promisable<DataSource>;

	constructor(options?: DataSourceOptions) {
		options ??= typeormConfig;
		this.#source = new DataSource(options).initialize();
	}

	async getRepository<T extends ObjectLiteral>(entity: EntityTarget<T>) {
		const source = this.#source instanceof DataSource ? this.#source : await this.#source;
		if (!source.isInitialized)
			throw new Error("Database not initialized");
		return source.manager.getRepository(entity);
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