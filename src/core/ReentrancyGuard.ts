const AsyncGeneratorFunction = Object.getPrototypeOf(async function* () { }).constructor;
const GeneratorFunction = Object.getPrototypeOf(function* () { }).constructor;

export class ReentrancyError extends Error {
	constructor(message?: string) {
		super(message ?? "Wanna play reentrancy inside a reentrancy analyzer? 😈");
	}
}

export function nonReentrant(key?: string | symbol): MethodDecorator {
	return function (_, propertyKey, descriptor) {
		const originalMethod = descriptor.value;
		if (typeof originalMethod !== "function")
			throw new Error(`@nonReentrant can only be applied to methods`);
		const lockKey = key ?? Symbol.for(`__reentrancy_lock_${String(propertyKey)}`);
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
			} as any;
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
			} as any;
		}
		else {
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
			} as any;
		}
		return descriptor;
	};
}

export function resetReentrancyLock<T extends object>(target: T, key: string | symbol | { targetMember: keyof T | symbol; }) {
	const lockKey = typeof key !== "object" ? key : Symbol.for(`__reentrancy_lock_${String(key.targetMember)}`);
	if ((target as any)[lockKey])
		(target as any)[lockKey] = false;
}