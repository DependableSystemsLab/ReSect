import { Promisable, type Arrayable } from "type-fest";
import { DataSource, In, IsNull, Not, type DataSourceOptions, type EntityTarget, type ObjectLiteral } from "typeorm";
import { Block, CallTrace, Chain, Contract, Transaction } from "./entities";
import { typeormConfig } from "../config/typeorm";
import { EtherscanConverter, JsonRpcConverter, TraceConverter } from "../converters";
import type { Etherscan, RPC } from "../providers";
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

	#verifyPrimaryKey<Entity extends ObjectLiteral>(
		id: number | string | Partial<Entity>,
		pks: (readonly [propertyName: string, columnName: string])[],
		entityName: string
	): Record<string, any> {
		if (typeof id !== "object" && pks.length > 1)
			throw new Error(`Entity ${entityName} has multiple primary keys`);
		if (typeof id === "object") {
			const missingKeys: string[] = [];
			for (const [pName] of pks) {
				if (id[pName] === undefined)
					missingKeys.push(pName);
			}
			if (missingKeys.length)
				throw new Error(`Missing primary key(s) for entity ${entityName}: ${missingKeys.join(", ")}`);
		}
		const result: Record<string, any> = {};
		if (typeof id !== "object")
			result[pks[0][1]] = id;
		else {
			for (const [pName, cName] of pks)
				result[cName] = id[pName];
		}
		return result;
	}

	async close() {
		const source = await this.#source;
		if (source.isInitialized)
			await source.destroy();
	}

	async has(entity: EntityTarget<Block>, id: Pick<Block, "chainId" | "number">): Promise<boolean>;
	async has(entity: EntityTarget<CallTrace>, id: Pick<CallTrace, "txHash" | "index">): Promise<boolean>;
	async has(entity: EntityTarget<Contract>, id: Hex.AddressNP): Promise<boolean>;
	async has(entity: EntityTarget<Transaction>, id: Hex.TxHashNP): Promise<boolean>;
	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: number | string): Promise<boolean>;
	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: Partial<Entity>): Promise<boolean>;
	async has<Entity extends ObjectLiteral>(entity: EntityTarget<Entity>, id: number | string | Partial<Entity>): Promise<boolean> {
		const src = await this.#source;
		const metadata = src.getMetadata(entity);
		const pks = metadata.primaryColumns.map(col => [col.propertyName, col.databaseName] as const);
		const params = this.#verifyPrimaryKey(id, pks, metadata.name);
		const filter = Object.keys(params).map(k => `"${k}" = :${k}`).join(" AND ");
		return src.createQueryBuilder(entity, metadata.name)
			.select(`"${pks[0][0]}"`)
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

	async getCode(address: Hex.String): Promise<Hex.String | null> {
		const repo = await this.getRepository(Contract);
		const entity = await repo.findOne({
			select: { code: true },
			where: { address: Hex.removePrefix(Hex.verifyAddress(address)) }
		});
		const code = entity?.code;
		return code == null ? null : Hex.toString(code);
	}

	async saveCode(address: Hex.String, code: Hex.String, chainId: number): Promise<Contract> {
		const repo = await this.getRepository(Contract);
		const addr = Hex.removePrefix(Hex.verifyAddress(address));
		let entity = await repo.findOne({
			where: { address: addr }
		});
		entity ??= new Contract(addr, chainId);
		entity.code = Buffer.from(Hex.removePrefix(code), "hex");
		return await repo.save(entity);
	}

	async getContracts(addresses: Hex.String[]): Promise<Etherscan.ContractCreation[]> {
		const addrs = addresses.map(a => Hex.removePrefix(Hex.verifyAddress(a)));
		const repo = await this.getRepository(Contract);
		const entities = await repo.find({
			where: {
				address: In(addrs),
				creationTxHash: Not(IsNull())
			},
			relations: { creationTransaction: { block: true } }
		});
		return entities.map(EtherscanConverter.entityToContractCreation);
	}

	async saveContracts(contracts: Etherscan.ContractCreation[], chainId: number): Promise<Contract[]> {
		const repo = await this.getRepository(Contract);
		const entities = contracts.map(c => EtherscanConverter.contractCreationToEntity(c, chainId));
		return await repo.save(entities);
	}

	async saveBlock(block: RPC.Block, chainId: number): Promise<Block> {
		const repo = await this.getRepository(Block);
		const entity = JsonRpcConverter.blockToEntity(block, chainId);
		return await repo.save(entity);
	}

	async filterTxHashes(txHashes: Hex.String[]): Promise<Hex.TxHash[]> {
		const repo = await this.getRepository(Transaction);
		const entities = await repo.find({
			select: { hash: true },
			where: { hash: In(txHashes.map(h => Hex.removePrefix(Hex.verifyTxHash(h)))) }
		});
		return entities.map(e => Hex.addPrefix(e.hash));
	}

	async getTransaction(txHash: Hex.String): Promise<RPC.Transaction | null> {
		const repo = await this.getRepository(Transaction);
		const entity = await repo.findOne({
			where: { hash: Hex.removePrefix(Hex.verifyTxHash(txHash)) },
			relations: { block: true }
		});
		if (entity === null)
			return null;
		return JsonRpcConverter.entityToTransaction(entity);
	}

	saveTransaction(transaction: RPC.Transaction, chainId: number): Promise<Transaction> {
		return this.saveTransactions([transaction], chainId).then(txs => txs[0]);
	}

	async saveTransactions(transactions: RPC.Transaction[], chainId: number): Promise<Transaction[]> {
		transactions = Array.isArray(transactions) ? transactions : [transactions];
		const repo = await this.getRepository(Transaction);
		const entities = transactions.map(t => JsonRpcConverter.transactionToEntity(t, chainId));
		return await repo.save(entities);
	}

	async getAttackTransactions(
		attackIds?: Arrayable<number>,
		actions?: Arrayable<Transaction.Action>
	): Promise<Transaction.WithAttack[]> {
		if (typeof attackIds === "number")
			attackIds = [attackIds];
		if (typeof actions === "string")
			actions = [actions];
		const manager = (await this.#source).manager;
		let txns = await manager.find(Transaction, {
			where: {
				attackId: attackIds?.length ? In(attackIds) : Not(IsNull()),
			},
			relations: {
				block: true,
				attack: true
			}
		});
		if (actions?.length) {
			const actionSet = new Set(actions);
			txns = txns.filter(tx => tx.actions?.some(a => actionSet.has(a)));
		}

		const chainIds = new Set(txns.map(tx => tx.chainId));
		const chains = await manager.find(Chain, {
			where: { id: In(Array.from(chainIds)) }
		});
		const chainMap = new Map(chains.map(c => [c.id, c]));
		txns.forEach(tx => tx.chain = chainMap.get(tx.chainId!));

		return txns as Transaction.WithAttack[];
	}

	async getDebugTrace(txHash: Hex.String): Promise<RPC.Debug.Trace | null> {
		const hash = Hex.removePrefix(Hex.verifyTxHash(txHash));
		const repo = await this.getRepository(CallTrace);
		const traces = await repo.find({
			where: { txHash: hash },
			relations: undefined,
			order: { index: "ASC" }
		});
		if (traces.length === 0)
			return null;
		const topTrace = TraceConverter.buildEntityHierarchy(traces, false)[0];
		return TraceConverter.entityToDebugTrace(topTrace);
	}

	async saveDebugTrace(trace: RPC.Debug.Trace, txHash: Hex.TxHash): Promise<CallTrace[]> {
		const traces = TraceConverter.debugTraceToEntities(trace, txHash);
		const manager = await this.getRepository(CallTrace);
		return await manager.save(traces);
	}
}