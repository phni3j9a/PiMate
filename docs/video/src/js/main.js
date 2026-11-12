import { $, $$, gsap, seek } from "./engine.js";
import { app, applyPalette, stage } from "./tokens.js";
import { phoneHTML, termHTML } from "./ui.js";

const FAMILIES = {
	Inter: [400, 500, 600, 700, 800],
	"Noto Sans JP": [400, 500, 600, 700, 800],
	"JetBrains Mono": [400, 500, 600, 700],
};

/** 文字の欠けを防ぐため、使う文字のフォントを全て先に読み込む。 */
async function loadFonts(text) {
	const jobs = [];
	for (const [family, weights] of Object.entries(FAMILIES))
		for (const w of weights) jobs.push(document.fonts.load(`${w} 16px "${family}"`, text));
	await Promise.all(jobs);
	await document.fonts.ready;
}

const stageEl = $("#stage");
const world = $("#world");
applyPalette(stageEl, stage.light, stage.light, 0);

world.insertAdjacentHTML("beforeend", termHTML());
world.insertAdjacentHTML("beforeend", phoneHTML());
applyPalette($("#phone"), app.light, app.light, 0);

const params = new URLSearchParams(location.search);
const scenes = await import("./scenes.js");
scenes.mount();
await loadFonts(stageEl.textContent + scenes.extraText);

let duration = 0;
if (params.has("show")) {
	// 部品の見た目を確かめるための静止表示。
	const show = params.get("show").split(",");
	const dark = params.has("dark");
	if (dark) {
		applyPalette(stageEl, stage.dark, stage.dark, 0);
		applyPalette($("#phone"), app.dark, app.dark, 0);
	}
	for (const s of $$("#pscreen > .screen, #scrim, #drawer")) s.style.display = show.includes(s.id) ? "" : "none";
	if (show.includes("drawer")) {
		$("#chatA").style.display = "";
		$("#scrim").style.display = "";
	}
	for (const v of $$(".term-view")) v.style.display = show.includes(v.id) ? "" : "none";
	gsap.set("#phone", { x: 1280, y: 62, scale: 1.1 });
	gsap.set("#term", { x: 120, y: 300, scale: 1 });
	$("#blackout").style.display = "none";
	for (const n of $$("#world > :not(#phone):not(#term)")) n.style.display = "none";
	$("#over").style.display = "none";
} else {
	duration = scenes.build();
	seek(0);
}

window.__video = {
	ready: true,
	duration,
	seek,
	renderAudio: async () => {
		const audio = await import("./audio.js");
		return audio.render(duration);
	},
};
