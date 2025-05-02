import { Etherscan } from "../providers/Etherscan.js";
import type { ChainName } from "./Chain.js";

export const etherscanApiKey = [
	"REDACTED",
	Etherscan.APITier.Free
] as const;

export const infuraApiKey = "REDACTED";

export const tenderlyNodeAccessKeys = Object.freeze({
	Ethereum: "REDACTED",
	ArbitrumOne: "REDACTED"
}) satisfies Readonly<Partial<Record<ChainName, string>>>;