import { expect, it } from "vitest";
import { slashCommandName } from "../src/index.ts";

it("recognizes only a complete leading slash command token, not a filesystem path", () => {
	for (const name of ["model", "name_2", "skill:foo.bar", "review:1", "release-notes"])
		for (const suffix of ["", " arg", "\targ", "\narg"]) expect(slashCommandName(`/${name}${suffix}`)).toBe(name);
	for (const text of ["/home/x", "/home/x arg", " /model", "hi /model", "/", "/x?", "/日本語", ""])
		expect(slashCommandName(text)).toBeNull();
});
