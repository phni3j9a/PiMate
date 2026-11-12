// その時刻の画面に、ありがちな不具合がないかを調べる。render.mjs --lint が全編を通して呼び、続いているものだけを報告する。
// 目で見る確認の代わりにはならない（見た目の良し悪しは分からない）。見落としやすい機械的な崩れを拾うためのもの。
import { $$ } from "./engine.js";

const W = 1920;
const H = 1080;
const MARGIN = 24;

const shown = (n) => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
const name = (n) => (n.id ? `#${n.id}` : `${n.closest("[id]")?.id ? `#${n.closest("[id]").id} ` : ""}.${[...n.classList].join(".")}`);
const text = (n) => n.textContent.trim().replace(/\s+/g, " ").slice(0, 24);
const overlap = (a, b) => Math.min(Math.min(a.right, b.right) - Math.max(a.left, b.left), Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** 文字そのものの範囲（中央寄せの行は、箱ではなく文字の幅で測る）。 */
const ink = (n) => {
	const range = document.createRange();
	range.selectNodeContents(n);
	const r = range.getBoundingClientRect();
	return r.width ? r : n.getBoundingClientRect();
};

// 読ませるための文字（切れていたら必ず不具合）
const TEXT = ".cap-h .ln-in, .cap-en, .cap-meta, .pts li, #logo-tag > *, #end-url, #end-meta span, .tile-h b, .tile-f, .step .t, .check, .notif-t, .notif-b";
// 製品の画面を入れる入れ物と、大きな部品
const BLOCKS = ".phone, .browser, .term, .tiles, .step, .checks, .notif";

export function lint() {
	const out = [];
	const add = (rule, level, node, message) => out.push({ key: `${rule} ${name(node)}`, rule, level, message });

	// 1. 文字が画面や枠からはみ出して切れている
	for (const n of $$(TEXT)) {
		if (!shown(n) || !n.textContent.trim()) continue;
		const r = ink(n);
		if (r.width < 2) continue;
		if (r.right > W - MARGIN || r.left < MARGIN) add("text-offstage", "error", n, `「${text(n)}」が画面の左右からはみ出しています（${Math.round(r.left)}〜${Math.round(r.right)}px）。文字を減らすか、小さい size にしてください`);
		const box = n.closest(".tile, .step, .notif");
		if (box) {
			const b = box.getBoundingClientRect();
			if (r.right > b.right - 8) add("text-clipped", "error", n, `「${text(n)}」が枠の右で切れています。文言を短くしてください`);
		}
	}

	// 2. 見出しが、入れ物や部品に重なっている
	const blocks = $$(BLOCKS).filter(shown).map((n) => [n, n.getBoundingClientRect()]);
	for (const cap of $$(".cap").filter(shown)) {
		for (const part of $$(".ln-in, .cap-en", cap)) {
			if (!shown(part)) continue;
			const r = ink(part);
			const mask = part.closest(".ln")?.getBoundingClientRect();
			// 行が下から出てくる途中（まだ枠の外）は数えない
			if (mask && (r.top > mask.bottom - 4 || r.bottom < mask.top + 4)) continue;
			for (const [b, br] of blocks) {
				if (overlap(r, br) > 6) add("caption-overlap", "error", cap, `見出し ${name(cap)} が ${name(b)} に重なっています。位置をずらすか、文字を短くしてください`);
				else if (overlap({ left: r.left, right: r.right, top: r.top - 28, bottom: r.bottom + 28 }, br) > 0 && r.bottom <= br.top + 6) add("caption-tight", "warn", cap, `見出し ${name(cap)} と ${name(b)} の間が詰まっています（28px 未満）`);
			}
		}
	}

	// 3. 入れ物が小さすぎて、中の文字が読めない
	for (const n of $$(".phone, .browser, .term").filter(shown)) {
		const s = n.getBoundingClientRect().width / n.offsetWidth;
		if (s < 0.85) add("device-small", "warn", n, `${name(n)} が ${s.toFixed(2)} 倍で表示されています。中の文字が読めないので 1.0 倍以上にするか、見せたい所に寄ってください`);
	}

	// 3b. 入れ物の中の文字が、画面上で小さすぎる（スマホで動画を見る人には読めない）
	for (const n of $$(".phone, .browser, .term").filter(shown)) {
		const s = n.getBoundingClientRect().width / n.offsetWidth;
		const sizes = [];
		for (const leaf of n.querySelectorAll("*")) {
			if (leaf.children.length || !leaf.textContent.trim() || !shown(leaf) || leaf.closest(".statusbar, .browser-bar, .term-bar")) continue;
			sizes.push(Number.parseFloat(getComputedStyle(leaf).fontSize) * s);
		}
		if (sizes.length < 3) continue;
		sizes.sort((a, b) => a - b);
		const main = sizes[Math.floor(sizes.length * 0.75)];
		if (main < 17) add("ui-text-small", "warn", n, `${name(n)} の中の文字が、画面上で約 ${main.toFixed(0)}px です。18px 以上になるよう、入れ物を大きくするか、見せたい所に寄ってください`);
	}

	// 4. 何も映っていない
	const anything = $$("#world > *, #over > *, #logo > *").some((n) => {
		if (!shown(n)) return false;
		const r = n.getBoundingClientRect();
		return r.width > 40 && r.height > 20 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H && n.id !== "sparks";
	});
	if (!anything && Number(getComputedStyle(document.querySelector("#blackout")).opacity) < 0.5 && getComputedStyle(document.querySelector("#wipe")).display === "none")
		out.push({ key: "empty-frame", rule: "empty-frame", level: "warn", message: "背景以外に何も映っていません" });

	return out;
}
