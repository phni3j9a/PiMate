#!/usr/bin/env node
// 紹介動画を書き出す。src/ のページを時刻ごとに撮影し、ffmpeg で動画にする。
//
//   node render.mjs                     全編を書き出す（out/pimate-intro.mp4）
//   node render.mjs --shot 3.5,12,40    指定した時刻（秒）の静止画を out/shots に書き出す
//   node render.mjs --sheet 0:30:2      0〜30 秒を 2 秒おきに並べた一覧を out/sheet.png に書き出す
//   node render.mjs --from 14 --to 26   一部だけ書き出す（音声なし）
//
// 主なオプション: --fps 60  --scale 1（2 で 4K）  --workers 4  --crf 16  --out <file>  --no-audio
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf(`--${name}`);
	return i < 0 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const fps = Number(opt("fps", 60));
const scale = Number(opt("scale", 1));
const workers = Number(opt("workers", Math.max(1, Math.min(6, os.cpus().length))));
const crf = opt("crf", "16");
const outDir = path.join(root, "out");
fs.mkdirSync(outDir, { recursive: true });

const types = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".svg": "image/svg+xml",
	".png": "image/png",
};
const server = http.createServer((req, res) => {
	const rel = decodeURIComponent(req.url.split("?")[0]);
	const file = path.join(root, rel === "/" ? "/src/index.html" : rel);
	if (!file.startsWith(root)) return res.writeHead(403).end();
	fs.readFile(file, (err, data) => {
		if (err) return res.writeHead(404).end();
		res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
		res.end(data);
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/src/index.html`;

const browser = await chromium.launch({
	args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars"],
});

async function openPage(query = "") {
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
	page.on("pageerror", (e) => console.error("[page error]", e.message));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") console.error(`[page ${m.type()}]`, m.text());
		else if (flag("verbose")) console.log("[page]", m.text());
	});
	page.on("requestfailed", (r) => console.error("[request failed]", r.url()));
	await page.goto(base + query);
	await page.waitForFunction(() => window.__video?.ready === true, null, { timeout: 120000 });
	return page;
}

const shoot = (page, t, file) =>
	page.evaluate((time) => window.__video.seek(time), t).then(() => page.screenshot({ path: file, type: "png" }));

function ffmpeg(args, { quiet = true } = {}) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", quiet ? "error" : "info", "-y", ...args], { stdio: "inherit" });
	if (r.status !== 0) throw new Error("ffmpeg failed");
}

async function main() {
	if (flag("shot")) {
		const dir = path.join(outDir, "shots");
		fs.mkdirSync(dir, { recursive: true });
		const page = await openPage(opt("query", ""));
		for (const t of opt("shot").split(",").map(Number)) {
			const file = path.join(dir, `${t.toFixed(2).padStart(6, "0")}.png`);
			await shoot(page, t, file);
			console.log(file);
		}
		return;
	}

	if (flag("sheet")) {
		const [a, b, step] = opt("sheet").split(":").map(Number);
		const dir = fs.mkdtempSync(path.join(outDir, "sheet-"));
		const page = await openPage();
		const times = [];
		for (let t = a; t <= b + 1e-6; t += step) times.push(Number(t.toFixed(3)));
		for (const [i, t] of times.entries()) await shoot(page, t, path.join(dir, `${String(i).padStart(4, "0")}.png`));
		const cols = Number(opt("cols", 4));
		const rows = Math.ceil(times.length / cols);
		const file = opt("out", path.join(outDir, "sheet.png"));
		ffmpeg(["-framerate", "1", "-i", path.join(dir, "%04d.png"), "-vf", `scale=${opt("w", 640)}:-1,tile=${cols}x${rows}:padding=6:color=0x202020`, "-frames:v", "1", file]);
		fs.rmSync(dir, { recursive: true });
		console.log(file, times.join(" "));
		return;
	}

	const probe = await openPage();
	const duration = await probe.evaluate(() => window.__video.duration);
	const from = Number(opt("from", 0));
	const to = Number(opt("to", duration));
	const first = Math.round(from * fps);
	const last = Math.round(to * fps);
	const total = last - first;
	const partial = from > 0 || to < duration;
	const frames = path.join(outDir, "frames");
	fs.rmSync(frames, { recursive: true, force: true });
	fs.mkdirSync(frames, { recursive: true });

	let audio = null;
	if (!flag("no-audio") && !partial) {
		const t0 = Date.now();
		const b64 = await probe.evaluate(() => window.__video.renderAudio());
		audio = path.join(outDir, "audio.wav");
		fs.writeFileSync(audio, Buffer.from(b64, "base64"));
		console.log(`audio  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	}
	await probe.close();

	const started = Date.now();
	let done = 0;
	let next = first;
	const chunk = 24;
	await Promise.all(
		Array.from({ length: workers }, async () => {
			const page = await openPage();
			while (next < last) {
				const a = next;
				const b = Math.min(last, a + chunk);
				next = b;
				for (let f = a; f < b; f++) {
					await shoot(page, f / fps, path.join(frames, `${String(f - first).padStart(6, "0")}.png`));
					done++;
				}
				const el = (Date.now() - started) / 1000;
				process.stdout.write(`\rframes ${done}/${total}  ${(done / el).toFixed(1)} fps  eta ${(((total - done) / done) * el).toFixed(0)}s   `);
			}
			await page.close();
		}),
	);
	console.log(`\nframes done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

	const out = opt("out", path.join(outDir, partial ? "part.mp4" : "pimate-intro.mp4"));
	const args = ["-framerate", String(fps), "-i", path.join(frames, "%06d.png")];
	if (audio) args.push("-i", audio);
	args.push(
		"-vf", "scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p",
		"-c:v", "libx264", "-preset", opt("preset", "slow"), "-crf", crf, "-tune", "animation",
		"-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
		"-movflags", "+faststart",
	);
	if (audio) args.push("-c:a", "aac", "-b:a", "256k", "-shortest");
	args.push(out);
	await new Promise((resolve, reject) => {
		const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-stats", "-y", ...args], { stdio: "inherit" });
		p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg failed"))));
	});
	if (!flag("keep-frames")) fs.rmSync(frames, { recursive: true, force: true });
	console.log(out);
}

try {
	await main();
} finally {
	await browser.close();
	server.close();
}
