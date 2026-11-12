// 画面の中の細かい動き（行の開閉・文字送り・数字・クラスの付け外し）のための補助。
// どれも「時刻だけで決まる」ように作ってある。
import { $$, onFrame, set, tl } from "./engine.js";

/* ---------------- フォントの先読み用に、後から出る文字を覚えておく ---------------- */

const texts = new Set(["0123456789:%+−-.,/ "]);
/** 後から JS で差し込む文字列を知らせる（フォントの読み込み漏れで文字が化けるのを防ぐ）。typed() は自動で登録する。 */
export const useText = (s) => texts.add(String(s));
export const usedText = () => [...texts].join(" ");

/* ---------------- 行の開閉 ---------------- */

const sizes = new WeakMap();
/** 行の自然な大きさ。組み立て時（全部を表示した状態）に測って覚える。 */
export function measure(node) {
	let m = sizes.get(node);
	if (!m) {
		const cs = getComputedStyle(node);
		const f = (v) => Number.parseFloat(v) || 0;
		m = { height: f(cs.height), marginTop: f(cs.marginTop), marginBottom: f(cs.marginBottom), paddingTop: f(cs.paddingTop), paddingBottom: f(cs.paddingBottom) };
		if (!m.height && cs.display !== "none") console.warn("[kit] 高さ 0 の行を測りました（display:none の中にありませんか）", node);
		sizes.set(node, m);
	}
	return m;
}
const CLOSED = { height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 };

/** 行を最初から閉じておく。 */
export function closeNow(node) {
	measure(node);
	set(node, { ...CLOSED, opacity: 0, overflow: "hidden" });
}
/** 閉じた行を開く。上にある行は自然に押し上げられる。 */
export function openRow(node, at, { dur = 0.42 } = {}) {
	const m = measure(node);
	tl.to(node, { ...m, duration: dur, ease: "out3" }, at);
	tl.to(node, { opacity: 1, duration: dur * 0.8, ease: "out2" }, at + dur * 0.2);
}
/** 行を閉じる。 */
export function closeRow(node, at, { dur = 0.36 } = {}) {
	measure(node);
	set(node, { overflow: "hidden" });
	tl.to(node, { opacity: 0, duration: dur * 0.6, ease: "in2" }, at);
	tl.to(node, { ...CLOSED, duration: dur, ease: "inOut3" }, at);
}
/** 最初は閉じておき、at で開く（closeNow + openRow）。 */
export function growIn(node, at, opts) {
	closeNow(node);
	openRow(node, at, opts);
}

/* ---------------- 文字 ---------------- */

/** t の時点で、at から毎秒 cps 文字で打った文字列。 label(node, (t) => typed("こんにちは", t, 3.2, 10)) */
export function typed(text, t, at, cps = 12) {
	useText(text);
	if (t < at) return "";
	const chars = [...text];
	return chars.slice(0, Math.min(chars.length, Math.floor((t - at) * cps) + 1)).join("");
}
/** 打ち終わる時刻。 */
export const typedEnd = (text, at, cps = 12) => at + [...text].length / cps;

/** node の文字を、時刻から決める。 label(node, (t) => `${Math.floor(t)} 秒`) */
export function label(node, fn) {
	let last = null;
	onFrame((t) => {
		const s = String(fn(t));
		if (s !== last) {
			node.textContent = s;
			last = s;
		}
	});
}

/**
 * 文章を先頭から少しずつ出す（AI の回答が流れてくる様子など）。
 * 中の文字を 1 文字ずつ span に分け、コードの囲みや箇条書きは最初の文字が出るまで隠す。
 * 返り値は出し終わる時刻。
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

/** 見出しを行ごとに下から出すための分割（.ln の中身を .ln-in で包む）。 */
export function maskLines(node) {
	for (const ln of $$(".ln", node)) {
		if (ln.firstElementChild?.classList.contains("ln-in")) continue;
		const inner = document.createElement("span");
		inner.className = "ln-in";
		while (ln.firstChild) inner.appendChild(ln.firstChild);
		ln.appendChild(inner);
	}
	return $$(".ln-in", node);
}

/* ---------------- 状態の切り替え ---------------- */

/** クラスの付け外しを時刻で決める。 toggle(btn, "on", [3, 5], [8]) は 3〜5 秒と 8 秒以降に付く。 */
export function toggle(node, cls, ...ranges) {
	onFrame((t) => {
		const on = ranges.some(([a, b = Number.POSITIVE_INFINITY]) => t >= a && t < b);
		if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
	});
}

/** 同じ場所に重ねた複数の表示（例: 状態ラベル）を、時刻で 1 つだけ見せる。 swap(parent, [[0, "wait"], [17.8, "work"]]) は data-k 属性で選ぶ。 */
export function swap(parent, steps) {
	const items = [...parent.children];
	onFrame((t) => {
		let key = steps[0][1];
		for (const [at, k] of steps) if (t >= at) key = k;
		for (const item of items) item.style.visibility = item.dataset.state === key ? "visible" : "hidden";
	});
}

/** 行が届いた瞬間に、うっすら光らせる（PC とスマホに同じ行が届く、などの対応関係を見せる）。 */
export function flash(node, at, { color = "77,154,191", peak = 0.28, dur = 0.9 } = {}) {
	tl.fromTo(node, { boxShadow: `inset 0 0 0 100px rgba(${color},${peak})` }, { boxShadow: `inset 0 0 0 100px rgba(${color},0)`, duration: dur, ease: "out2" }, at);
}

export const mmss = (sec) => {
	const s = Math.max(0, Math.floor(sec));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
