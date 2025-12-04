import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Chain } from "../src/config/Chain";
import { etherscanApiKeys, quickNodeApiKey, tenderlyNodeAccessKeys } from "../src/config/credentials";
import { Database } from "../src/database";
import { Etherscan, QuickNode, Tenderly } from "../src/providers";
import { Analyzer } from "../src/core";
import { Hex } from "../src/utils";

const cliParser = yargs()
	.command("$0 <tx-hash>", "Analyze a transaction for reentrancy vulnerabilities")
	.positional("tx-hash", {
		type: "string",
		description: "Transaction hash to analyze",
		demandOption: true,
		coerce(value: string) {
			return Hex.verifyTxHash(Hex.addPrefix(value));
		}
	})
	.option("chain", {
		alias: "c",
		type: "string",
		description: "Blockchain network. Can be either chain name or chain ID",
		default: "1",
		coerce(value: string) {
			if (/^\d+$/.test(value))
				return Number.parseInt(value);
			if (!(value in Chain))
				throw new Error(`Unknown chain: ${value}`);
			return Chain[value as keyof typeof Chain];
		}
	})
	.option("database", {
		alias: "d",
		type: "boolean",
		default: true,
		description: "Use database for analysis"
	})
	.option("early-exit", {
		type: "boolean",
		default: false,
		description: "Report reentrancy immediately when found, without analyzing the full trace. Only applicable for false negative evaluation"
	})
	.strict()
	.help()
	.alias("help", "h");

(async () => {
	const { txHash, chain: chainId, database: useDatabase, earlyExit } = await cliParser.parseAsync(hideBin(process.argv));
	const database = useDatabase ? Database.default : undefined;

	const etherscan = new Etherscan(etherscanApiKeys, Chain.Ethereum, database);
	const provider = quickNodeApiKey
		? new QuickNode(quickNodeApiKey, "Ethereum", database)
		: new Tenderly(tenderlyNodeAccessKeys, "Ethereum", database);
	const analyzer = new Analyzer(etherscan, provider, provider);

	let first = false;
	for await (const result of analyzer.analyze(txHash, chainId, !earlyExit)) {
		if (!first) {
			console.log(result.toString("addresses"));
			first = true;
		}
		console.log(result.toString("characteristics"));
	}
	process.exit(0);
})();