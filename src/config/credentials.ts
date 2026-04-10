import { Etherscan, QuickNode, Tenderly } from "../providers";
import { Chain } from "./Chain";

const ESKPREFIX = "ETHERSCAN_API_KEY";
const ESTPREFIX = "ETHERSCAN_API_TIER";
const ESPATTERN = /^[A-Z\d]{34}$/;

const esApiKeys = Object.keys(process.env)
	.filter(key => key === ESKPREFIX || key.startsWith(`${ESKPREFIX}_`));
const esApiTiers = Object.keys(process.env)
	.filter(key => key === ESTPREFIX || key.startsWith(`${ESTPREFIX}_`));
if (esApiKeys.length === 0)
	throw new Error("ETHERSCAN_API_KEY is not set");
const esApiKeyMap = new Map(esApiKeys.map(key => {
	const value = process.env[key]!;
	if (!ESPATTERN.test(value))
		throw new Error(`Invalid ${key}: ${value}`);
	const suffix = key === ESKPREFIX ? "" : key.substring(`${ESKPREFIX}_`.length);
	return [suffix, value] as const;
}));
function convertEtherscanTier(tier: string | undefined, keyName?: string): Etherscan.APITier {
	if (tier === undefined)
		return Etherscan.APITier.Free;
	switch (tier.toLowerCase()) {
		case "free": return Etherscan.APITier.Free;
		case "standard": return Etherscan.APITier.Standard;
		case "advanced": return Etherscan.APITier.Advanced;
		case "professional": return Etherscan.APITier.Professional;
		case "proplus": return Etherscan.APITier.ProPlus;
		default: throw new Error(`Invalid ${keyName ?? "ETHERSCAN_API_TIER"}: ${tier}`);
	}
}
const esApiTierMap = new Map(esApiTiers.map(key => {
	const value = convertEtherscanTier(process.env[key]!, key);
	const suffix = key === ESTPREFIX ? "" : key.substring(`${ESTPREFIX}_`.length);
	return [suffix, value] as const;
}));
export const etherscanApiKeys = Object.fromEntries(
	esApiKeyMap.entries().map(([suffix, key]) => {
		const tier = esApiTierMap.get(suffix) ?? Etherscan.APITier.Free;
		return [suffix, [key, tier] as const];
	})
);
export const etherscanApiKey: Etherscan.ApiKey =
	etherscanApiKeys[""] ?? etherscanApiKeys[Object.keys(etherscanApiKeys)[0]]!;

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

export const tenderlyNodeAccessKeys: Tenderly.ApiKeys | undefined
	= tenderlyKeys.length ? Object.freeze(Object.fromEntries(tenderlyKeys)) : undefined;