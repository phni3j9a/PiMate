import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This module is src/package.ts in development and inlined into dist/*.js for distribution.
export const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_VERSION: string = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
export const cliPath = join(
	packageDir,
	existsSync(join(packageDir, "dist/cli.js")) ? "dist/cli.js" : "src/host/cli.ts",
);
export const extensionPath = join(
	packageDir,
	existsSync(join(packageDir, "dist/extension.js")) ? "dist/extension.js" : "src/extension/index.ts",
);
