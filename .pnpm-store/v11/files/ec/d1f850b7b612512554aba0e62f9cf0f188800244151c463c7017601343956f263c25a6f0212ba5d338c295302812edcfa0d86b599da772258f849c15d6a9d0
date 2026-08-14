import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!fs.existsSync(path.resolve(__dirname, "..", "lib"))) {
    execSync("npm run build");
}
