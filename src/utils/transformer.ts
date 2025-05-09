import { TransformationType, type TransformFnParams } from "class-transformer";


export namespace Transformer {
	type Fn = (params: TransformFnParams) => any;

	export class Pipe<TSrc, TDst> {
		readonly fn: Fn;

		constructor(
			readonly serialize: (value: TSrc, params: Omit<TransformFnParams, "type">) => TDst,
			readonly deserialize: (value: TDst, params: Omit<TransformFnParams, "type">) => TSrc
		) {
			this.fn = ({ type, ...params }: TransformFnParams) => {
				const value = params.obj[params.key];
				switch (type) {
					case TransformationType.PLAIN_TO_CLASS:
						return this.deserialize(value, params);
					case TransformationType.CLASS_TO_PLAIN:
						return this.serialize(value, params);
					case TransformationType.CLASS_TO_CLASS:
						return value;
				}
			};
		}

		get nullable(): Pipe<TSrc | null, TDst | null> {
			return new Pipe<TSrc | null, TDst | null>(
				(value, params) => value == null ? null : this.serialize(value, params),
				(value, params) => value == null ? null : this.deserialize(value, params)
			);
		}

		reverse(): Pipe<TDst, TSrc> {
			return new Pipe<TDst, TSrc>(
				(value, params) => this.deserialize(value, params),
				(value, params) => this.serialize(value, params)
			);
		}

		concat<TNewDst>(pipe: Pipe<TDst, TNewDst>): Pipe<TSrc, TNewDst> {
			return new Pipe<TSrc, TNewDst>(
				(value, params) => pipe.serialize(this.serialize(value, params), params),
				(value, params) => this.deserialize(pipe.deserialize(value, params), params)
			);
		}
	}

	export const bigint = new Pipe<BigInt, string>(
		value => value.toString(),
		value => BigInt(value)
	);

	export const date = new Pipe<Date, string>(
		value => value.toISOString(),
		value => new Date(value)
	);
}