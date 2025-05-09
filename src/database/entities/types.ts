import type { SetRequired } from "type-fest";
import type { ObjectLiteral } from "typeorm";

type OnlyObjectProperties<T extends ObjectLiteral> = {
	[K in keyof T as NonNullable<T[K]> extends object ? K : never]: T[K];
};

type OnlyObjectKeys<T extends ObjectLiteral> = keyof OnlyObjectProperties<T>;

export type RelationKeys<E extends ObjectLiteral> = readonly (keyof OnlyObjectProperties<E>)[];

export type FullEntity<E extends ObjectLiteral, R extends OnlyObjectKeys<E>> = SetRequired<E, Exclude<keyof E, R>>;

export type EntityWithRelations<
	E extends ObjectLiteral,
	K extends OnlyObjectKeys<E>,
	T extends E = E
> = SetRequired<T, K>;

export type EntityOnlyRelations<
	E extends ObjectLiteral,
	R extends OnlyObjectKeys<E>,
	K extends OnlyObjectKeys<E>,
	T extends E = E
> = Omit<EntityWithRelations<E, K, T>, Exclude<R, K>>;