import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../app.config.js", import.meta.url), "utf8");
function config(version: string) {
	const module = { exports: {} as { version: string; android: { package: string; versionCode: number } } };
	runInNewContext(source, {
		module,
		require: () => ({ expo: { version, android: { package: "dev.pimate.app" } } }),
	});
	return module.exports;
}

describe("Android release version", () => {
	it("preserves the version name and package and derives a stable version code", () => {
		expect(config("0.1.0")).toEqual({
			version: "0.1.0",
			android: { package: "dev.pimate.app", versionCode: 1000 },
		});
	});

	it("increases across patch, minor and major releases", () => {
		const versions = ["0.1.0", "0.1.1", "0.1.999", "0.2.0", "0.999.999", "1.0.0"];
		const codes = versions.map((version) => config(version).android.versionCode);
		expect(codes).toEqual([1000, 1001, 1999, 2000, 999999, 1000000]);
	});

	it.each(["0.0.0", "1.0", "1.0.0-rc.1", "1.1000.0", "1000.0.0", "v1.0.0", "1.2.x", "01.0.0"])(
		"rejects invalid or ambiguous release version %s",
		(version) => expect(() => config(version)).toThrow(),
	);
});
