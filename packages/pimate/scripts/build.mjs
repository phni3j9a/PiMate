import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}/dist/package`;
const source = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/dist`, { recursive: true });
const result = await build({
	metafile: true,
	absWorkingDir: root,
	entryPoints: { extension: "src/extension/index.ts", cli: "src/host/cli.ts" },
	outdir: `${out}/dist`,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	external: ["@earendil-works/*", "typebox", "bufferutil", "utf-8-validate"],
	banner: {
		js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
	},
});
chmodSync(`${out}/dist/cli.js`, 0o755);
const sums = {};
for (const arch of ["x64", "arm64"]) {
	const relative = `bin/linux-${arch}/abduco`;
	if (!existsSync(`${root}/${relative}`)) {
		if (process.argv.includes("--release")) throw new Error(`Missing release binary: ${relative}`);
		console.warn(`Development package only: missing ${relative}`);
		continue;
	}
	mkdirSync(`${out}/bin/linux-${arch}`, { recursive: true });
	cpSync(`${root}/${relative}`, `${out}/${relative}`);
	sums[relative] = createHash("sha256")
		.update(readFileSync(`${out}/${relative}`))
		.digest("hex");
}
mkdirSync(`${out}/bin`, { recursive: true });
writeFileSync(`${out}/bin/SHA256SUMS.json`, `${JSON.stringify(sums, null, 2)}\n`);
// Also protect source-layout development/e2e use of the binaries just built.
writeFileSync(`${root}/bin/SHA256SUMS.json`, `${JSON.stringify(sums, null, 2)}\n`);
writeFileSync(
	`${out}/package.json`,
	`${JSON.stringify(
		{
			name: "pimate",
			version: source.version,
			license: source.license,
			description: "Pi on your phone, through your PC and Tailscale",
			type: "module",
			keywords: ["pi-package"],
			engines: { node: ">=22" },
			pi: { extensions: ["./dist/extension.js"] },
			bin: { pimate: "./dist/cli.js" },
			peerDependencies: source.peerDependencies,
			files: ["dist", "bin", "README.md", "LICENSE", "THIRD_PARTY_NOTICES"],
			repository: { type: "git", url: "git+https://github.com/phni3j9a/PiMate.git" },
		},
		null,
		2,
	)}\n`,
);
cpSync(`${root}/../../LICENSE`, `${out}/LICENSE`);
cpSync(`${root}/PACKAGE_README.md`, `${out}/README.md`);
let notices = readFileSync(`${root}/THIRD_PARTY_NOTICES`, "utf8");
const included = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
	if (!input.includes("node_modules/")) continue;
	let dir = dirname(resolve(root, input));
	while (
		(!existsSync(`${dir}/package.json`) || !JSON.parse(readFileSync(`${dir}/package.json`, "utf8")).name) &&
		dirname(dir) !== dir
	)
		dir = dirname(dir);
	if (included.has(dir)) continue;
	included.add(dir);
	const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
	const license = readdirSync(dir).find((name) => /^licen[sc]e(?:\.|$)/i.test(name));
	if (!license) throw new Error(`Missing license for bundled dependency ${pkg.name}`);
	notices += `\n\n${pkg.name}@${pkg.version} (${pkg.license})\n${readFileSync(`${dir}/${license}`, "utf8")}`;
}
writeFileSync(`${out}/THIRD_PARTY_NOTICES`, notices);
console.log(`Built ${out}`);
