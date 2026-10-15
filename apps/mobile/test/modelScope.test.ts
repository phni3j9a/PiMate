import type { ModelInfo } from "@pimate/protocol";
import { describe, expect, it } from "vitest";

import { defaultScope, scopeModels, toggleFavorite } from "../src/lib/sessionInfo";

const model = (provider: string, id: string): ModelInfo => ({ provider, id, name: id, thinkingLevels: ["off"] });
const list = [model("a", "1"), model("a", "2"), model("b", "1")];

describe("model favorites (Pi's scoped models)", () => {
	it("opens on favorites only when there are any", () => {
		expect(defaultScope(undefined)).toBe("all");
		expect(defaultScope([])).toBe("all");
		expect(defaultScope([{ provider: "b", id: "1" }])).toBe("favorites");
	});

	it("filters by provider and id, keeping the list order", () => {
		const scoped = [
			{ provider: "b", id: "1" },
			{ provider: "a", id: "1" },
		];
		expect(scopeModels(list, scoped, "favorites").map((m) => `${m.provider}/${m.id}`)).toEqual(["a/1", "b/1"]);
		expect(scopeModels(list, scoped, "all")).toBe(list);
	});

	it("appends a starred model and removes an unstarred one", () => {
		expect(toggleFavorite(undefined, list[1])).toEqual([{ provider: "a", id: "2" }]);
		const scoped = [
			{ provider: "a", id: "1" },
			{ provider: "b", id: "1" },
		];
		expect(toggleFavorite(scoped, list[2])).toEqual([{ provider: "a", id: "1" }]);
		expect(toggleFavorite(scoped, list[1])).toEqual([...scoped, { provider: "a", id: "2" }]);
	});
});
