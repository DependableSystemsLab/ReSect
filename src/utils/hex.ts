export namespace Hex {
	export function addPrefix(hex: string): string {
		return hex.startsWith("0x") ? hex : "0x" + hex;
	}

	export function removePrefix(hex: string): string {
		return hex.startsWith("0x") ? hex.substring(2) : hex;
	}

	export function getPattern(length?: number | [min?: number, max?: number], prefix: boolean = true): RegExp {
		const prefixPattern = prefix ? "0x" : "";
		const lengthPattern = length == undefined ? "*" : typeof length === "number" ? `{${length}}` : `{${length[0] ?? ""},${length[1] ?? ""}}`;
		return new RegExp(`^${prefixPattern}([A-Fa-f0-9]${lengthPattern})$`);
	}

	export const pattern = getPattern();

	const hexPatternWithoutPrefix = getPattern(undefined, false);
	export function toString(hex: Hex, byteLength?: number): string {
		if (typeof hex === "string") {
			if (byteLength === undefined) {
				hex = addPrefix(hex);
				if (!pattern.test(hex))
					throw new TypeError(`Invalid hex value: ${hex}`);
				return hex;
			}
			hex = removePrefix(hex);
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
			return addPrefix(hex);
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

	export function toBigInt(hex: Hex): bigint {
		if (typeof hex === "bigint")
			return hex;
		if (typeof hex === "number")
			return BigInt(hex);
		if (typeof hex === "string")
			return BigInt(toString(hex));
		throw new TypeError(`Invalid hex value: ${hex}`);
	}

	export function toNumber(hex: Hex): number {
		if (typeof hex === "number")
			return hex;
		let num: number;
		if (typeof hex === "bigint")
			num = Number(hex);
		else if (typeof hex === "string")
			num = Number(toString(hex));
		else
			throw new TypeError(`Invalid hex value: ${hex}`);
		if (!Number.isSafeInteger(num))
			throw new TypeError(`Hex value too large to convert to number: ${hex}`);
		return num;
	}

	export function verify(hexNumber: Hex): string {
		try {
			return toString(hexNumber);
		}
		catch {
			throw new Error(`Invalid hex number: ${hexNumber}`);
		}
	}

	export function verifyAddress(address: Hex): string {
		try {
			return toString(address, 20);
		}
		catch {
			throw new Error(`Invalid address: ${address}`);
		}
	}

	export function verifyTxHash(hash: Hex): string {
		try {
			return toString(hash, 32);
		}
		catch {
			throw new Error(`Invalid txhash: ${hash}`);
		}
	}
}

export type Hex = string | number | bigint;