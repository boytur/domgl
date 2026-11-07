import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "src", "web");
const dest = resolve(here, "..", "dist", "web");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("copied web assets ->", dest);
