import type { Tagged } from "type-fest";

export namespace Hex {
	export type String = `0x${string}`;
	export type Number = number | bigint;

	export type Empty = "0x";
	export type AddressNP = Tagged<string, "address" | 40>;
	export type Address = `0x${AddressNP}`;
	export type TxHashNP = Tagged<string, "txhash" | 64>;
	export type TxHash = `0x${TxHashNP}`;
	export type BlockHashNP = Tagged<string, "blockhash" | 64>;
	export type BlockHash = `0x${BlockHashNP}`;
	export type Topic = Tagged<String, "topic" | 64>;
	export type Selector = Tagged<String, "selector" | 8>;

	type AddPrefix<T extends string> = T extends String ? T : `0x${T}`;
	export function addPrefix<T extends string = string>(hex: T): AddPrefix<T> {
		return (hex.startsWith("0x") ? hex : `0x${hex}`) as AddPrefix<T>;
	}

	type RemovePrefix<T extends string> = T extends `0x${infer U}` ? U : T;
	export function removePrefix<T extends string = string>(hex: T): RemovePrefix<T> {
		return (hex.startsWith("0x") ? hex.slice(2) : hex) as RemovePrefix<T>;
	}

	export function getPattern(length?: number | [min?: number, max?: number], prefix: boolean = true): RegExp {
		const prefixPattern = prefix ? "0x" : "";
		const lengthPattern = length == undefined ? "*" : typeof length === "number" ? `{${length}}` : `{${length[0] ?? ""},${length[1] ?? ""}}`;
		return new RegExp(`^${prefixPattern}([A-Fa-f0-9]${lengthPattern})$`);
	}

	export const pattern = getPattern();

	const hexPatternWithoutPrefix = getPattern(undefined, false);
	export function toString(hex: Hex | string, byteLength?: number): String {
		if (typeof hex === "string") {
			if (byteLength === undefined) {
				hex = addPrefix(hex);
				if (!pattern.test(hex))
					throw new TypeError(`Invalid hex value: ${hex}`);
				return hex as String;
			}
			let noPrefix = removePrefix(hex);
			if (!hexPatternWithoutPrefix.test(noPrefix))
				throw new TypeError(`Invalid hex value: ${hex}`);
			const strLength = byteLength << 1;
			if (strLength > noPrefix.length)
				noPrefix = noPrefix.padStart(strLength, "0");
			else if (strLength < noPrefix.length) {
				const prefix = noPrefix.slice(0, -strLength);
				if (Number.parseInt(prefix, 16) !== 0)
					throw new TypeError(`Hex value longer than ${byteLength} bytes: ${hex}`);
				noPrefix = noPrefix.slice(-strLength);
			}
			return addPrefix(noPrefix);
		}
		if (typeof hex === "number" || typeof hex === "bigint") {
			let str = hex.toString(16);
			if (byteLength !== undefined) {
				const strLength = byteLength << 1;
				if (strLength < str.length)
					throw new TypeError(`Hex value longer than ${byteLength} bytes: ${hex}`);
				str = str.padStart(strLength, "0");
			}
			return `0x${str}`;
		}
		if (Buffer.isBuffer(hex)) {
			if (byteLength === undefined || byteLength === hex.length)
				return `0x${hex.toString("hex")}`;
			if (byteLength < hex.length)
				throw new TypeError(`Hex value longer than ${byteLength} bytes: ${hex}`);
			return `0x${"00".repeat(byteLength - hex.length)}${hex.toString("hex")}`;
		}
		throw new TypeError(`Invalid hex value: ${hex}`);
	}

	export function toBigInt(hex: Hex | string): bigint {
		switch (typeof hex) {
			case "bigint": return hex;
			case "number": return BigInt(hex);
			case "string": return BigInt(toString(hex));
			default:
				if (Buffer.isBuffer(hex))
					return BigInt(`0x${hex.toString("hex")}`);
				throw new TypeError(`Invalid hex value: ${hex}`);
		}
	}

	export function toNumber(hex: Hex | string): number {
		if (typeof hex === "number")
			return hex;
		let num: number = 0;
		if (typeof hex === "bigint")
			num = Number(hex);
		else if (typeof hex === "string")
			num = Number(toString(hex));
		else if (Buffer.isBuffer(hex)) {
			for (const byte of hex)
				num = (num << 8) | byte;
		}
		else
			throw new TypeError(`Invalid hex value: ${hex}`);
		if (!Number.isSafeInteger(num))
			throw new TypeError(`Hex value too large to convert to number: ${hex}`);
		return num;
	}

	export function verify(hex: string): String {
		if (!pattern.test(hex))
			throw new TypeError(`Invalid hex value: ${hex}`);
		return hex as String;
	}

	const addressPattern = getPattern(40);
	export function verifyAddress(address: String): Address {
		if (!addressPattern.test(address))
			throw new Error(`Invalid address: ${address}`);
		return address as Address;
	}

	const hashPattern = getPattern(64);
	export function verifyTxHash(hash: String): TxHash {
		if (!hashPattern.test(hash))
			throw new Error(`Invalid txhash: ${hash}`);
		return hash as TxHash;
	}

	const selectorPattern = getPattern(8);
	export function verifySelector(selector: String): Selector {
		if (!selectorPattern.test(selector))
			throw new Error(`Invalid selector: ${selector}`);
		return selector as Selector;
	}
}

export type Hex = Hex.Number | Hex.String | Buffer;

export type NumStr = `${number}`;