export class Counter<T = string> {
	readonly #map = new Map<T, number>();

	get(key: T): number {
		return this.#map.get(key) ?? 0;
	}

	increment(key: T): number {
		const count = this.get(key) + 1;
		this.#map.set(key, count);
		return count;
	}

	decrement(key: T): number {
		const count = this.get(key) - 1;
		if (count < 0)
			throw new Error("Counter underflow");
		if (count === 0)
			this.#map.delete(key);
		else
			this.#map.set(key, count);
		return count;
	}

	add(counter: Counter<T>): void {
		for (const [key, value] of counter.#map.entries()) {
			const count = this.get(key) + value;
			this.#map.set(key, count);
		}
	}
	minus(counter: Counter<T>): void {
		for (const [key, value] of counter.#map.entries()) {
			const count = this.get(key) - value;
			if (count < 0)
				throw new Error("Counter underflow");
			if (count === 0)
				this.#map.delete(key);
			else
				this.#map.set(key, count);
		}
	}

	clear() {
		this.#map.clear();
	}

	enumerate() {
		return this.#map.entries();
	}

	clone(): Counter<T> {
		const clone = new Counter<T>();
		for (const [key, value] of this.#map.entries())
			clone.#map.set(key, value);
		return clone;
	}
}