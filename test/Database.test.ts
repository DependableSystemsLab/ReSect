import "basic-type-extensions";
import { DataSource } from "typeorm";
import inspector from "node:inspector";
import { typeormConfig } from "../src/config/typeorm";


describe("Database", () => {
	const debug = inspector.url() !== undefined;
	const timeout = debug ? 24 * 60 * 60_000 : 30_000;
	jest.setTimeout(timeout);

	test("Schema", async () => {
		const source = new DataSource({
			...typeormConfig,
			schema: "test",
			synchronize: false,
			logging: true
		});
		await source.initialize();
		await source.synchronize(true);
	});
});