import type { ChainName } from "./Chain.js";

export const etherscanApiKey = "REDACTED";

export const infuraApiKey = "REDACTED";

export const tenderlyNodeAccessKeys = Object.freeze({
	Ethereum: "REDACTED",
	ArbitrumOne: "REDACTED"
}) satisfies Readonly<Partial<Record<ChainName, string>>>;