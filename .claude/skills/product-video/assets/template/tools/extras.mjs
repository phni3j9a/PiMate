#!/usr/bin/env node
// 撮影済みのフレーム（out/frames。render.mjs --scale 2 --keep-frames で残したもの）から、配るための版を作る。
//
//   node tools/extras.mjs web            out/video-web.mp4（1280×720・30fps・10 MB 未満。GitHub や社内チャットに貼れる大きさ）
//   node tools/extras.mjs poster 15.9    out/poster.png（その時刻の 1 枚。動画の見出し画像に使う）
//   node tools/extras.mjs uhd            out/video-4k.mp4（3840×2160・60fps。2 倍で撮影したときだけ）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../out");
const dir = path.join(out, "frames");
const frames = path.join(dir, "%06d.png");
const audio = path.join(out, "audio-master.wav");
const [mode, arg] = process.argv.slice(2);
const color = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const scale = (size) => `scale=${size}:in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`;

const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{6}\.png$/.test(f)).length : 0;
if (!count) {
	console.error("out/frames がありません。node render.mjs --scale 2 --keep-frames で撮影してから実行してください");
	process.exit(1);
}
// 撮影したときの条件（render.mjs が控えている）
const metaFile = path.join(out, "frames.json");
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : { fps: 60, scale: 1 };
const fps = String(meta.fps);
const sound = fs.existsSync(audio);
if (!sound && mode !== "poster") console.error("out/audio-master.wav が無いので、音声なしで作ります");
function ffmpeg(args) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
	if (r.status !== 0) process.exit(1);
}
const mb = (f) => `${(fs.statSync(f).size / 1024 / 1024).toFixed(2)} MB`;

if (mode === "web") {
	// 10 MB に収まるよう、映像のビットレートを決めて 2 回に分けて圧縮する
	const seconds = count / meta.fps;
	const audioKbps = sound ? 128 : 0;
	const file = path.join(out, "video-web.mp4");
	const common = ["-framerate", fps, "-i", frames, ...(sound ? ["-i", audio] : []), "-vf", `fps=30,${scale("1280:720")}`, "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", ...color];
	const tail = [...(sound ? ["-c:a", "aac", "-b:a", `${audioKbps}k`, "-shortest"] : []), "-movflags", "+faststart", file];
	// まず画質を決めて圧縮する。短い動画はこれで 10 MB に収まる
	ffmpeg([...common, "-crf", "20", ...tail]);
	if (fs.statSync(file).size <= 9.5 * 1024 * 1024) {
		console.log(file, mb(file));
	} else {
		// 収まらないときは、10 MB に収まるビットレートを決めて 2 回に分けて圧縮する
		const videoKbps = Math.floor((9.3 * 8 * 1024) / seconds - audioKbps);
		if (videoKbps < 350) console.error(`${seconds.toFixed(0)} 秒を 10 MB に収めると画質がかなり落ちます（映像 ${videoKbps} kbps）。短い版を作るか、10 MB の制限がない置き場所を使ってください`);
		const log = path.join(out, "x264-2pass");
		ffmpeg([...common, "-b:v", `${videoKbps}k`, "-pass", "1", "-passlogfile", log, "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
		ffmpeg([...common, "-b:v", `${videoKbps}k`, "-pass", "2", "-passlogfile", log, ...tail]);
		for (const f of fs.readdirSync(out)) if (f.startsWith("x264-2pass")) fs.unlinkSync(path.join(out, f));
		console.log(file, mb(file), `video ${videoKbps} kbps`);
	}
} else if (mode === "poster") {
	const index = Math.min(count - 1, Math.max(0, Math.round(Number(arg ?? 0) * meta.fps)));
	const file = path.join(out, "poster.png");
	ffmpeg(["-i", path.join(dir, `${String(index).padStart(6, "0")}.png`), "-vf", "scale=1920:1080:flags=lanczos", "-frames:v", "1", file]);
	console.log(file);
} else if (mode === "uhd") {
	if (meta.scale < 2) {
		console.error("4K 版は、2 倍で撮影したフレームが必要です（node render.mjs --scale 2 --keep-frames）");
		process.exit(1);
	}
	const file = path.join(out, "video-4k.mp4");
	ffmpeg(["-framerate", fps, "-i", frames, ...(sound ? ["-i", audio] : []), "-vf", scale("3840:2160"), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation", ...color, ...(sound ? ["-c:a", "aac", "-b:a", "256k", "-shortest"] : []), "-movflags", "+faststart", file]);
	console.log(file, mb(file));
} else {
	console.error("使い方: node tools/extras.mjs web | poster <秒> | uhd");
	process.exit(1);
}
