import {fileURLToPath} from "node:url";
import path from "node:path";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
