#!/usr/bin/env node
// 書き出した動画を機械で検品する。作った本人（AI）は動画を再生して見ることも聴くこともできないので、
// 「1 フレームだけの乱れ」「コマ落ち」「真っ黒」「音量」「無音」は、ここで数値として確かめる。
//
//   node tools/qa.mjs                 out/video.mp4 を調べる
//   node tools/qa.mjs out/part.mp4    指定したファイルを調べる
//
// ✗ が 1 つでもあれば終了コード 1。△ は理由が説明できれば直さなくてよい。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? path.join(root, "out", "video.mp4");
if (!fs.existsSync(file)) {
	console.error(`${file} がありません。先に node render.mjs で書き出してください`);
	process.exit(1);
}

let errors = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const warn = (msg) => console.log(`△ ${msg}`);
const bad = (msg) => {
	errors++;
	console.log(`✗ ${msg}`);
};
const sec = (t) => `${t.toFixed(2)}s`;
const ranges = (list) => list.map(([a, b]) => `${sec(a)}〜${sec(b)}`).join(", ");

/* ---------------- 1. 形式 ---------------- */

const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }).stdout);
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
const duration = Number(probe.format.duration);
const [num, den] = v.r_frame_rate.split("/").map(Number);
const fps = num / den;
console.log(`${path.basename(file)}  ${v.width}×${v.height}  ${fps}fps  ${duration.toFixed(2)}s  ${(Number(probe.format.size) / 1024 / 1024).toFixed(1)} MB`);
if (v.codec_name === "h264" && v.pix_fmt === "yuv420p") ok("映像は H.264 / yuv420p（どの環境でも再生できる）");
else bad(`映像が ${v.codec_name} / ${v.pix_fmt} です（H.264 / yuv420p にする）`);
if (v.color_space === "bt709") ok("色の指定は BT.709");
else warn(`色の指定が ${v.color_space ?? "なし"} です（再生側で色がずれることがある）`);
if (!a) warn("音声がありません（一部だけの書き出しなら正常）");
else if (a.codec_name === "aac" && Number(a.sample_rate) === 48000 && a.channels === 2) ok("音声は AAC / 48 kHz / ステレオ");
else bad(`音声が ${a.codec_name} / ${a.sample_rate} Hz / ${a.channels} ch です`);

/* ---------------- 2. 音 ---------------- */

if (a) {
	const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true,silencedetect=noise=-50dB:d=1.5", "-f", "null", "-"], { encoding: "utf8" }).stderr;
	const tail = r.slice(r.lastIndexOf("Summary:"));
	const lufs = Number(tail.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
	const peak = Number(tail.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
	if (lufs >= -16.5 && lufs <= -13.5) ok(`音量 ${lufs} LUFS（目標 -15 前後）`);
	else bad(`音量が ${lufs} LUFS です（-15 前後にそろえる。render.mjs の master を通っていますか）`);
	if (peak <= -0.3) ok(`ピーク ${peak} dBTP（歪まない）`);
	else bad(`ピークが ${peak} dBTP です（-1 前後まで下げる）`);
	const silent = [...r.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([s]) => s < duration - 1.2);
	if (silent.length) warn(`無音の区間があります: ${ranges(silent)}（意図した間でなければ、曲の区間や合図を確認）`);
	else ok("途中に無音の区間はない");
}

/* ---------------- 3. 映像（縮小した白黒のフレームを順に比べる） ---------------- */

const W = 320;
const H = 180;
const SIZE = W * H;
const diffs = []; // diffs[i] = フレーム i と i-1 の差（平均）
const means = [];
const flashes = [];
await new Promise((resolve) => {
	const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${W}:${H}:flags=area,format=gray`, "-f", "rawvideo", "-"]);
	let pending = Buffer.alloc(0);
	let prev = null;
	let prev2 = null;
	const mad = (x, y) => {
		let s = 0;
		for (let i = 0; i < SIZE; i++) s += Math.abs(x[i] - y[i]);
		return s / SIZE;
	};
	p.stdout.on("data", (chunk) => {
		pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
		while (pending.length >= SIZE) {
			const cur = Buffer.from(pending.subarray(0, SIZE));
			pending = pending.subarray(SIZE);
			const k = diffs.length;
			let m = 0;
			for (let i = 0; i < SIZE; i += 7) m += cur[i];
			means.push(m / Math.ceil(SIZE / 7));
			diffs.push(prev ? mad(cur, prev) : 0);
			// 1 フレームだけの乱れ: 前後とは大きく違うのに、その前後どうしは似ている
			if (prev2 && diffs[k - 1] > 1.2 && diffs[k] > 1.2 && mad(cur, prev2) < 0.45 * Math.min(diffs[k - 1], diffs[k])) flashes.push((k - 1) / fps);
			prev2 = prev;
			prev = cur;
		}
	});
	p.on("exit", resolve);
});
const n = diffs.length;
const expected = Math.round(duration * fps);
if (Math.abs(n - expected) <= 1) ok(`フレーム数 ${n}（${fps}fps × ${duration.toFixed(2)}s）`);
else bad(`フレーム数が ${n} です（${expected} のはず。撮影が途中で止まっていませんか）`);

if (flashes.length) bad(`1 フレームだけの乱れ: ${flashes.map(sec).join(", ")}（その時刻の前後を --sheet で見る。tl.set の時刻や、隠し忘れが多い）`);
else ok("1 フレームだけの乱れはない");

// コマ落ち: 動いている最中に、まったく同じフレームが挟まる
const stutters = [];
// （暗転の途中のごく暗いフレームは、圧縮で前のフレームと同じになることがあるので数えない）
for (let i = 2; i < n - 1; i++) if (diffs[i] < 0.004 && diffs[i - 1] > 0.8 && diffs[i + 1] > 0.8 && means[i] > 10) stutters.push(i / fps);
if (stutters.length) bad(`コマ落ち（同じフレームの繰り返し）: ${stutters.map(sec).join(", ")}`);
else ok("コマ落ちはない");

// 真っ黒・止まった絵（始めと終わりの暗転は除く）
const runs = (test, minSec) => {
	const out = [];
	let start = -1;
	for (let i = 0; i <= n; i++) {
		const hit = i < n && test(i);
		if (hit && start < 0) start = i;
		if (!hit && start >= 0) {
			if ((i - start) / fps >= minSec) out.push([start / fps, i / fps]);
			start = -1;
		}
	}
	return out;
};
const black = runs((i) => means[i] < 3, 0.4).filter(([s, e]) => s > 0.5 && e < duration - 0.5);
if (black.length) bad(`途中に真っ黒な区間があります: ${ranges(black)}`);
else ok("途中に真っ黒な区間はない");
const frozen = runs((i) => diffs[i] < 0.01, 2.5).filter(([s, e]) => s > 0.5 && e < duration - 1.5);
if (frozen.length) warn(`2.5 秒以上ほぼ動かない区間があります: ${ranges(frozen)}（読ませるための間でなければ、何か小さく動かす）`);
else ok("長く止まった絵はない");

// 大きな切り替わり（場面転換のはず）。小節の頭に合っているかの目安にする
const cuts = [];
for (let i = 1; i < n; i++) if (diffs[i] > 22) cuts.push(i / fps);
if (cuts.length) console.log(`  一気に切り替わる所（マスの波などを使わない切り替え）: ${cuts.map(sec).join(", ")}`);

console.log(errors ? `\n✗ ${errors} 件の不具合があります` : "\n機械で調べられる範囲では問題ありません。見た目は --sheet、聴感は人に確認してもらうこと");
process.exit(errors ? 1 : 0);
