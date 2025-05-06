import { Etherscan, QuickNode, Tenderly } from "../providers";
import { Chain } from "./Chain";

const {
	ETHERSCAN_API_KEY: etherscanApiKey_,
	ETHERSCAN_API_TIER: etherscanApiTier = "Free"
} = process.env;

if (!etherscanApiKey_)
	throw new Error("ETHERSCAN_API_KEY is not set");
if (!/^[A-Z\d]{34}$/.test(etherscanApiKey_))
	throw new Error(`Invalid ETHERSCAN_API_KEY: ${etherscanApiKey_}`);

const apiTier: Etherscan.APITier = (() => {
	switch (etherscanApiTier.toLowerCase()) {
		case "free": return Etherscan.APITier.Free;
		case "standard": return Etherscan.APITier.Standard;
		case "advanced": return Etherscan.APITier.Advanced;
		case "professional": return Etherscan.APITier.Professional;
		case "proplus": return Etherscan.APITier.ProPlus;
		default: throw new Error(`Invalid ETHERSCAN_API_TIER: ${etherscanApiTier}`);
	}
})();

export const etherscanApiKey: Etherscan.ApiKey =
	Object.freeze([etherscanApiKey_, apiTier] as const);

const {
	QUICKNODE_ENDPOINT: qnEndpoint,
	QUICKNODE_TOKEN: qnToken,
	QUICKNODE_PLAN: qnPlan_ = "Free"
} = process.env;

const qnPlan: QuickNode.Plan = (() => {
	switch (qnPlan_.toLowerCase()) {
		case "free": return QuickNode.Plan.Free;
		case "build": return QuickNode.Plan.Build;
		case "accelerate": return QuickNode.Plan.Accelerate;
		case "scale": return QuickNode.Plan.Scale;
		case "business": return QuickNode.Plan.Business;
		default: throw new Error(`Invalid QUICKNODE_PLAN: ${qnPlan_}`);
	}
})();

export const quickNodeApiKey = qnEndpoint && qnToken
	? Object.freeze([qnEndpoint, qnToken, qnPlan]) as QuickNode.ApiKey
	: undefined;

const tenderlyKeyPrefix = "TENDERLY_ACCESS_KEY_";
const tenderlyKeys = Object.keys(process.env)
	.filter(key => key.startsWith(tenderlyKeyPrefix))
	.map(key => [key, process.env[key]] as const)
	.filter((pair): pair is [string, string] => Boolean(pair[1]))
	.map(([name, value]) => {
		const chain = name.substring(tenderlyKeyPrefix.length)
			.split("_")
			.map(part => part.charAt(0).toUpperCase() + part.substring(1).toLowerCase())
			.join("");
		if (!(chain in Chain))
			throw new Error(`Invalid chain name in TENDERLY_ACCESS_KEY: ${chain} (${name})`);
		if (!Tenderly.supports(chain))
			throw new Error(`Tenderly does not support ${chain} (${name})`);
		return [chain, value] as const;
	});

export const tenderlyNodeAccessKeys: Tenderly.ApiKeys = Object.freeze(Object.fromEntries(tenderlyKeys));