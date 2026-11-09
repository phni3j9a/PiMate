import { describe, expect, it } from "vitest";
import { parseAppearance, scaleText } from "../src/theme/preferences";

describe("appearance preferences", () => {
	it("validates saved preferences independently and tolerates corrupt data", () => {
		expect(parseAppearance('{"mode":"dark","size":"large"}')).toEqual({ mode: "dark", size: "large" });
		expect(parseAppearance('{"mode":"invalid","size":"small"}')).toEqual({ mode: "system", size: "small" });
		expect(parseAppearance("{")).toEqual({ mode: "system", size: "standard" });
		expect(parseAppearance(null)).toEqual({ mode: "system", size: "standard" });
	});
	it("rounds both font sizes and line heights", () => {
		expect(scaleText(15, "small")).toBe(13);
		expect(scaleText(22, "standard")).toBe(22);
		expect(scaleText(22, "large")).toBe(25);
	});
});
