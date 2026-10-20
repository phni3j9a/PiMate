import { defineConfig } from "vitest/config";

// Node tests; component tests mock native views rather than loading a React Native runtime.
export default defineConfig({
	resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
	test: { include: ["test/**/*.test.ts"], environment: "node" },
});
