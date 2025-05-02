import type { Arrayable, Primitive } from "type-fest";

export type QueryObject = Record<string, Arrayable<Exclude<Primitive, symbol>>>;

export function toURLSearchParams(query: QueryObject): URLSearchParams {
	const params = new URLSearchParams();
	for (const key in query) {
		const value = query[key];
		if (value == undefined)
			continue;
		if (typeof value !== "object" || value === null)
			params.append(key, value.toString());
		else if (!Array.isArray(value))
			throw new TypeError(`Invalid value for ${key}: ${value}`);
		else if (value.length > 0) {
			if (value.some(v => v === undefined || typeof v === "object" && v !== null))
				throw new TypeError(`Invalid value for ${key}: ${value}`);
			params.append(key, value.map(v => String(v)).join(","));
		}
	}
	return params;
}