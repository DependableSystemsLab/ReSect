import { Etherscan, Tenderly } from "../providers";
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

export type EtherscanApiKey = [key: string, tier?: Etherscan.APITier];
export const etherscanApiKey = Object.freeze([etherscanApiKey_, apiTier] as EtherscanApiKey);

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
	})

export type TenderlyApiKeys = Readonly<Partial<Record<Tenderly.Chain, string>>>;
export const tenderlyNodeAccessKeys: TenderlyApiKeys = Object.freeze(Object.fromEntries(tenderlyKeys));