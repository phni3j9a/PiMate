#!/usr/bin/env node
// 撮影済みのフレーム（out/frames、render.mjs --scale 2 --keep-frames で残したもの）から、
// 軽量版・見出し用の静止画・4K 版を作る。
//
//   node tools/extras.mjs web            out/pimate-intro-web.mp4（1280×720・30fps・10 MB 未満）
//   node tools/extras.mjs poster 15.9    out/poster.png（その時刻の 1 枚）
//   node tools/extras.mjs uhd            out/pimate-intro-4k.mp4（3840×2160・60fps）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../out");
const frames = path.join(out, "frames", "%06d.png");
const audio = path.join(out, "audio-master.wav");
const [mode, arg] = process.argv.slice(2);
const color = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const scale = (size) => `scale=${size}:in_range=full:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`;

function ffmpeg(args) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
	if (r.status !== 0) process.exit(1);
}

if (mode === "web") {
	// 10 MB に収まるよう、映像のビットレートを決めて 2 回に分けて圧縮する
	const seconds = fs.readdirSync(path.dirname(frames)).length / 60;
	const audioKbps = 128;
	const videoKbps = Math.floor((9.3 * 8 * 1024) / seconds - audioKbps);
	const file = path.join(out, "pimate-intro-web.mp4");
	const common = ["-framerate", "60", "-i", frames, "-i", audio, "-vf", `fps=30,${scale("1280:720")}`, "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-b:v", `${videoKbps}k`, ...color];
	const log = path.join(out, "x264-2pass");
	ffmpeg([...common, "-pass", "1", "-passlogfile", log, "-an", "-f", "null", "-"]);
	ffmpeg([...common, "-pass", "2", "-passlogfile", log, "-c:a", "aac", "-b:a", `${audioKbps}k`, "-movflags", "+faststart", "-shortest", "-metadata", "title=PiMate 紹介動画", file]);
	for (const f of fs.readdirSync(out)) if (f.startsWith("x264-2pass")) fs.rmSync(path.join(out, f));
	console.log(file, `${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`, `video ${videoKbps} kbps`);
} else if (mode === "poster") {
	const index = Math.round(Number(arg ?? 15.9) * 60);
	const file = path.join(out, "poster.png");
	ffmpeg(["-i", path.join(out, "frames", `${String(index).padStart(6, "0")}.png`), "-vf", "scale=1920:1080:flags=lanczos", "-frames:v", "1", file]);
	console.log(file);
} else if (mode === "uhd") {
	const file = path.join(out, "pimate-intro-4k.mp4");
	ffmpeg(["-framerate", "60", "-i", frames, "-i", audio, "-vf", scale("3840:2160"), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation", ...color, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", "-metadata", "title=PiMate 紹介動画", file]);
	console.log(file, `${(fs.statSync(file).size / 1024 / 1024).toFixed(2)} MB`);
} else {
	console.error("使い方: node tools/extras.mjs web | poster <秒> | uhd");
	process.exit(1);
}
