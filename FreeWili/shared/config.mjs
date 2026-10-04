import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configPath = join(dirname(fileURLToPath(import.meta.url)), "config.json");

export const config = Object.freeze(JSON.parse(readFileSync(configPath, "utf8")));
