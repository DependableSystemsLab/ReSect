import "reflect-metadata";
import { types } from "pg";

types.setTypeParser(types.builtins.INT8, BigInt);

export * from "./entities";
export * from "./Database";