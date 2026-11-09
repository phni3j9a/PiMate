import { expect, it, vi } from "vitest";
import { checkAppUpdate, newer } from "../src/lib/updates";

const release = (tag: string, extra: object = {}) => ({
	tag_name: tag,
	draft: false,
	prerelease: false,
	html_url: `https://github.com/phni3j9a/PiMate/releases/tag/${tag}`,
	...extra,
});
const fake = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

it("compares x.y.z numerically and rejects other formats", () => {
	expect(newer("0.1.10", "0.1.9")).toBe(true);
	expect(newer("0.2.0", "0.1.13")).toBe(true);
	expect(newer("0.1.13", "0.1.13")).toBe(false);
	expect(newer("0.1.9", "0.1.10")).toBe(false);
	expect(newer("0.1.14-rc.1", "0.1.13")).toBe(false);
	expect(newer("0.1.14", "dev")).toBe(false);
});

it("takes the first published app release, skipping PC, draft and pre-releases", async () => {
	const fetch = fake([
		release("v0.1.19"),
		release("app-v0.1.15", { draft: true }),
		release("app-v0.1.15-rc.1", { prerelease: true }),
		release("app-v0.1.14"),
		release("app-v0.1.13"),
	]);
	expect(await checkAppUpdate("0.1.13", fetch)).toEqual({
		kind: "available",
		version: "0.1.14",
		url: "https://github.com/phni3j9a/PiMate/releases/tag/app-v0.1.14",
	});
	expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/repos/phni3j9a/PiMate/releases"), expect.anything());
	expect(await checkAppUpdate("0.1.14", fetch)).toEqual({ kind: "latest" });
});

it("reports error for HTTP failures, bad payloads, foreign URLs, no app release and timeouts", async () => {
	expect(await checkAppUpdate("0.1.13", fake([], false))).toEqual({ kind: "error" });
	expect(await checkAppUpdate("0.1.13", fake({ message: "rate limited" }))).toEqual({ kind: "error" });
	expect(await checkAppUpdate("0.1.13", fake([release("v0.1.18")]))).toEqual({ kind: "error" });
	expect(
		await checkAppUpdate("0.1.13", fake([release("app-v0.1.14", { html_url: "https://evil.example/x" })])),
	).toEqual({ kind: "error" });
	const hang = vi.fn(
		(_url: string, init: { signal: AbortSignal }) =>
			new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
	);
	expect(await checkAppUpdate("0.1.13", hang, 5)).toEqual({ kind: "error" });
});
