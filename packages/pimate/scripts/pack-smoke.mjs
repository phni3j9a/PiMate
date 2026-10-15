import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "pimate-pack-"));
const env = {
	...process.env,
	PI_CODING_AGENT_DIR: join(temp, "agent"),
	PIMATE_CONFIG_DIR: join(temp, "config"),
	PIMATE_RUN_DIR: join(temp, "run"),
	PI_OFFLINE: "1",
};
const run = (command, args, cwd = temp) => execFileSync(command, args, { cwd, env, encoding: "utf8", timeout: 180000 });
try {
	const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp], `${root}/dist/package`));
	writeFileSync(join(temp, "package.json"), '{"private":true,"type":"module"}');
	run("npm", [
		"install",
		"--ignore-scripts",
		"--legacy-peer-deps",
		join(temp, packed.filename),
		"@earendil-works/pi-coding-agent@1.2.0",
	]);
	const installed = join(temp, "node_modules/pimate");
	assert.match(run(process.execPath, [join(installed, "dist/cli.js"), "--help"]), /Usage: pimate/);
	const pi = join(temp, "node_modules/.bin/pi");
	// Pi local packages are directories, not tarballs. Extract/install the tarball with npm first.
	run(pi, ["install", installed]);
	assert.match(run(pi, ["list"]), /pimate/);
	cpSync(`${root}/test/fixtures/faux.ts`, join(temp, "faux.ts"));
	writeFileSync(
		join(temp, "verify.ts"),
		`import { writeFileSync } from 'node:fs'; export default function(pi) { pi.on('session_start', () => { if (!pi.getCommands().some(c => c.name === 'pimate')) throw Error('pimate command not loaded'); writeFileSync(${JSON.stringify(join(temp, "loaded"))}, 'yes'); }); }`,
	);
	const output = run(pi, [
		"--no-approve",
		"--no-mcp",
		"--no-skills",
		"--no-context-files",
		"--no-prompt-templates",
		"--no-themes",
		"-e",
		join(temp, "faux.ts"),
		"-e",
		join(temp, "verify.ts"),
		"--model",
		"pimate-faux/scripted",
		"--thinking",
		"off",
		"--no-session",
		"--print",
		"hello",
	]);
	assert.equal(readFileSync(join(temp, "loaded"), "utf8"), "yes");
	assert.match(output, /Hello from the PiMate faux model/);
	run(pi, ["remove", installed]);
	console.log("PASS: clean tarball install, Pi 1.2.0 extension load + faux turn, pimate --help, pi remove");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
