const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () { }).constructor;
const GeneratorFunction = Object.getPrototypeOf(function* () { }).constructor;

export class ReentrancyError extends Error {
	constructor(message?: string) {
		super(message ?? "Wanna play reentrancy inside a reentrancy analyzer? 😈");
	}
}

export function nonReentrant(): MethodDecorator {
	return function (_: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		const lockKey = Symbol(`__reentrancy_lock_${propertyKey}`);
		if (originalMethod instanceof AsyncGeneratorFunction) {
			descriptor.value = async function* (this: any, ...args: any[]) {
				if (this[lockKey])
					throw new ReentrancyError();
				this[lockKey] = true;
				try {
					yield* originalMethod.apply(this, args);
				} finally {
					this[lockKey] = false;
				}
			};
		}
		else if (originalMethod instanceof GeneratorFunction) {
			descriptor.value = function* (this: any, ...args: any[]) {
				if (this[lockKey])
					throw new ReentrancyError();
				this[lockKey] = true;
				try {
					yield* originalMethod.apply(this, args);
				} finally {
					this[lockKey] = false;
				}
			};
		} else {
			descriptor.value = function (this: any, ...args: any[]) {
				if (this[lockKey])
					throw new ReentrancyError();
				this[lockKey] = true;
				try {
					const result = originalMethod.apply(this, args);
					if (result && typeof result.then === "function")
						return result.finally(() => this[lockKey] = false);
					this[lockKey] = false;
					return result;
				}
				catch (error) {
					this[lockKey] = false;
					throw error;
				}
			};
		}
		return descriptor;
	} as any;
}