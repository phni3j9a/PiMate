import { defineConfig } from "vitest/config";

// Unit tests for the pure data layer in src/lib (no React Native runtime).
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
