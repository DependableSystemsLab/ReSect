import chalk from "chalk";
import cliProgress from "cli-progress";
import { QueryFailedError } from "typeorm";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import readline from "node:readline";
import { Chain } from "../src/config/Chain";
import { etherscanApiKeys, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { CallTrace, Database, ReentrancyAttack, Transaction } from "../src/database";
import { Etherscan, QuickNode, Tenderly } from "../src/providers";
import { Analyzer, Scope, TraceNotFoundError, type AnalysisResult } from "../src/core";
import type { Hex } from "../src/utils";


type Promisable<T> = T | Promise<T>;

function convertScope(scope: ReentrancyAttack.Scope): Scope {
	switch (scope) {
		case ReentrancyAttack.Scope.SingleFunction:
			return Scope.SingleFunction;
		case ReentrancyAttack.Scope.CrossFunction:
			return Scope.CrossFunction;
		case ReentrancyAttack.Scope.CrossContract:
		case ReentrancyAttack.Scope.CrossProject:
		case ReentrancyAttack.Scope.CrossChain:
			return Scope.CrossContract;
		default:
			throw new Error(`Unknown scope: ${scope}`);
	}
}

const errorCheckers: Record<string, (err: any) => boolean | Promisable<string | Error>> = {
	chainCompatibility(err) {
		if (!(err instanceof Error))
			return false;
		const msg = err.message;
		return msg.startsWith("Invalid chain ID:") || msg.startsWith("Invalid txhash:");
	},
	notFound(err) {
		return err instanceof TraceNotFoundError;
	},
	network(err) {
		if (err instanceof Response)
			return err.bodyUsed ? true : err.clone().text().then(text => `${err.status}: ${text}`);
		if (!(err instanceof Error))
			return false;
		return err.message === "fetch failed";
	},
	database(err) {
		if (!(err instanceof QueryFailedError))
			return false;
		delete (err as any).parameters;
		delete (err as any).driverError;
		return err;
	}
};

function* flattenError(err: any): Generator<any> {
	if (!(err instanceof AggregateError))
		yield err;
	else {
		for (const inner of err.errors)
			yield* flattenError(inner);
	}
}

async function handleError(error: any, stats: Record<string, number>) {
	let matched = false;
	let key: keyof typeof errorCheckers;
	let message = error;
	for (key in errorCheckers) {
		const func = errorCheckers[key];
		let match = true;
		const errors = Array.from(flattenError(error));
		const results = new Array<ReturnType<typeof func>>();
		for (const e of errors) {
			const r = func(e);
			if (r === false) {
				match = false;
				break;
			}
			results.push(r);
		}
		if (match) {
			stats[key] ??= 0;
			++stats[key];
			matched = true;
			const messages = [];
			for (let i = 0; i < results.length; ++i) {
				let result = results[i];
				if (result instanceof Promise)
					result = await result;
				messages.push(typeof result === "boolean" ? errors[i] : result);
			}
			message = messages.length === 1 ? messages[0] : messages;
			break;
		}
	}
	if (!matched) {
		stats.other ??= 0;
		++stats.other;
	}
	++stats.total;
	console.log(message);
}

type FnTx = Pick<Transaction.WithAttack, "hash" | "chain" | "attack">;
type FpTx = Transaction.WithRelations<"chain">;
interface EvaluationOptions {
	database: boolean;
	concurrency: number;
	progressBar: boolean;
	printReentrancyDetails: boolean;
}

async function evaluate(type: "fn", txns: readonly FnTx[], options?: Partial<EvaluationOptions>): Promise<void>;
async function evaluate(type: "fp", txns: readonly FpTx[], options?: Partial<EvaluationOptions>): Promise<void>;
async function evaluate(
	type: "fn" | "fp",
	txns: readonly FnTx[] | readonly FpTx[],
	options: Partial<EvaluationOptions> = {}
) {
	const opts: EvaluationOptions = {
		database: options.database ?? true,
		concurrency: options.concurrency ?? 1,
		progressBar: options.progressBar ?? type === "fp",
		printReentrancyDetails: options.printReentrancyDetails ?? type === "fp"
	};
	const database = Database.default;
	const txRepo = await database.getRepository(Transaction);
	const etherscan = new Etherscan(etherscanApiKeys, Chain.Ethereum, opts.database ? database : undefined);
	const provider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, undefined, opts.database ? database : undefined)
		: new Tenderly(tenderlyNodeAccessKeys, undefined, opts.database ? database : undefined);

	const stats = {
		detected: 0,
		passed: 0,
		mismatch: { total: 0 } as Record<string, number>,
		positive: new Array<{ hash: Hex.TxHash, result: AnalysisResult; }>(),
		errors: { total: 0 } as Record<string, number>,
	};
	const bar = opts.progressBar ? new cliProgress.SingleBar({
		format: `{bar} {percentage}% | Time: {duration_formatted} | {value}/{total} txs | {speed} txs/s | {message}`,
		fps: 5,
		hideCursor: true,
		autopadding: true
	}, cliProgress.Presets.shades_classic) : undefined;
	const width = Math.floor(Math.log10(txns.length)) + 1;
	const log = (msg: string, index?: number, resetCursor = true) => {
		if (resetCursor) {
			readline.clearLine(process.stdout, 0);
			readline.cursorTo(process.stdout, 0);
		}
		console.log(index === undefined ? msg : chalk.grey`[${(index + 1).toString().padStart(width, " ")}/${txns.length}] ` + msg);
	};

	const fnTest = async (txn: FnTx, index: number) => {
		const analyzer = new Analyzer(etherscan, provider, provider);
		const hash = `0x${txn.hash}` as const;
		const attack = txn.attack!;

		const txInfo = `${attack.name} (${hash} on ${txn.chain.name})`;
		log(chalk.white`Analyzing ${txInfo}`, index);
		bar?.update({ message: txInfo });

		let detected = false;
		let readonly = false;
		const scopes = new Set<Scope>();
		const entranceTypes = new Set<ReentrancyAttack.EntryPoint>();

		const results = new Array<AnalysisResult>();
		try {
			for await (const result of analyzer.analyze(hash, txn.chain.id)) {
				detected = true;
				scopes.add(result.scope);
				if (result.readonly === true)
					readonly = true;
				result.entrances.forEach(e => entranceTypes.add(e.type));
				results.push(result);
			}
		}
		catch (err) {
			log(chalk.red`Analysis Error: ${txInfo}`, index);
			await handleError(err, stats.errors);
			return;
		}

		if (!detected) {
			log(chalk.yellow`No attack detected for ${txInfo}`, index);
			return;
		}
		++stats.detected;
		const expected: Record<string, any> = {};
		const actual: Record<string, any> = {};
		if (attack.scope != null) {
			expected.scope = convertScope(attack.scope);
			actual.scope = scopes.has(expected.scope) ? expected.scope : Array.from(scopes);
		}
		if (attack.entryPoint != null) {
			expected.entryPoint = attack.entryPoint;
			actual.entryPoint = entranceTypes.has(expected.entryPoint) ? expected.entryPoint : Array.from(entranceTypes);
		}
		let equal = true;
		for (const key in expected) {
			if (actual[key] !== expected[key]) {
				if (equal) {
					log(chalk.yellow`Mismatched analysis for ${txInfo}:`, index);
					equal = false;
				}
				log(chalk.yellow`  Expected ${key} to be ${expected[key]}, but got ${actual[key]}`, index);
				stats.mismatch[key] ??= 0;
				++stats.mismatch[key];
			}
		}
		if (!equal)
			++stats.mismatch.total;
		else {
			++stats.passed;
			log(chalk.green`Test passed: ${attack.name}`, index);
		}
		if (opts.printReentrancyDetails)
			results.forEach(r => log(r.toString()));
	};

	const fpTest = async (txn: FpTx, index: number) => {
		const analyzer = new Analyzer(etherscan, provider, provider);
		const hash = `0x${txn.hash}` as const;

		let result: AnalysisResult | undefined;
		for (let retry = 3; ; --retry) {
			try {
				for await (result of analyzer.analyze(hash, txn.chain.id))
					break;
			}
			catch (err) {
				if (retry > 0 && err instanceof QueryFailedError && ((err as any).code === "23505" || err.driverError.code === "23505")) {
					analyzer.reset(true);
					continue; // Retry on unique violation (potentially concurrency conflict)
				}
				log(chalk.red`Analysis Error: ${hash}`, index);
				await handleError(err, stats.errors);
				return;
			}
			break;
		}

		const tags = txn.tags ?? 0;
		txn.setTags(Transaction.Tags.Reentrancy, result !== undefined);
		if (txn.tags !== tags) {
			await txRepo.update(txn.hash, { tags: txn.tags })
				.catch(err => {
					log(chalk.red`Failed to update tags for ${hash}`, index);
					console.log(err);
				});
		}

		if (result) {
			stats.positive.push({ hash, result });
			log(chalk.yellow`Positive detected: ${hash}`, index);
			if (opts.printReentrancyDetails)
				log(result.toString());
			bar?.update({ message: `Reentrancy: ${stats.positive.length}` });
		}
	};

	bar?.start(txns.length, 0);
	const startTime = Date.now();
	let completed = 0;
	const finalize = () => {
		++completed;
		bar?.update(completed, { speed: (completed / ((Date.now() - startTime) / 1000)).toFixed(1) });
	};
	process.on("SIGINT", () => {
		bar?.stop();
		printResult();
		process.exit(0);
	});
	await txns.forEachAsync(
		type === "fn"
			? (txn, idx) => fnTest(txn as FnTx, idx).finally(finalize)
			: (txn, idx) => fpTest(txn as FpTx, idx).finally(finalize),
		txns,
		{ maxConcurrency: opts.concurrency }
	);
	const endTime = Date.now();
	bar?.stop();

	function printResult(timestamp: number = Date.now()) {
		log(chalk.white`Evaluated ${completed} transactions in ${((timestamp - startTime) / 1000).toFixed(1)}s`);
		log(chalk.white`Evaluation Summary:`);
		const logStats = (color: chalk.Chalk, label: string, count: number, total: number) =>
			log(color`${label}: ${count}/${total} (${(count / total * 100).toFixed(2)}%)`);
		if (type === "fp") {
			const total = completed - stats.errors.total;
			const positive = stats.positive.length;
			logStats(chalk.green, "Negatives", total - positive, total);
			if (positive > 0) {
				logStats(chalk.yellow, "Positives", positive, total);
				const scopeCount = new Map<Scope, number>();
				const entryPointCount = new Map<ReentrancyAttack.EntryPoint, number>();
				for (const { result } of stats.positive) {
					scopeCount.set(result.scope, (scopeCount.get(result.scope) ?? 0) + 1);
					new Set(result.entrances).forEach(e => {
						entryPointCount.set(e.type, (entryPointCount.get(e.type) ?? 0) + 1);
					});
				}
				for (const [scope, count] of scopeCount)
					logStats(chalk.yellow, `  Scope ${Scope[scope]}`, count, positive);
				for (const [entryPoint, count] of entryPointCount)
					logStats(chalk.yellow, `  EntryPoint ${entryPoint}`, count, positive);
			}
		}
		else {
			logStats(chalk.cyan, `Detection`, stats.detected, completed - stats.errors.total);
			logStats(chalk.green, `Analysis`, stats.passed, stats.detected);
			const keys = Object.keys(stats.mismatch);
			if (keys.length > 1) {
				logStats(chalk.yellow, `Mismatches`, stats.mismatch.total, stats.detected);
				for (const key of keys) {
					if (key !== "total")
						logStats(chalk.yellow, `  ${key}`, stats.mismatch[key], stats.detected);
				}
			}
		}
		const keys = Object.keys(stats.errors);
		if (keys.length > 1) {
			logStats(chalk.red, `Errors`, stats.errors.total, completed);
			for (const key of keys) {
				if (key !== "total")
					logStats(chalk.red, `  ${key}`, stats.errors[key], completed);
			}
		}
	}
	printResult(endTime);
}

const cliParser = yargs()
	.option("type", {
		alias: "t",
		type: "string",
		choices: ["fn", "fp"] as const,
		default: "fn" as const,
		description: "Type of evaluation ('fn' for false negatives, 'fp' for false positives)"
	})
	.option("chain", {
		alias: "c",
		type: "string",
		description: "Blockchain network. Can be either chain name or chain ID",
		coerce(value: string) {
			if (/^\d+$/.test(value))
				return Number.parseInt(value);
			if (!(value in Chain))
				throw new Error(`Unknown chain: ${value}`);
			return Chain[value as keyof typeof Chain];
		}
	})
	.option("total", {
		type: "string",
		default: "all",
		description: "Total number of transactions to evaluate. Use 'all' for all transactions, or 'first' in case of false negatives to use only the first transaction of each attack",
		coerce(value: string) {
			if (value === "all" || value === "first")
				return value;
			const n = Number.parseInt(value);
			if (!Number.isSafeInteger(n))
				throw new Error(`Invalid total: ${value}`);
			return n;
		}
	})
	.option("skip", {
		type: "number",
		default: 0,
		description: "Number of transactions to skip. This option is only relevant for false negative evaluation, where transactions are ordered by block number"
	})
	.option("concurrency", {
		type: "number",
		default: 1,
		description: "Number of concurrent tests to run"
	})
	.option("database", {
		alias: "d",
		type: "boolean",
		default: true,
		description: "Use database for analysis"
	})
	.option("progress-bar", {
		type: "boolean",
		default: undefined,
		description: "Whether to show progress bar during evaluation. Defaults to true for false positive evaluation and false for false negative evaluation"
	})
	.option("print-reentrancy-details", {
		type: "boolean",
		default: undefined,
		description: "Whether to print reentrancy details for positive cases. Defaults to true for false positive evaluation and false for false negative evaluation"
	})
	.option("only-with-cache", {
		type: "boolean",
		default: false,
		description: "Only evaluate transactions that have cached traces in the database"
	})
	.option("only-without-cache", {
		type: "boolean",
		default: false,
		description: "Only evaluate transactions that do not have cached traces in the database"
	})
	.option("only-positive", {
		type: "boolean",
		default: false,
		description: "Only evaluate transactions that are classified as positive"
	})
	.check(argv => {
		if (argv.type === "fp" && argv.total === "first")
			return "Option --total=first is not valid for false positive evaluation";
		if (argv.type === "fn" && typeof argv.total === "number")
			return "Option --total must be either 'all' or 'first' for false negative evaluation";
		if (argv["only-with-cache"] && argv["only-without-cache"])
			return "Options --only-with-cache and --only-without-cache cannot be used together";
		return true;
	})
	.help()
	.alias("help", "h");

type CliArg = Awaited<typeof cliParser.argv>;

async function filterCollection<T extends Transaction>(
	collection: T[],
	argv: Pick<CliArg, "onlyWithCache" | "onlyWithoutCache" | "onlyPositive">
): Promise<typeof collection> {
	if (argv.onlyWithCache || argv.onlyWithoutCache) {
		const traceRepo = await Database.default.getRepository(CallTrace);
		const hashColumn = traceRepo.metadata.findColumnWithPropertyName("txHash")!;
		const cached = await traceRepo.createQueryBuilder("t")
			.select(`t."${hashColumn.databaseName}"`, "hash")
			.distinct(true)
			.getRawMany<{ hash: CallTrace["txHash"]; }>()
			.then(rows => new Set(rows.map(r => r.hash)));
		collection = collection.filter(
			argv.onlyWithCache
				? tx => cached.has(tx.hash)
				: tx => !cached.has(tx.hash)
		);
	}
	if (argv.onlyPositive)
		collection = collection.filter(tx => tx.hasTags(Transaction.Tags.Reentrancy));
	return collection;
}

(async () => {
	const { type, chain: chainId, total, ...argv } = await cliParser.parseAsync(hideBin(process.argv));
	if (type === "fn") {
		const txns = await Database.default.getAttackTransactions(undefined, Transaction.Tags.Exploit);
		let collection: Transaction.WithAttack[];
		if (total === "all")
			collection = txns;
		else {
			const attackTxns = new Map<number, typeof txns[0]>();
			for (const txn of txns) {
				if (txn.attackId == null)
					continue;
				const existing = attackTxns.get(txn.attackId);
				if (!existing || existing.timestamp == null || txn.timestamp && txn.timestamp < existing.timestamp)
					attackTxns.set(txn.attackId, txn);
			}
			collection = Array.from(attackTxns.values());
		}
		if (chainId !== undefined)
			collection = collection.filter(tx => tx.chainId === chainId);
		collection = await filterCollection(collection, argv);
		await evaluate("fn", collection, argv);
	}
	else {
		let collection = await Database.default.getFpEvaluationTransactions(chainId, total === "all" ? undefined : total as number, argv.skip);
		collection = await filterCollection(collection, argv);
		await evaluate("fp", collection, argv);
	}
	process.exit(0);
})();