import type { CommandInfo } from "@pimate/protocol";
import { describe, expect, it } from "vitest";
import {
	BUILTIN_COMMANDS,
	commandCatalog,
	commandIntent,
	commandKind,
	commandQuery,
	filterCommands,
	insertCommand,
} from "../src/lib/commands";

const commands: CommandInfo[] = [
	{ name: "review", description: "Review code", source: "extension" },
	{ name: "review:1", source: "extension" },
	{ name: "release-notes", source: "prompt" },
	{ name: "skill:design.ui", source: "skill" },
];

describe("slash commands", () => {
	it("shows completions only before whitespace, filters by prefix and inserts a trailing space", () => {
		expect(commandQuery("/")).toBe("");
		expect(filterCommands(commands, "/")).toEqual(commands);
		expect(filterCommands(commands, "/rev").map((c) => c.name)).toEqual(["review", "review:1"]);
		expect(filterCommands(commands, "/skill:d").map((c) => c.name)).toEqual(["skill:design.ui"]);
		expect(filterCommands(commands, "/xyz")).toEqual([]);
		for (const text of ["hi /", " /rev", "/review ", "/review\tx", "/review\nx"]) expect(commandQuery(text)).toBeNull();
		expect(insertCommand("review:1")).toBe("/review:1 ");
		expect(commandQuery(insertCommand("review"))).toBeNull();
	});
	it("includes only existing app operations and gives them precedence", () => {
		expect(BUILTIN_COMMANDS.map((c) => c.name)).toEqual(["model", "new", "resume", "fork", "compact"]);
		const catalog = commandCatalog([
			...commands,
			{ name: "model", source: "extension" },
			{ name: "review", source: "prompt" },
		]);
		expect(catalog.filter((c) => c.name === "review")).toEqual([commands[0]]);
		expect(catalog.filter((c) => c.name === "model")).toEqual([BUILTIN_COMMANDS[0]]);
		for (const c of BUILTIN_COMMANDS) {
			expect(commandIntent(insertCommand(c.name), commands)).toEqual({ kind: "builtin", name: c.name, hasArgs: false });
			expect(commandIntent(`/${c.name} ignored`, commands)).toEqual({ kind: "builtin", name: c.name, hasArgs: true });
		}
	});
	it("recognizes exact names, aliases and arguments, never mistakes paths for commands", () => {
		for (const c of commands)
			for (const suffix of ["", " arg", "\targ", "\narg"])
				expect(commandIntent(`/${c.name}${suffix}`, commands)).toEqual({ kind: "remote", command: c });
		for (const name of ["unknown", "rev", "review:2", "tree", "reload"])
			expect(commandIntent(`/${name} arg`, commands)).toEqual({ kind: "unknown", name });
		for (const text of ["hello", "/home/x", "/home/x arg", "/", " /review", "see /review", "/review?", "/日本語"])
			expect(commandIntent(text, commands)).toEqual({ kind: "text" });
	});
	it("labels all command sources", () => {
		expect(["builtin", "extension", "prompt", "skill"].map(commandKind)).toEqual([
			"アプリ操作",
			"Extension",
			"テンプレート",
			"Skill",
		]);
	});
});
