// 時刻 t（秒）だけで全ての見た目が決まるようにするための土台。
// GSAP のタイムラインは止めたまま time(t) で動かし、文字送りや回転などは onFrame の関数で t から直接求める。
import { CustomEase } from "/node_modules/gsap/CustomEase.js";
import { gsap } from "/node_modules/gsap/index.js";

gsap.registerPlugin(CustomEase);
gsap.config({ force3D: false, nullTargetWarn: false });
gsap.defaults({ lazy: false, overwrite: false, ease: "power3.out", duration: 0.6 });

CustomEase.create("swift", "M0,0 C0.2,0.9 0.2,1 1,1");
CustomEase.create("glide", "M0,0 C0.65,0 0.2,1 1,1");
CustomEase.create("settle", "M0,0 C0.3,1.25 0.5,1 1,1");

export { gsap };
export const tl = gsap.timeline({ paused: true });

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
	const t = document.createElement("template");
	t.innerHTML = html.trim();
	return t.content.firstElementChild;
}

const hooks = [];
/** 毎フレーム呼ぶ関数を登録する。fn(t) は t だけから見た目を決めること。 */
export function onFrame(fn) {
	hooks.push(fn);
}

export function seek(t) {
	tl.time(t);
	for (const fn of hooks) fn(t);
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const prog = (t, a, b) => clamp01((t - a) / (b - a));
export const lerp = (a, b, p) => a + (b - a) * p;
export const ease = {
	out3: (p) => 1 - (1 - p) ** 3,
	out5: (p) => 1 - (1 - p) ** 5,
	in3: (p) => p ** 3,
	inOut3: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
	outBack: (p, s = 1.5) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2,
};

/** 決定的な疑似乱数（シードごとに同じ列）。 */
export function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let x = Math.imul(s ^ (s >>> 15), 1 | s);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** root から見た el の位置（transform は含めない）。 */
export function rectIn(node, root) {
	let x = 0;
	let y = 0;
	let n = node;
	while (n && n !== root) {
		x += n.offsetLeft;
		y += n.offsetTop;
		n = n.offsetParent;
	}
	return { x, y, w: node.offsetWidth, h: node.offsetHeight };
}

const sizes = new WeakMap();
/** 行の自然な大きさ。組み立て時（全て表示した状態）に測って覚えておく。 */
export function measure(node) {
	let m = sizes.get(node);
	if (!m) {
		const cs = getComputedStyle(node);
		const f = (v) => Number.parseFloat(v) || 0;
		m = { h: f(cs.height), mt: f(cs.marginTop), mb: f(cs.marginBottom), pt: f(cs.paddingTop), pb: f(cs.paddingBottom) };
		sizes.set(node, m);
	}
	return m;
}

const CLOSED = { height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 };

/** 行を最初から閉じておく。 */
export function closeNow(node) {
	measure(node);
	gsap.set(node, { ...CLOSED, opacity: 0, overflow: "hidden" });
}

/** 閉じた行を開く。 */
export function openRow(node, at, { dur = 0.42 } = {}) {
	const m = measure(node);
	tl.to(node, { height: m.h, marginTop: m.mt, marginBottom: m.mb, paddingTop: m.pt, paddingBottom: m.pb, duration: dur, ease: "power3.out" }, at);
	tl.to(node, { opacity: 1, duration: dur * 0.8, ease: "power2.out" }, at + dur * 0.2);
}

/** 行を閉じる。 */
export function closeRow(node, at, { dur = 0.36 } = {}) {
	measure(node);
	gsap.set(node, { overflow: "hidden" });
	tl.to(node, { opacity: 0, duration: dur * 0.6, ease: "power2.in" }, at);
	tl.to(node, { ...CLOSED, duration: dur, ease: "power3.inOut" }, at);
}

/** 行を高さ 0 から開く（closeNow + openRow）。 */
export function growIn(node, at, opts) {
	closeNow(node);
	openRow(node, at, opts);
}

/** クラスの付け外しを時刻で決める。ranges は [開始, 終了] の並び（終了を省くと最後まで）。 */
export function toggle(node, cls, ...ranges) {
	onFrame((t) => {
		const on = ranges.some(([a, b = Number.POSITIVE_INFINITY]) => t >= a && t < b);
		if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
	});
}

/** t における「at から cps で打った文字列」。 */
export function typed(text, t, at, cps) {
	if (t < at) return "";
	const chars = [...text];
	return chars.slice(0, Math.min(chars.length, Math.floor((t - at) * cps) + 1)).join("");
}

/** 1 文字ずつ打つ。caret は打っている間だけ点滅を止める。 */
export function typeText(node, text, at, { cps = 16, from = "" } = {}) {
	const chars = [...text];
	const end = at + chars.length / cps;
	node.textContent = from;
	onFrame((t) => {
		const n = t < at ? 0 : Math.min(chars.length, Math.floor((t - at) * cps) + 1);
		const s = from + chars.slice(0, n).join("");
		if (node.textContent !== s) node.textContent = s;
	});
	return end;
}

/**
 * 文章を先頭から少しずつ出す（回答のストリーミング）。
 * 文字ごとに span に分け、コードの囲みや箇条書きは最初の文字が出るまで隠す。
 */
export function stream(node, at, { cps = 46 } = {}) {
	const units = [];
	const groups = [];
	const walk = (n, parents) => {
		for (const c of [...n.childNodes]) {
			if (c.nodeType === 3) {
				const frag = document.createDocumentFragment();
				for (const ch of [...c.textContent]) {
					const s = document.createElement("span");
					s.textContent = ch;
					frag.appendChild(s);
					units.push(s);
					for (const g of parents) if (g.first < 0) g.first = units.length - 1;
				}
				c.replaceWith(frag);
			} else if (c.nodeType === 1) {
				if (c.dataset.atom !== undefined) {
					units.push(c);
					for (const g of parents) if (g.first < 0) g.first = units.length - 1;
					continue;
				}
				const g = { node: c, first: -1, display: c.dataset.display || "" };
				groups.push(g);
				walk(c, [...parents, g]);
			}
		}
	};
	walk(node, []);
	const total = units.length;
	let shown = -1;
	onFrame((t) => {
		const n = t < at ? 0 : Math.min(total, Math.floor((t - at) * cps) + 1);
		if (n === shown) return;
		shown = n;
		for (let i = 0; i < total; i++) units[i].style.display = i < n ? "" : "none";
		for (const g of groups) g.node.style.display = g.first >= 0 && g.first < n ? g.display : "none";
	});
	return at + total / cps;
}

/** 数字や時刻の表示を t から決める。 */
export function label(node, fn) {
	let last = null;
	onFrame((t) => {
		const s = fn(t);
		if (s !== last) {
			node.textContent = s;
			last = s;
		}
	});
}

/** 見出しを行ごとに下から出すための分割。 */
export function maskLines(node) {
	const lines = $$(".ln", node);
	for (const ln of lines) {
		const inner = document.createElement("span");
		inner.className = "ln-in";
		while (ln.firstChild) inner.appendChild(ln.firstChild);
		ln.appendChild(inner);
	}
	return $$(".ln-in", node);
}

export const mmss = (sec) => {
	const s = Math.max(0, Math.floor(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
