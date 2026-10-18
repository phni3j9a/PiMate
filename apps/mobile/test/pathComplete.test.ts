import { expect, it } from "vitest";
import { matchDirs, splitPath } from "../src/lib/pathComplete";

it("splits a typed path into the folder to list and the typed name", () => {
	expect(splitPath("~/code/pr")).toEqual({ parent: "~/code/", prefix: "pr" });
	expect(splitPath("~/")).toEqual({ parent: "~/", prefix: "" });
	expect(splitPath("/")).toEqual({ parent: "/", prefix: "" });
	expect(splitPath("~")).toBeNull();
	expect(splitPath("code/x")).toBeNull();
	expect(splitPath("")).toBeNull();
});

it("matches names case-insensitively and hides dot folders until a dot is typed", () => {
	const names = [".config", "Code", "code-old", "docs"];
	expect(matchDirs(names, "")).toEqual(["Code", "code-old", "docs"]);
	expect(matchDirs(names, "co")).toEqual(["Code", "code-old"]);
	expect(matchDirs(names, ".")).toEqual([".config"]);
	expect(matchDirs(names, "", 1)).toEqual(["Code"]);
});
