// 起動の順番: 部品を置く → フォントを読む → 動きを積む（ここで高さを測る）→ 確定する。
// フォントを読む前に測ると、行の高さがずれる。順番を変えないこと。
import { brand } from "./brand.js";
import { build, seek } from "./kit/engine.js";
import { usedText } from "./kit/helpers.js";
import { lint } from "./kit/lint.js";
import { music } from "./plan.js";
import * as scenes from "./scenes.js";

for (const href of brand.fonts.css) document.head.insertAdjacentHTML("beforeend", `<link rel="stylesheet" href="${href}">`);
await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.sheet ?? new Promise((r) => l.addEventListener("load", r))));

/** 使う文字のフォントを全て先に読み込む（途中で文字が化けたり、幅が変わったりしないように）。 */
async function loadFonts() {
	const text = document.querySelector("#stage").textContent + usedText();
	const jobs = [];
	for (const [family, weights] of Object.entries(brand.fonts.load)) for (const w of weights) jobs.push(document.fonts.load(`${w} 16px "${family}"`, text));
	await Promise.all(jobs);
	await document.fonts.ready;
}

scenes.mount();
await loadFonts();
scenes.animate();
await loadFonts();
const count = build();
seek(0);

const duration = music.sections[music.sections.length - 1].to;
const missing = Object.keys(brand.fonts.load).filter((f) => !document.fonts.check(`16px "${f}"`));
if (missing.length) console.warn(`[kit] フォントが読み込めていません: ${missing.join(", ")}`);

window.__video = {
	ready: true,
	duration,
	animations: count,
	seek,
	lint: (t) => {
		seek(t);
		return lint();
	},
	renderAudio: async (only) => (await import("./kit/audio.js")).render(music, only),
	audioChunk: async (offset, size) => (await import("./kit/audio.js")).chunk(offset, size),
};
