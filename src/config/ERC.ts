import type { abi } from "@shazow/whatsabi";
import { keccak256 } from "js-sha3";
import { extractSelector, Hex, type MinimalTrace } from "../utils";
import type { SetRequired } from "type-fest";


type FuncInput<T extends string> = Omit<abi.ABIFunction, "name" | "type" | "selector" | "inputs"> & {
	name: T;
	inputs: SetRequired<Partial<abi.ABIInput>, "type">[];
};

type FuncOutput<T extends string> = Omit<abi.ABIFunction, "name" | "selector" | "inputs"> & {
	name: T;
	selector: Hex.Selector;
	inputs: SetRequired<Partial<abi.ABIInput>, "type">[];
};

export type NamedABI<T extends string> = Readonly<Record<T, FuncOutput<T>>>;

function constructAbi<T extends string = string>(
	funcs: readonly FuncInput<T>[]
): NamedABI<T> {
	const functions = funcs.map(f => {
		const signature = `${f.name}(${f.inputs.map(i => i.type).join(",")})`;
		return {
			...f,
			type: "function",
			selector: "0x" + keccak256(signature).slice(0, 8)
		};
	}) as FuncOutput<T>[];
	const abi = Object.fromEntries(functions.map(f => [f.name, f])) as NamedABI<T>;
	return Object.freeze(abi);
}

export function checkAbi<T extends string = string>(
	abi: abi.ABI,
	target: NamedABI<T>,
	funcNames?: T[]
): boolean {
	const funcs = abi.filter(i => i.type === "function");
	if (funcs.length < Object.keys(target).length)
		return false;
	const selectors = new Set(funcs.map(f => f.selector));
	funcNames ??= Object.keys(target) as T[];
	for (const name of funcNames) {
		const f = target[name];
		if (!selectors.has(f.selector))
			return false;
	}
	return true;
}

export function checkTrace<T extends string = string>(
	trace: MinimalTrace,
	target: NamedABI<T>
): boolean {
	const selector = extractSelector(trace);
	if (selector == null)
		return false; // Fallback or not a call type
	for (const name in target) {
		if (target[name].selector === selector)
			return true;
	}
	return false;
}

export namespace ERC20 {
	export const abis = constructAbi([
		{
			name: "totalSupply",
			stateMutability: "view",
			inputs: [
				{ type: "address", name: "owner" }
			],
			outputs: [
				{ type: "uint256", name: "totalSupply" }
			]
		},
		{
			name: "balanceOf",
			stateMutability: "view",
			inputs: [
				{ type: "address", name: "owner" }
			],
			outputs: [
				{ type: "uint256", name: "balance" }
			]
		},
		{
			name: "allowance",
			stateMutability: "view",
			inputs: [
				{ type: "address", name: "owner" },
				{ type: "address", name: "spender" }
			],
			outputs: [
				{ type: "uint256", name: "remaining" }
			]
		},
		{
			name: "approve",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "spender" },
				{ type: "uint256", name: "amount" }
			],
			outputs: [
				{ type: "bool", name: "success" }
			]
		},
		{
			name: "transfer",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "recipient" },
				{ type: "uint256", name: "amount" }
			],
			outputs: [
				{ type: "bool", name: "success" }
			]
		},
		{
			name: "transferFrom",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "sender" },
				{ type: "address", name: "recipient" },
				{ type: "uint256", name: "amount" }
			],
			outputs: [
				{ type: "bool", name: "success" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC223.Recipient {
	export const abis = constructAbi([
		{
			name: "tokenReceived",
			inputs: [
				{ type: "address", name: "_from" },
				{ type: "uint256", name: "_value" },
				{ type: "bytes", name: "_data" }
			],
			outputs: [
				{ type: "bytes4", name: "selector" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC677.Recipient {
	export const abis = constructAbi([
		{
			name: "onTokenTransfer",
			inputs: [
				{ type: "address", name: "from" },
				{ type: "uint256", name: "amount" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bool", name: "success" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC721.Recipient {
	export const abis = constructAbi([
		{
			name: "onERC721Received",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "uint256", name: "tokenId" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bytes4", name: "magicValue" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC777.Recipient {
	export const abis = constructAbi([
		{
			name: "tokensReceived",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "address", name: "to" },
				{ type: "uint256", name: "amount" },
				{ type: "bytes", name: "userData" },
				{ type: "bytes", name: "operatorData" }
			],
			outputs: []
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC777.Sender {
	export const abis = constructAbi([
		{
			name: "tokensToSend",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "address", name: "to" },
				{ type: "uint256", name: "amount" },
				{ type: "bytes", name: "userData" },
				{ type: "bytes", name: "operatorData" }
			],
			outputs: []
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC1155.Recipient {
	export const abis = constructAbi([
		{
			name: "onERC1155Received",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "uint256", name: "id" },
				{ type: "uint256", name: "value" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bytes4", name: "magicValue" }
			]
		},
		{
			name: "onERC1155BatchReceived",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "uint256[]", name: "ids" },
				{ type: "uint256[]", name: "values" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bytes4", name: "magicValue" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC1363.Recipient {
	export const abis = constructAbi([
		{
			name: "onTransferReceived",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "operator" },
				{ type: "address", name: "from" },
				{ type: "uint256", name: "value" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bytes4", name: "magicValue" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}

export namespace ERC1363.Spender {
	export const abis = constructAbi([
		{
			name: "onApprovalReceived",
			stateMutability: "nonpayable",
			inputs: [
				{ type: "address", name: "owner" },
				{ type: "uint256", name: "value" },
				{ type: "bytes", name: "data" }
			],
			outputs: [
				{ type: "bytes4", name: "magicValue" }
			]
		}
	]);

	export type FuncName = keyof typeof abis;
}