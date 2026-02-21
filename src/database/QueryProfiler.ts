import type { EntitySubscriberInterface, AfterQueryEvent } from "typeorm";

export class QueryProfiler implements EntitySubscriberInterface {
	#totalTime = 0;
	#queryCount = 0;

	get totalTime() { return this.#totalTime; }
	get queryCount() { return this.#queryCount; }

	afterQuery(event: AfterQueryEvent<any>): void {
		if (event.executionTime !== undefined) {
			this.#totalTime += event.executionTime;
			++this.#queryCount;
		}
	}

	reset() {
		this.#totalTime = 0;
		this.#queryCount = 0;
	}
}
