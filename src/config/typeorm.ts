import type { DataSourceOptions } from "typeorm";
import { entities } from "../database/entities";

const {
	DB_HOST: host = "localhost",
	DB_PORT: port = "5432",
	DB_USER: username = "postgres",
	DB_PASSWORD: password,
	DB_DATABASE: database = "reentrancy-attack",
	DB_SCHEMA: schema = "public",
	DB_SYNC: synchronize = "false",
	DB_LOG: logging = "false"
} = process.env;

function parseBool(value: string | undefined): boolean {
	if (value === undefined || value === "")
		return false;
	value = value.toLowerCase();
	if (value === "true" || value === "1" || value === "yes")
		return true;
	if (value === "false" || value === "0" || value === "no")
		return false;
	throw new Error(`Invalid boolean value: ${value}`);
}

export const typeormConfig: DataSourceOptions = {
	type: "postgres",
	host,
	port: parseInt(port),
	username,
	password,
	database,
	schema,
	synchronize: parseBool(synchronize),
	logging: parseBool(logging),
	entities: [...entities]
};