import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const skills = new URL("../grok-bot/skills/", import.meta.url);
const cli = readFileSync(new URL("../src/host/cli.ts", import.meta.url), "utf8");
const usage = cli.match(/"Usage: pimate [^\n]+"/)?.[0] ?? "";
const commands = new Set(Array.from(usage.matchAll(/(?:Usage: pimate | \| )([a-z]+)/g), (match) => match[1]));
const webhookActions = new Set(usage.match(/webhook <([a-z|]+)>/)?.[1].split("|"));

describe("Grok Bot skills", () => {
	it("has matching frontmatter and uses only real CLI subcommands", () => {
		const folders = readdirSync(skills, { withFileTypes: true }).filter((entry) => entry.isDirectory());
		expect(folders.map((entry) => entry.name).sort()).toEqual([
			"pimate-getting-started",
			"pimate-phone-answers",
			"pimate-rules",
			"pimate-send",
		]);
		expect(commands.size).toBeGreaterThan(0);
		expect(webhookActions.size).toBeGreaterThan(0);
		for (const folder of folders) {
			const text = readFileSync(join(skills.pathname, folder.name, "SKILL.md"), "utf8");
			const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
			expect(frontmatter.match(/^name:\s*(\S+)\s*$/m)?.[1]).toBe(folder.name);
			expect(frontmatter.match(/^description:\s*(\S.*)$/m)?.[1].trim()).toBeTruthy();
			for (const match of text.matchAll(/\bpimate ([a-z][a-z-]*)\b/g)) expect(commands.has(match[1])).toBe(true);
			for (const match of text.matchAll(/\bpimate webhook ([a-z]+)/g)) expect(webhookActions.has(match[1])).toBe(true);
		}
	});
});
