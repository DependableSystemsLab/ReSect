export function addHexPrefix(hex: string): string {
	return hex.startsWith("0x") ? hex : "0x" + hex;
}

export function removeHexPrefix(hex: string): string {
	return hex.startsWith("0x") ? hex.substring(2) : hex;
}

export function getHexPattern(length?: number | [min?: number, max?: number], prefix: boolean = true): RegExp {
	const prefixPattern = prefix ? "0x" : "";
	const lengthPattern = length == undefined ? "*" : typeof length === "number" ? `{${length}}` : `{${length[0] ?? ""},${length[1] ?? ""}}`;
	return new RegExp(`^${prefixPattern}([A-Fa-f0-9]${lengthPattern})$`);
}

export const hexPattern = getHexPattern();

export type Hex = string | number | bigint;

const hexPatternWithoutPrefix = getHexPattern(undefined, false);
export function hexToString(hex: Hex, byteLength?: number): string {
	if (typeof hex === "string") {
		if (byteLength === undefined) {
			hex = addHexPrefix(hex);
			if (!hexPattern.test(hex))
				throw new TypeError(`Invalid hex value: ${hex}`);
			return hex;
		}
		hex = removeHexPrefix(hex);
		if (!hexPatternWithoutPrefix.test(hex))
			throw new TypeError(`Invalid hex value: ${hex}`);
		const strLength = byteLength << 1;
		if (strLength > hex.length)
			hex = hex.padStart(strLength, "0");
		else if (strLength < hex.length) {
			const prefix = hex.substring(0, hex.length - strLength);
			if (Number.parseInt(prefix, 16) !== 0)
				throw new TypeError(`Hex value longer than ${byteLength} bytes: ${hex}`);
			hex = hex.substring(hex.length - strLength);
		}
		return addHexPrefix(hex);
	}
	if (typeof hex !== "number" && typeof hex !== "bigint")
		throw new TypeError(`Invalid hex value: ${hex}`);
	hex = hex.toString(16);
	if (byteLength !== undefined) {
		const strLength = byteLength << 1;
		if (strLength < hex.length)
			throw new TypeError(`Hex value longer than ${byteLength} bytes: ${hex}`);
		hex = hex.padStart(strLength, "0");
	}
	return `0x${hex}`;
}

export function verifyHexNumber(hexNumber: Hex): string {
	try {
		return hexToString(hexNumber);
	}
	catch {
		throw new Error(`Invalid hex number: ${hexNumber}`);
	}
}

export function verifyAddress(address: Hex): string {
	try {
		return hexToString(address, 20);
	}
	catch {
		throw new Error(`Invalid address: ${address}`);
	}
}

export function verifyTxHash(hash: Hex): string {
	try {
		return hexToString(hash, 32);
	}
	catch {
		throw new Error(`Invalid txhash: ${hash}`);
	}
}