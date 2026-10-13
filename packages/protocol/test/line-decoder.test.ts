import { describe, expect, it } from "vitest";
import { encodeLine, LineDecoder } from "../src/index.ts";

describe("LineDecoder", () => {
	it("decodes values split across chunks and skips blank lines", () => {
		const out: unknown[] = [];
		const d = new LineDecoder((v) => out.push(v));
		const s = `${encodeLine({ a: 1 })}\n${encodeLine({ b: "x\ny" })}`;
		d.push(s.slice(0, 3));
		d.push(s.slice(3));
		expect(out).toEqual([{ a: 1 }, { b: "x\ny" }]);
	});

	it("reports malformed lines and keeps going", () => {
		const out: unknown[] = [];
		const bad: string[] = [];
		const d = new LineDecoder(
			(v) => out.push(v),
			(l) => bad.push(l),
		);
		d.push(`{oops\n${encodeLine(2)}`);
		expect(bad).toEqual(["{oops"]);
		expect(out).toEqual([2]);
	});
});
