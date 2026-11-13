// タイムラインの土台。外部ライブラリは使わず、ブラウザ標準の Web Animations API を「止めたまま」使う。
//
// 考え方: 見た目は時刻 t（秒）だけで決まる。
//   - 動き（位置・大きさ・色など）は tl.to / tl.from / tl.fromTo / tl.set で「何秒から何秒かけて」を積む。
//   - 文字送り・数字・回転など、積みにくいものは onFrame((t) => …) で t から直接求める。
//   - seek(t) を呼ぶと、その時刻の絵になる。どの時刻へ飛んでも同じ絵になるので、並列に撮影できる。

/* ---------------- 動かせる値 ---------------- */

// 位置・倍率・回転は、要素ごとに独立した値として持つ（x と scale を別々の時間に動かしても混ざらない）。
const TRANSFORM = {
	x: ["--kx", "px"],
	y: ["--ky", "px"],
	xPercent: ["--kxp", "%"],
	yPercent: ["--kyp", "%"],
	scale: ["--ks", ""],
	scaleX: ["--ksx", ""],
	scaleY: ["--ksy", ""],
	rotate: ["--kr", "deg"],
	rotation: ["--kr", "deg"],
};
for (const [name, syntax, initialValue] of [
	["--kx", "<length>", "0px"],
	["--ky", "<length>", "0px"],
	["--kxp", "<percentage>", "0%"],
	["--kyp", "<percentage>", "0%"],
	["--ks", "<number>", "1"],
	["--ksx", "<number>", "1"],
	["--ksy", "<number>", "1"],
	["--kr", "<angle>", "0deg"],
]) {
	CSS.registerProperty({ name, syntax, inherits: false, initialValue });
}
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
[data-k] { transform: translate(var(--kx), var(--ky)) translate(var(--kxp), var(--kyp)) rotate(var(--kr)) scale(calc(var(--ks) * var(--ksx)), calc(var(--ks) * var(--ksy))); }
svg [data-k] { transform-box: fill-box; transform-origin: 50% 50%; }
`);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

// 数字だけで書いたら px を付ける性質
const PX = new Set(
	"width height minWidth minHeight maxWidth maxHeight top left right bottom margin marginTop marginRight marginBottom marginLeft padding paddingTop paddingRight paddingBottom paddingLeft gap rowGap columnGap borderRadius borderWidth outlineOffset outlineWidth fontSize letterSpacing strokeWidth strokeDashoffset".split(
		" ",
	),
);
const registered = new Set();

/** { x: 10, opacity: 0, … } を、ブラウザに渡すキーフレームに直す。 */
function keyframe(vars, node) {
	const out = {};
	for (const [key, value] of Object.entries(vars)) {
		if (TRANSFORM[key]) {
			const [name, unit] = TRANSFORM[key];
			out[name] = typeof value === "number" ? `${value}${unit}` : value;
			if (node) node.dataset.k = "";
		} else if (key === "autoAlpha") {
			// 透明なら当たり判定や読み上げからも消す（opacity と visibility を一緒に動かす）
			out.opacity = value;
			out.visibility = Number(value) === 0 ? "hidden" : "visible";
		} else if (key.startsWith("--")) {
			if (typeof value === "number" && !registered.has(key)) {
				registered.add(key);
				try {
					CSS.registerProperty({ name: key, syntax: "<number>", inherits: true, initialValue: "0" });
				} catch {}
			}
			out[key] = String(value);
		} else {
			out[key] = typeof value === "number" && PX.has(key) ? `${value}px` : value;
		}
	}
	return out;
}

/* ---------------- イージング ---------------- */

const P = {
	linear: (p) => p,
	out2: (p) => 1 - (1 - p) ** 2,
	out3: (p) => 1 - (1 - p) ** 3,
	out4: (p) => 1 - (1 - p) ** 4,
	out5: (p) => 1 - (1 - p) ** 5,
	in2: (p) => p ** 2,
	in3: (p) => p ** 3,
	in4: (p) => p ** 4,
	inOut2: (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
	inOut3: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
	inOut4: (p) => (p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2),
	sineOut: (p) => Math.sin((p * Math.PI) / 2),
	sineInOut: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
	expoOut: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
	expoIn: (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10)),
};
/** 行きすぎてから戻る。s が大きいほど大きく行きすぎる。 */
const back = (s = 1.6) => (p) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
const sampled = (fn, n = 40) => `linear(${Array.from({ length: n + 1 }, (_, i) => Number(fn(i / n).toFixed(4))).join(", ")})`;

const CSS_EASE = {
	none: "linear",
	// この雛形でよく使う 3 つ
	swift: "cubic-bezier(0.2, 0.9, 0.2, 1)", // 素早く入り、長くなめらかに止まる（見出し・部品の登場）
	glide: "cubic-bezier(0.65, 0, 0.2, 1)", // ゆっくり動き出して止まる（カメラや端末の移動）
	settle: "cubic-bezier(0.3, 1.25, 0.5, 1)", // 少し行きすぎて収まる（落ちてくる通知など）
};
for (const [name, fn] of Object.entries(P)) CSS_EASE[name] = name === "linear" ? "linear" : sampled(fn);

// GSAP 風の名前でも受け付ける（power3.out、back.out(1.6) など）
const ALIAS = { "sine.out": "sineOut", "sine.inOut": "sineInOut", "expo.out": "expoOut", "expo.in": "expoIn", "power1.out": "out2", "power1.in": "in2", "power1.inOut": "inOut2" };
for (const n of [2, 3, 4]) {
	ALIAS[`power${n}.out`] = `out${n}`;
	ALIAS[`power${n}.in`] = `in${n}`;
	ALIAS[`power${n}.inOut`] = `inOut${n}`;
}

function easing(name = "out3") {
	if (Array.isArray(name)) return `cubic-bezier(${name.join(", ")})`;
	const key = ALIAS[name] ?? name;
	if (CSS_EASE[key]) return CSS_EASE[key];
	const m = /^back(?:\.out)?(?:\(([\d.]+)\))?$/.exec(key);
	if (m) return (CSS_EASE[key] = sampled(back(m[1] ? Number(m[1]) : 1.6)));
	if (/^(cubic-bezier|linear|steps)\(/.test(key)) return key;
	throw new Error(`知らないイージング: ${name}`);
}

/** onFrame の中で使う、同じカーブの関数版。ease.out3(p) のように使う。 */
export const ease = { ...P, back };

/* ---------------- 対象の指定 ---------------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function nodes(targets) {
	if (!targets) return [];
	if (typeof targets === "string") {
		const found = $$(targets);
		if (!found.length) console.warn(`[kit] 対象が見つかりません: ${targets}`);
		return found;
	}
	if (targets instanceof Element) return [targets];
	return [...targets].flatMap(nodes);
}

/** HTML の文字列から要素を 1 つ作る。 */
export function el(html) {
	const t = document.createElement("template");
	t.innerHTML = html.trim();
	return t.content.firstElementChild;
}

/* ---------------- タイムライン ---------------- */

const OPTIONS = new Set(["duration", "ease", "stagger", "repeat", "yoyo"]);
const specs = [];
let built = false;
let animations = [];
let order = 0;

function add(kind, targets, from, to, at, extra = {}) {
	if (built) throw new Error("タイムラインは build() の前に積んでください");
	if (typeof at !== "number" || Number.isNaN(at)) throw new Error(`開始時刻（秒）が必要です: ${JSON.stringify(to ?? from)}`);
	const opts = {};
	const split = (vars) => {
		const rest = {};
		for (const [k, v] of Object.entries(vars ?? {})) {
			if (OPTIONS.has(k)) opts[k] = v;
			else rest[k] = v;
		}
		return rest;
	};
	const a = from ? split(from) : null;
	const b = to ? split(to) : null;
	const list = nodes(targets);
	// $() が何も見つけられなかった（null）ときに、黙って何も起きないのを防ぐ
	if (!list.length && typeof targets !== "string") console.warn(`[kit] 動かす対象が空です（${at} 秒の ${JSON.stringify(to ?? from)}）。$() のセレクターを確かめてください`);
	list.forEach((node, i) => {
		specs.push({ kind, node, from: a, to: b, start: at + (opts.stagger ?? 0) * i, opts, order: order++, ...extra });
	});
}

// 位置と回転は「今いる所からのずれ」として足し引きできる（登場・退場に使う）
const OFFSET = new Set(["x", "y", "xPercent", "yPercent", "rotate", "rotation"]);
function parts(vars) {
	const off = {};
	const abs = {};
	for (const [k, v] of Object.entries(vars ?? {})) (OFFSET.has(k) ? off : abs)[k] = v;
	return { off, abs, zero: Object.fromEntries(Object.keys(off).map((k) => [k, 0])), moves: Object.keys(off).length > 0 };
}

export const tl = {
	/** 今の値から vars の値へ動かす。 tl.to("#card", { y: 0, opacity: 1, duration: 0.6, ease: "swift" }, 12.5) */
	to: (targets, vars, at) => add("to", targets, null, vars, at),
	/** vars の値から、その要素の今の値へ動かす。at より前は今の値のまま。 */
	from: (targets, vars, at) => add("from", targets, vars, null, at),
	/** from の値から to の値へ動かす。at より前は今の値のまま。 */
	fromTo: (targets, from, to, at) => add("fromTo", targets, from, to, at),
	/** at の瞬間に値を切り替える。 */
	set: (targets, vars, at) => add("to", targets, null, { ...vars, duration: 0 }, at),
	/**
	 * 登場。at まで隠しておき、from の状態から本来の状態へ現れる。
	 *   tl.in("#card", { y: 40, scale: 0.94 }, 12.5, { duration: 0.6, ease: "back(1.6)" })
	 * x / y / rotate は「本来の位置からのずれ」（上の例は 40px 下から）。scale などはその値から本来の値へ。
	 */
	in(targets, from, at, opts = {}) {
		const p = parts(from);
		for (const node of nodes(targets)) setNow(node, { autoAlpha: 0 });
		if (p.moves) add("fromTo", targets, p.off, { ...opts, ...p.zero }, at, { composite: "add", fill: "none" });
		add("fromTo", targets, { ...p.abs, autoAlpha: 0 }, { ...opts, autoAlpha: 1 }, at);
	},
	/**
	 * 退場。to の状態へ動きながら消える。 tl.out("#card", { y: -30 }, 20, { duration: 0.35 })
	 * x / y / rotate は「今いる所からのずれ」。消えたあと、ずれは残らない。
	 */
	out(targets, to, at, opts = {}) {
		const p = parts(to);
		const o = { duration: 0.35, ease: "in2", ...opts };
		if (p.moves) add("fromTo", targets, p.zero, { ...o, ...p.off }, at, { composite: "add", fill: "none" });
		add("to", targets, null, { ...o, ...p.abs, autoAlpha: 0 }, at);
	},
	show: (targets, at) => add("to", targets, null, { autoAlpha: 1, duration: 0 }, at),
	hide: (targets, at) => add("to", targets, null, { autoAlpha: 0, duration: 0 }, at),
};

function setNow(node, vars) {
	for (const [name, value] of Object.entries(keyframe(vars, node))) {
		if (name.startsWith("--")) node.style.setProperty(name, value);
		else node.style[name] = value;
	}
}

/** 最初の状態を決める（タイムラインに積まず、その場で設定する）。 set("#card", { x: 100, autoAlpha: 0 }) */
export function set(targets, vars) {
	for (const node of nodes(targets)) setNow(node, vars);
}

/** 今の時刻での値を読む。 get(node, "x")、get(node, "scale")、get(node, "opacity") */
export function get(node, key) {
	const cs = getComputedStyle(node);
	if (TRANSFORM[key]) return Number.parseFloat(cs.getPropertyValue(TRANSFORM[key][0]));
	const v = key.startsWith("--") ? cs.getPropertyValue(key) : cs[key];
	const n = Number.parseFloat(v);
	return Number.isNaN(n) ? v : n;
}

/** 積んだ動きを確定する。これ以降は seek(t) で好きな時刻の絵にできる。 */
export function build() {
	// 同じ性質を続けて動かすとき、後から始まるものが勝つように、開始時刻の順に作る
	specs.sort((a, b) => a.start - b.start || a.order - b.order);
	for (const s of specs) {
		const frames = [];
		if (s.from) frames.push({ ...keyframe(s.from, s.node), offset: 0 });
		if (s.to) frames.push({ ...keyframe(s.to, s.node), offset: 1 });
		const o = s.opts;
		const anim = s.node.animate(frames, {
			delay: s.start * 1000,
			duration: (o.duration ?? 0.6) * 1000,
			easing: easing(o.ease),
			fill: s.fill ?? "forwards",
			composite: s.composite ?? "replace",
			iterations: (o.repeat ?? 0) + 1,
			direction: o.yoyo ? "alternate" : "normal",
		});
		anim.pause();
		anim.persist();
		animations.push(anim);
	}
	built = true;
	return animations.length;
}

const hooks = [];
/** 毎フレーム呼ぶ関数を登録する。fn(t) は t だけから見た目を決めること（乱数や現在時刻を使わない）。 */
export function onFrame(fn) {
	hooks.push(fn);
}

let now = 0;
export function seek(t) {
	now = t;
	const ms = t * 1000;
	for (const a of animations) a.currentTime = ms;
	for (const fn of hooks) fn(t);
}
export const time = () => now;

/* ---------------- 小さな道具 ---------------- */

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** t が a→b のどこにいるか（0〜1）。 */
export const prog = (t, a, b) => clamp01((t - a) / (b - a));
export const lerp = (a, b, p) => a + (b - a) * p;

/** 決定的な疑似乱数（同じ seed なら同じ列）。Math.random は撮影のたびに絵が変わるので使わない。 */
export function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let x = Math.imul(s ^ (s >>> 15), 1 | s);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
}

/** root から見た node の位置（transform は含めない）。 */
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
