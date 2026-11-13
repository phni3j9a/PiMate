#!/usr/bin/env node
// 動画を書き出す。src/ のページを時刻ごとに撮影し、ffmpeg で動画にする。音も同じページで合成する。
//
//   確認用（速い）
//     node render.mjs --shot 3.5,12,40      その時刻（秒）の静止画を out/shots に書き出す
//     node render.mjs --sheet 0:30:2        0〜30 秒を 2 秒おきに並べた一覧を out/sheet.png に書き出す（--cols 4 --w 640）
//     node render.mjs --lint                全編を 0.25 秒おきに調べ、文字切れ・重なりなどを報告する
//     node render.mjs --from 14 --to 26     その区間だけ動画にする（音声なし。out/part.mp4）
//     node render.mjs --audio               音だけを out/audio.wav に書き出す（--stems pad,bass,drums,arp,melody,fx,sfx で系統ごと）
//   本番
//     node render.mjs                       全編を等倍で撮影して out/video.mp4 に書き出す（下見用）
//     node render.mjs --scale 2 --keep-frames   2 倍で撮影して縮小する（輪郭と文字の動きが滑らかになる。完成版はこちら）
//     node render.mjs --scale 2 --keep-frames --resume --reuse-audio   途中で止まった撮影を続きから行う
//
//   主なオプション: --fps 60  --size 1920:1080（出力の大きさ）  --workers 4  --crf 16  --out <file>  --no-audio
//   Chrome の指定: 環境変数 CHROME_PATH（実行ファイル）か CHROME_CHANNEL（chrome / msedge）。未指定なら Playwright の Chromium
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
/** 使い方の誤りなど、説明だけ出して止めたいとき。 */
class Stop extends Error {}

const fps = Number(opt("fps", 60));
const scale = Number(opt("scale", 1));
const workers = Number(opt("workers", Math.max(1, Math.min(6, os.cpus().length))));
const outDir = path.join(root, "out");
fs.mkdirSync(outDir, { recursive: true });

for (const tool of ["ffmpeg", "ffprobe"]) {
	if (spawnSync(tool, ["-version"], { stdio: "ignore" }).status !== 0) {
		console.error(`${tool} が見つかりません。ffmpeg を入れてから実行してください（例: brew install ffmpeg / apt install ffmpeg / winget install ffmpeg）`);
		process.exit(1);
	}
}

const types = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
};
const server = http.createServer((req, res) => {
	const rel = decodeURIComponent(req.url.split("?")[0]);
	const file = path.join(root, rel === "/" ? "/src/index.html" : rel);
	if (!file.startsWith(root)) return res.writeHead(403).end();
	fs.readFile(file, (err, data) => {
		if (err) {
			if (rel !== "/favicon.ico") console.error(`[404] ${rel}`);
			return res.writeHead(404).end();
		}
		res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
		res.end(data);
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/src/index.html`;

let browser;
try {
	browser = await chromium.launch({
		executablePath: process.env.CHROME_PATH || undefined,
		channel: process.env.CHROME_CHANNEL || undefined,
		// 文字の形を OS の設定に左右されないようにする
		args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--hide-scrollbars"],
	});
} catch (e) {
	console.error(`ブラウザを起動できません: ${e.message.split("\n")[0]}\n「npx playwright install chromium」を実行するか、CHROME_PATH / CHROME_CHANNEL=chrome を指定してください`);
	process.exit(1);
}

const seen = new Set();
async function openPage() {
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
	const say = (kind, text) => {
		// 同じ警告を、並列に開いたページの数だけ繰り返さない
		if (seen.has(text)) return;
		seen.add(text);
		console.error(`[page ${kind}] ${text}`);
	};
	page.on("pageerror", (e) => say("error", e.message));
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") say(m.type(), m.text());
	});
	page.on("requestfailed", (r) => say("request failed", r.url()));
	await page.goto(base);
	try {
		await page.waitForFunction(() => window.__video?.ready === true, null, { timeout: 120000 });
	} catch {
		console.error("ページの準備が終わりません。上の [page error] を直してください（スクリプトのエラーで止まっていることが多い）");
		process.exit(1);
	}
	return page;
}

async function shoot(page, t, file) {
	await page.evaluate((time) => window.__video.seek(time), t);
	// 書きかけのファイルを残さないよう、別名で書いてから置き換える
	const tmp = file.replace(/\.png$/, ".part.png");
	await page.screenshot({ path: tmp, type: "png" });
	fs.renameSync(tmp, file);
}

function ffmpeg(args) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
	if (r.status !== 0) throw new Error("ffmpeg failed");
}

/** 音を合成して WAV に保存する。stem を渡すと 1 系統だけ。 */
async function renderAudio(page, file, stem) {
	const t0 = Date.now();
	const { size, peak } = await page.evaluate((only) => window.__video.renderAudio(only), stem);
	const parts = [];
	const step = 3 * 1024 * 1024;
	for (let o = 0; o < size; o += step) parts.push(Buffer.from(await page.evaluate(([a, b]) => window.__video.audioChunk(a, b), [o, step]), "base64"));
	fs.writeFileSync(file, Buffer.concat(parts));
	console.log(`audio  ${path.relative(root, file)}  ${((Date.now() - t0) / 1000).toFixed(1)}s  peak ${(20 * Math.log10(peak || 1e-9)).toFixed(1)} dBFS`);
	return file;
}

/** 番組の音量（LUFS）とピークを測る。 */
function loudness(file) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
	const tail = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
	return { lufs: Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]), peak: Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]) };
}

/** 音量を target（LUFS）にそろえ、ピークを抑え、最後を絞った WAV を作る。 */
function master(file, duration, target = -15) {
	const before = loudness(file);
	const out = file.replace(/\.wav$/, "-master.wav");
	let gain = target - before.lufs;
	let after = before;
	// リミッターで少し下がるぶんを、測り直して詰める
	for (let pass = 0; pass < 4; pass++) {
		const chain = `lowshelf=f=140:g=-1.5,highshelf=f=6500:g=3,volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:level=false:attack=2:release=80:asc=1,afade=t=in:d=0.02,afade=t=out:st=${(duration - 0.8).toFixed(2)}:d=0.78,aresample=48000`;
		ffmpeg(["-i", file, "-af", chain, "-c:a", "pcm_s24le", out]);
		after = loudness(out);
		if (Math.abs(target - after.lufs) < 0.15) break;
		gain += target - after.lufs;
	}
	console.log(`master ${before.lufs} LUFS / ${before.peak} dBTP  →  ${after.lufs} LUFS / ${after.peak} dBTP`);
	return out;
}

/** 全編を一定間隔で調べ、続いている不具合だけを報告する。 */
async function lintAll(page, duration) {
	const step = Number(opt("step", 0.25));
	const found = new Map();
	for (let t = 0; t < duration - 1e-6; t += step) {
		for (const item of await page.evaluate((time) => window.__video.lint(time), t)) {
			const e = found.get(item.key) ?? { ...item, times: [] };
			e.times.push(t);
			found.set(item.key, e);
		}
	}
	// 場面の切り替え中に一瞬だけ起きるものは数えない
	const need = { error: 0.5, warn: 1 };
	const list = [...found.values()].filter((e) => e.times.length * step >= need[e.level]).sort((a, b) => a.times[0] - b.times[0]);
	// 起きている時間を、続いた区間ごとにまとめて示す
	const spans = (times) => {
		const out = [];
		for (const t of times) {
			const lastSpan = out[out.length - 1];
			if (lastSpan && t - lastSpan[1] < step * 1.5) lastSpan[1] = t;
			else out.push([t, t]);
		}
		return out.map(([a, b]) => `${a.toFixed(2)}〜${(b + step).toFixed(2)}s`).join(", ");
	};
	for (const e of list) console.log(`${e.level === "error" ? "✗" : "△"} ${spans(e.times)}  [${e.rule}] ${e.message}`);
	const errors = list.filter((e) => e.level === "error").length;
	console.log(list.length ? `\n不具合 ${errors} 件、注意 ${list.length - errors} 件` : "機械的な崩れは見つかりませんでした（見た目は --sheet で確認すること）");
	return errors;
}

async function main() {
	if (flag("audio")) {
		const page = await openPage();
		const duration = await page.evaluate(() => window.__video.duration);
		const stems = opt("stems", "").split(",").filter(Boolean);
		if (!stems.length) master(await renderAudio(page, opt("out", path.join(outDir, "audio.wav"))), duration);
		for (const stem of stems) await renderAudio(page, path.join(outDir, `stem-${stem}.wav`), stem);
		return;
	}

	if (flag("lint")) {
		const page = await openPage();
		const errors = await lintAll(page, await page.evaluate(() => window.__video.duration));
		if (errors) process.exitCode = 1;
		return;
	}

	if (flag("shot")) {
		const dir = path.join(outDir, "shots");
		fs.mkdirSync(dir, { recursive: true });
		const page = await openPage();
		for (const t of opt("shot").split(",").map(Number)) {
			const file = path.join(dir, `${t.toFixed(2).padStart(6, "0")}.png`);
			await shoot(page, t, file);
			console.log(path.relative(root, file));
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
		console.log(`${path.relative(root, file)}  （左上から右へ） ${times.join(" ")}`);
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
	const frames = path.join(outDir, partial ? "frames-part" : "frames");
	// 撮影の条件を控えておく（続きから撮るときの食い違いを防ぐ。tools/extras.mjs もここから fps を読む）
	const metaFile = path.join(outDir, "frames.json");
	// --resume: 途中で止まった撮影を、撮れているフレームを残して続きから行う
	if (flag("resume") && !partial) {
		const old = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
		if (old && (old.fps !== fps || old.scale !== scale)) throw new Stop(`撮影済みのフレームは --fps ${old.fps} --scale ${old.scale} で撮られています。同じ指定で --resume するか、--resume を外して最初から撮り直してください`);
	} else fs.rmSync(frames, { recursive: true, force: true });
	fs.mkdirSync(frames, { recursive: true });
	if (!partial) fs.writeFileSync(metaFile, JSON.stringify({ fps, scale }));
	for (const f of fs.readdirSync(frames)) if (f.endsWith(".part.png")) fs.rmSync(path.join(frames, f));
	const have = new Set(fs.readdirSync(frames));

	let audio = null;
	const mastered = path.join(outDir, "audio-master.wav");
	if (partial || flag("no-audio")) audio = null;
	else if (flag("reuse-audio") && fs.existsSync(mastered)) audio = mastered;
	else audio = master(await renderAudio(probe, path.join(outDir, "audio.wav")), duration);
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
					const name = `${String(f - first).padStart(6, "0")}.png`;
					if (!have.has(name)) await shoot(page, f / fps, path.join(frames, name));
					done++;
				}
				const el = (Date.now() - started) / 1000;
				process.stdout.write(`\rframes ${done}/${total}  ${(done / el).toFixed(1)} fps  eta ${(((total - done) / done) * el).toFixed(0)}s   `);
			}
			await page.close();
		}),
	);
	console.log(`\nframes done in ${((Date.now() - started) / 1000).toFixed(0)}s`);

	const out = opt("out", path.join(outDir, partial ? "part.mp4" : "video.mp4"));
	const args = ["-framerate", String(fps), "-i", path.join(frames, "%06d.png")];
	if (audio) args.push("-i", audio);
	args.push(
		// PNG（sRGB・フルレンジ）を、動画の標準（BT.709・リミテッド）へ正しく変換する。指定しないと色がずれる
		"-vf", `scale=${opt("size", "1920:1080")}:in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`,
		"-c:v", "libx264", "-preset", opt("preset", "slow"), "-crf", opt("crf", "16"), "-tune", "animation",
		"-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
		"-movflags", "+faststart",
	);
	if (audio) args.push("-c:a", "aac", "-b:a", "256k", "-shortest");
	args.push(out);
	await new Promise((resolve, reject) => {
		const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
		p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg failed"))));
	});
	if (!flag("keep-frames") || partial) fs.rmSync(frames, { recursive: true, force: true });
	console.log(`${path.relative(root, out)}  ${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB`);
}

try {
	await main();
} catch (e) {
	console.error(e instanceof Stop ? e.message : e);
	process.exitCode = 1;
} finally {
	await browser.close();
	server.close();
}
