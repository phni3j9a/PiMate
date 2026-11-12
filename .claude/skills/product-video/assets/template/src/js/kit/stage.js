// 舞台の上の部品と、共通の動き。製品に依存しない。色・名前・ロゴは brand.js から取る。
import { brand } from "../brand.js";
import { cue } from "./cue.js";
import { $, $$, clamp01, ease, el, get, onFrame, prog, rectIn, rng, set, tl } from "./engine.js";
import { maskLines, useText } from "./helpers.js";

export const W = 1920;
export const H = 1080;

/* ---------------- 色（パレット） ---------------- */

const colorVars = new Set();
const isColor = (v) => typeof v === "string" && /^(#|rgb|hsl)/.test(v);

function toVars(palette) {
	const vars = {};
	for (const [key, value] of Object.entries(palette)) {
		const name = `--${key}`;
		if (isColor(value) && !colorVars.has(name)) {
			colorVars.add(name);
			// 色として登録しておくと、テーマの切り替えをなめらかに混ぜられる
			try {
				CSS.registerProperty({ name, syntax: "<color>", inherits: true, initialValue: value });
			} catch {}
		}
		vars[name] = value;
	}
	return vars;
}

/** パレットを当てる。at を省くと最初から、指定するとその時刻に切り替える（dur 秒かけて混ぜる）。 */
export function palette(target, colors, at, dur = 0) {
	const vars = toVars(colors);
	if (at === undefined) set(target, vars);
	else tl.to(target, { ...vars, duration: dur, ease: "inOut2" }, at);
}

/* ---------------- 舞台の組み立て ---------------- */

/** #stage の中に、背景・部品を置く層・切り替え用の層を作る。 */
export function mountStage({ theme = "light" } = {}) {
	const stage = $("#stage");
	stage.innerHTML = `
<div class="layer" id="bg-glow"></div>
<div class="layer" id="bg-grid"></div>
<div class="layer" id="world"></div>
<div class="layer" id="vignette"></div>
<div class="layer" id="wipe">${Array.from({ length: COLS * ROWS }, (_, i) => `<i style="left:${(i % COLS) * 120}px;top:${Math.floor(i / COLS) * 120}px"></i>`).join("")}</div>
<div class="layer" id="over"></div>
<div class="layer" id="blackout"></div>`;
	for (const [k, v] of Object.entries(brand.fonts)) if (k !== "load") stage.style.setProperty(`--f-${k}`, v);
	palette(stage, brand[theme]);

	// 背景の光だけを、ゆっくり動かす。文字のある部品はゆっくり動かさない（文字が震えるため）
	const glow = $("#bg-glow");
	onFrame((t) => {
		glow.style.transform = `translate(${(Math.sin(t * 0.21) * 70).toFixed(2)}px, ${(Math.cos(t * 0.17) * 40).toFixed(2)}px) scale(1.12)`;
	});
	onFrame(drawWipes);
	return { stage, world: $("#world"), over: $("#over") };
}

/** 回る印（.spin）と点滅するカーソル（.caret, .t-caret）を動かす。部品を全部置いてから 1 回呼ぶ。 */
export function animateMarks() {
	const spins = $$(".spin");
	const carets = $$(".caret, .t-caret");
	onFrame((t) => {
		const deg = ((t * 400) % 360).toFixed(1);
		for (const s of spins) s.style.rotate = `${deg}deg`;
		const on = t % 1.06 < 0.6 ? 1 : 0;
		for (const c of carets) if (!c.dataset.solid) c.style.opacity = on;
	});
}

/** 黒からの明け・黒への暮れ。 */
export function fadeFromBlack(at = 0, dur = 1.2) {
	set("#blackout", { opacity: 1 });
	tl.to("#blackout", { opacity: 0, duration: dur, ease: "out2" }, at);
}
export function fadeToBlack(at, dur = 1.1) {
	tl.to("#blackout", { opacity: 1, duration: dur, ease: "inOut2" }, at);
}

/* ---------------- 見出し ---------------- */

const caps = {};

/**
 * 見出しを作る。
 * caption("c1", { no: "01", tag: "SYNC", lines: ["PC の作業を、", "そのままスマホで。"], en: "THE SAME WORK, ON YOUR PHONE.", size: "md", center: false })
 * - lines は 1〜2 行。1 行は 12 文字前後までが読みやすい。
 * - en は小さな英語の添え書き（任意）。日本語だけの動画なら省いてよい。
 */
export function caption(id, { no, tag, lines, en, size = "", center = false }) {
	const meta = no ? `<div class="cap-meta"><span class="no">${no}</span><i class="bar"></i><span>${tag ?? ""}</span></div>` : "";
	const node = el(`
<div class="cap ${center ? "center" : ""}" id="${id}">
	${meta}
	<h2 class="cap-h ${size}">${lines.map((l) => `<span class="ln">${l}</span>`).join("")}</h2>
	${en ? `<div class="cap-en">${en}</div>` : ""}
</div>`);
	$("#world").appendChild(node);
	caps[id] = { node, no, lines: maskLines(node), meta: $(".cap-meta", node), bar: $(".cap-meta .bar", node), en: $(".cap-en", node) };
	return node;
}
export const captionParts = (id) => caps[id];

/** 見出しを出す。行は下から順に、英語の行は少し遅れて出る。x, y は左上の位置。 */
export function capIn(id, at, { x, y } = {}) {
	const c = caps[id];
	if (x !== undefined) set(c.node, { x });
	if (y !== undefined) set(c.node, { y });
	tl.show(c.node, at);
	if (c.meta) {
		set(c.meta, { opacity: 0, x: -14 });
		set(c.bar, { scaleX: 0 });
		tl.to(c.meta, { opacity: 1, x: 0, duration: 0.5, ease: "out3" }, at);
		tl.to(c.bar, { scaleX: 1, duration: 0.6, ease: "out3" }, at + 0.1);
	}
	set(c.lines, { yPercent: 112 });
	tl.to(c.lines, { yPercent: 0, duration: 0.85, ease: "swift", stagger: 0.1 }, at + 0.08);
	if (c.en) {
		set(c.en, { opacity: 0, y: 12 });
		tl.to(c.en, { opacity: 1, y: 0, duration: 0.6, ease: "out3" }, at + 0.42);
	}
	if (c.no) chapter(Number(c.no), at);
}

export function capOut(id, at, { dur = 0.4 } = {}) {
	const c = caps[id];
	tl.to(c.lines, { yPercent: -112, duration: dur, ease: "in3", stagger: 0.04 }, at);
	tl.to([c.meta, c.en].filter(Boolean), { opacity: 0, duration: dur * 0.8, ease: "in2" }, at);
	tl.hide(c.node, at + dur + 0.1);
}

/** 右端に、章の数だけマスを並べる（今どこかを示す）。使わないなら呼ばなくてよい。 */
export function chapters(count, { showAt, hideAt } = {}) {
	$("#over").insertAdjacentHTML("beforeend", `<div id="chapters">${"<i></i>".repeat(count)}</div>`);
	if (showAt !== undefined) tl.to("#chapters", { opacity: 1, duration: 0.5 }, showAt);
	if (hideAt !== undefined) tl.to("#chapters", { opacity: 0, duration: 0.3 }, hideAt);
}
function chapter(n, at) {
	$$("#chapters i").forEach((c, i) => {
		const on = i === n - 1;
		tl.to(c, { opacity: on ? 1 : i < n - 1 ? 0.42 : 0.16, backgroundColor: on ? `var(--c${(i % 3) + 1})` : "var(--ink)", scale: on ? 1.25 : 1, duration: 0.35, ease: "out2" }, at);
	});
}

/* ---------------- マスの波（場面の切り替え） ---------------- */

const COLS = 16;
const ROWS = 9;
const wipes = [];

/**
 * at から dur 秒で、origin のマスから波のように color で画面を覆う。覆い終えた瞬間（at + dur）に消えるので、
 * その時刻に舞台の色を color に切り替え、前の場面の部品を隠す。色が同じなので継ぎ目は見えない。
 */
export function wipe(at, { dur = 0.55, color, origin = [8, 4], seed = 1, accents = [brand.dark.c1, brand.dark.c2, brand.dark.c3] } = {}) {
	const r = rng(seed);
	const marks = Array.from({ length: COLS * ROWS }, () => (r() < 0.16 ? Math.floor(r() * 3) : -1));
	const far = Math.max(...[0, COLS - 1].flatMap((c) => [0, ROWS - 1].map((w) => Math.hypot(c - origin[0], w - origin[1]))));
	wipes.push({ at, dur, color, origin, marks, far, accents });
	cue("wipe", at, { dur });
}

const rgb = (c) => {
	if (c[0] === "#") {
		const n = Number.parseInt(c.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	}
	return c.match(/[\d.]+/g).slice(0, 3).map(Number);
};
const mixRgb = (a, b, p) => {
	const x = rgb(a);
	const y = rgb(b);
	return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(",")})`;
};

function drawWipes(t) {
	const box = $("#wipe");
	const w = wipes.find((x) => t >= x.at && t < x.at + x.dur);
	if (!w) {
		if (box.style.display !== "none") box.style.display = "none";
		return;
	}
	box.style.display = "block";
	const cells = box.children;
	const cellDur = w.dur * 0.42;
	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const i = row * COLS + col;
			const d = Math.hypot(col - w.origin[0], row - w.origin[1]) / w.far;
			const acc = w.marks[i];
			const start = w.at + d * (w.dur - cellDur) - (acc >= 0 ? 0.07 : 0);
			const node = cells[i];
			node.style.transform = `scale(${ease.out3(prog(t, start, start + cellDur)) * 1.02})`;
			node.style.background = acc >= 0 ? mixRgb(w.accents[acc], w.color, prog(t, w.at + w.dur - 0.16, w.at + w.dur - 0.03)) : w.color;
		}
	}
}

/* ---------------- 入れ物（スマホ・ブラウザ・ターミナル） ---------------- */

const statusbar = (time) => `
<div class="statusbar">
	<span class="time">${time}</span>
	<span class="sys">
		<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
		<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zM8 9.4c.5 0 .9.2 1.2.5L8 11.6 6.8 9.9c.3-.3.7-.5 1.2-.5z"/></svg>
		<svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke="currentColor" opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity="0.4"/></svg>
	</span>
</div>`;

/** スマホを置く。screens は中に重ねる画面（.screen）の HTML。返り値の screen が画面の根（タップの基準）。 */
export function phone(id, screens, { time = "9:41" } = {}) {
	const node = el(`
<div class="phone" id="${id}">
	<div class="phone-body"></div>
	<div class="phone-screen">${screens}${statusbar(time)}</div>
	<i class="phone-cam"></i>
</div>`);
	$("#world").appendChild(node);
	return { node, screen: $(".phone-screen", node), w: 414, h: 868 };
}

/** ブラウザのウィンドウを置く。view は中身の HTML。 */
export function browser(id, view, { url = "", w = 1100, h = 688 } = {}) {
	const node = el(`
<div class="browser" id="${id}" style="width:${w}px;height:${h}px">
	<div class="browser-bar"><i></i><i></i><i></i><span class="browser-url">${url}</span></div>
	<div class="browser-view">${view}</div>
</div>`);
	$("#world").appendChild(node);
	return { node, screen: $(".browser-view", node), w, h };
}

/** ターミナルを置く。body は中身の HTML（下ぞろえ。上にあふれた行は薄く消える）。 */
export function terminal(id, body, { title = "", w = 900, h = 540 } = {}) {
	const node = el(`
<div class="term" id="${id}" style="width:${w}px;height:${h}px">
	<div class="term-bar"><i></i><i></i><i></i><span class="term-title">${title}</span></div>
	<div class="term-body">${body}</div>
</div>`);
	$("#world").appendChild(node);
	return { node, screen: $(".term-body", node), w, h };
}

/** 入れ物の中心 (cx, cy) と倍率 s から、set / tl.to に渡す位置を作る。 pose(phone, 1500, 540, 1.1) */
export const pose = (device, cx, cy, s = 1) => ({ x: cx - (device.w / 2) * s, y: cy - (device.h / 2) * s, scale: s });

/* ---------------- 指とマウス ---------------- */

/** target の中央を指でタップする印を出す。位置はその時刻の配置から求めるので、行が動いた後でも合う。 */
export function tap(device, target, at, { dx = 0, dy = 0, press = true, sound = true } = {}) {
	const root = device.screen;
	const dot = el('<div class="touch"><i></i><b></b></div>');
	root.appendChild(dot);
	const a = at - 0.24;
	onFrame((t) => {
		if (t < a - 0.05 || t > at + 0.6) return;
		const r = rectIn(target, root);
		dot.style.left = `${r.x + r.w / 2 + dx}px`;
		dot.style.top = `${r.y + r.h / 2 + dy}px`;
	});
	tl.fromTo(dot, { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 1, duration: 0.2, ease: "out2" }, a);
	tl.to(dot, { scale: 0.8, duration: 0.07, ease: "in2" }, at - 0.03);
	tl.to(dot, { scale: 1, duration: 0.2, ease: "out2" }, at + 0.05);
	tl.to(dot, { opacity: 0, duration: 0.2, ease: "in2" }, at + 0.24);
	tl.fromTo($("b", dot), { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 2.3, duration: 0.5, ease: "out2" }, at);
	if (press) {
		tl.to(target, { scale: 0.965, duration: 0.08, ease: "out2" }, at);
		tl.to(target, { scale: 1, duration: 0.28, ease: "out2" }, at + 0.09);
	}
	if (sound) cue("tap", at);
}

/**
 * マウスカーソル。ブラウザやデスクトップアプリの操作を見せるときに使う。
 * const mouse = pointer(win);  mouse.show(8, [600, 400]);  mouse.click(btn, 9.2);  mouse.move(field, 10);  mouse.hide(12);
 * 位置はその時刻の配置から求める。click は「0.5 秒かけて移動 → at で押す」。
 */
export function pointer(device) {
	const root = device.screen;
	const node = el('<div class="cursor"><b></b><svg viewBox="0 0 26 26"><path d="M3 2l7.2 19 2.6-7.4 7.4-2.6z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg></div>');
	root.appendChild(node);
	const stops = []; // { at（到着時刻）, dur, target | point, dx, dy }
	const where = (s) => {
		if (s.point) return s.point;
		const r = rectIn(s.target, root);
		return [r.x + r.w / 2 + (s.dx ?? 0), r.y + r.h / 2 + (s.dy ?? 0)];
	};
	onFrame((t) => {
		if (!stops.length) return;
		let i = stops.findIndex((s) => t < s.at);
		if (i < 0) i = stops.length;
		const prev = stops[Math.max(0, i - 1)];
		const next = stops[Math.min(stops.length - 1, i)];
		const a = where(prev);
		const b = where(next);
		const p = i === 0 || i === stops.length ? 1 : ease.inOut3(prog(t, next.at - next.dur, next.at));
		node.style.left = `${a[0] + (b[0] - a[0]) * p}px`;
		node.style.top = `${a[1] + (b[1] - a[1]) * p}px`;
	});
	const api = {
		node,
		/** at にカーソルを出す。point は最初の位置 [x, y]（入れ物の中の座標）。 */
		show(at, point) {
			stops.push({ at, dur: 0, point });
			tl.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.25 }, at);
			return api;
		},
		/** at に target（要素か [x, y]）へ着くように動かす。 */
		move(target, at, { dur = 0.6, dx, dy } = {}) {
			stops.push(Array.isArray(target) ? { at, dur, point: target } : { at, dur, target, dx, dy });
			stops.sort((x, y) => x.at - y.at);
			return api;
		},
		/** target へ動いて、at に押す。 */
		click(target, at, opts = {}) {
			api.move(target, at, opts);
			tl.to(node, { scale: 0.86, duration: 0.07, ease: "in2" }, at - 0.02);
			tl.to(node, { scale: 1, duration: 0.2, ease: "out2" }, at + 0.06);
			tl.fromTo($("b", node), { opacity: 0.9, scale: 0.4 }, { opacity: 0, scale: 1.5, duration: 0.45, ease: "out2" }, at);
			if (target instanceof Element && opts.press !== false) {
				tl.to(target, { scale: 0.97, duration: 0.08, ease: "out2" }, at);
				tl.to(target, { scale: 1, duration: 0.26, ease: "out2" }, at + 0.09);
			}
			if (opts.sound !== false) cue("click", at);
			return api;
		},
		hide(at) {
			tl.to(node, { opacity: 0, duration: 0.25 }, at);
			return api;
		},
	};
	return api;
}

/* ---------------- つながりの線 ---------------- */

/**
 * 2 つの入れ物を点線で結び、小さなマスを流す（「同じものが両方に届く」を見せる）。
 * const link = connector("link");  link.shape(1040, 790, 1260, 540);  link.draw(14.5);  link.packet(18.8, { color: 1 });
 */
export function connector(id) {
	const node = el(`<svg class="link" id="${id}"><defs><mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080"><path class="link-mask" stroke="#fff" stroke-width="14" fill="none"/></mask></defs><g mask="url(#${id}-m)"><path class="link-line"/></g>${'<rect width="14" height="14"/>'.repeat(6)}</svg>`);
	$("#world").prepend(node);
	const line = $(".link-line", node);
	const mask = $(".link-mask", node);
	const pool = $$("rect", node);
	const packets = [];
	let len = 0;
	onFrame((t) => {
		let used = 0;
		for (const p of packets) {
			if (t < p.at || t > p.at + p.dur || used >= pool.length) continue;
			const u = ease.inOut3((t - p.at) / p.dur);
			const pt = line.getPointAtLength(len * (p.dir > 0 ? u : 1 - u));
			const r = pool[used++];
			r.setAttribute("x", pt.x - 7);
			r.setAttribute("y", pt.y - 7);
			r.setAttribute("fill", `var(--c${(p.color % 3) + 1})`);
			r.style.opacity = clamp01(Math.min(1, (t - p.at) / 0.06, (p.at + p.dur - t) / 0.08));
		}
		for (let i = used; i < pool.length; i++) pool[i].style.opacity = 0;
	});
	return {
		node,
		line,
		/** 線の形を決める（x1,y1 が出発側）。 */
		shape(x1, y1, x2, y2) {
			const dx = (x2 - x1) * 0.5;
			const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
			line.setAttribute("d", d);
			mask.setAttribute("d", d);
			len = line.getTotalLength();
			mask.style.strokeDasharray = `${len} ${len}`;
			return len;
		},
		/** 線を出発側から描く（out: true で消す）。 */
		draw(at, { dur = 0.7, out = false } = {}) {
			tl.show(node, at);
			tl.fromTo(mask, { strokeDashoffset: out ? 0 : len }, { strokeDashoffset: out ? -len : 0, duration: dur, ease: "inOut2" }, at);
			if (out) tl.hide(node, at + dur);
		},
		/** 線の上をマスが流れる。dir: 1 は出発側→到着側、-1 は逆。 */
		packet(at, { dir = 1, color = 0, dur = 0.42 } = {}) {
			packets.push({ at, dir, color, dur });
		},
		midpoint: () => line.getPointAtLength(len / 2),
	};
}

/* ---------------- 通知 ---------------- */

/** スマホの通知を置く。 notification("n1", { title: "…", body: "…" }) → tl.fromTo("#n1", { y: -240 }, { y: 40, … }, at) で落とす。 */
export function notification(id, { app = brand.name, title, body = "", when = "今" }) {
	const node = el(`<div class="notif" id="${id}"><div class="notif-hd"><span class="notif-ic">${brand.logo.mono ?? ""}</span><span>${app}</span><span>·</span><span>${when}</span></div><div class="notif-t">${title}</div>${body ? `<div class="notif-b">${body}</div>` : ""}</div>`);
	$("#world").appendChild(node);
	return node;
}

/* ---------------- タイル ---------------- */

/**
 * 機能をまとめて見せるタイルの格子。
 * tiles("t", { cols: 4, w: 400, h: 296, items: [{ title: "通知", tag: "NOTIFICATIONS", body: "<div …>", foot: "ひとこと" }] })
 * 1 枚に 1 つのことだけを入れる。中身は小さな画面の断片（実物の 1.3 倍くらいの大きさ）にすると読める。
 */
export function tiles(id, { cols = 4, w = 400, h = 296, x, y, items }) {
	const width = cols * w + (cols - 1) * 24;
	const node = el(`<div class="tiles" id="${id}" style="grid-template-columns:repeat(${cols},${w}px)">${items.map((it) => `<div class="tile" style="height:${h}px"><div class="tile-h"><b>${it.title}</b><span>${it.tag ?? ""}</span></div><div class="tile-b">${it.body ?? ""}</div>${it.foot ? `<div class="tile-f">${it.foot}</div>` : ""}</div>`).join("")}</div>`);
	$("#world").appendChild(node);
	set(node, { x: x ?? (W - width) / 2, y: y ?? 356 });
	return { node, items: $$(".tile", node) };
}

/** タイルを 1 枚ずつ、拍に合わせて弾むように出す。step は 1 枚ごとの間隔（秒）。 */
export function tilesIn(grid, at, step = 0.5) {
	tl.show(grid.node, at);
	grid.items.forEach((tile, i) => {
		tl.in(tile, { y: 46, scale: 0.9 }, at + i * step, { duration: 0.6, ease: "back(1.6)" });
		cue("pop", at + i * step, { i });
	});
	return (i) => at + i * step;
}
export function tilesOut(grid, at) {
	tl.to(grid.items, { autoAlpha: 0, y: -34, scale: 0.96, duration: 0.34, ease: "in2", stagger: 0.035 }, at);
	tl.hide(grid.node, at + 0.7);
}

/* ---------------- ロゴ ---------------- */

const MARK_H = 400;
const logo = {};

/** ロゴ（マークと名前）とひとことを置く。ほかの部品より手前（#over）に置かれる。 */
export function mountLogo() {
	const mw = MARK_H * brand.logo.ratio;
	$("#over").insertAdjacentHTML(
		"beforeend",
		`<div id="logo"><div id="sparks">${'<i class="spark"></i>'.repeat(16)}</div>
<div id="logo-mark" style="width:${mw}px;height:${MARK_H}px">${brand.logo.svg}</div>
<div id="logo-word"><span>${brand.name}</span></div>
<div id="logo-tag"><div class="jp">${brand.tagline.main}</div>${brand.tagline.sub ? `<div class="en">${brand.tagline.sub}</div>` : ""}</div>
<div id="end-url">${brand.url ?? ""}</div>
<div id="end-meta">${(brand.meta ?? []).map((m) => `<span>${m}</span>`).join("")}</div></div>
<div id="fine">${brand.fine ?? ""}</div>`,
	);
	useText(brand.name);
	const word = $("#logo-word");
	const s = 0.62;
	const gap = 54;
	const total = mw * s + gap + word.offsetWidth;
	const left = (W - total) / 2;
	Object.assign(logo, {
		mw,
		// 中央に大きく（組み上がるとき）
		big: (cx, cy) => ({ x: cx - mw / 2, y: cy - MARK_H / 2, scale: 1 }),
		// マークと名前を横に並べた形
		mark: (cy) => ({ x: left + (mw * s) / 2 - mw / 2, y: cy - MARK_H / 2, scale: s }),
		word: (cy) => ({ x: left + mw * s + gap, y: cy - 100, scale: 1 }),
		// 左上に小さく
		bugMark: { x: 64 + (36 * brand.logo.ratio) / 2 - mw / 2, y: 52 + 18 - MARK_H / 2, scale: 36 / MARK_H },
		bugWord: { x: 64 + 36 * brand.logo.ratio + 14, y: 57, scale: 0.13 },
	});
	set("#sparks .spark", {});
	$$("#sparks .spark").forEach((sp, i) => {
		sp.style.background = `var(--c${(i % 3) + 1})`;
	});
}

/** 小さなマスが中心から散る（ロゴがはまった瞬間などに）。 */
export function sparks(at, cx, cy, { seed = 11, reach = 1 } = {}) {
	const r = rng(seed);
	$$("#sparks .spark").forEach((s, i) => {
		const a = (i / 16) * Math.PI * 2 + r() * 0.3;
		const d = (300 + r() * 260) * reach;
		tl.fromTo(s, { x: cx - 7 + Math.cos(a) * 120 * reach, y: cy - 7 + Math.sin(a) * 110 * reach, opacity: 1, scale: 1.4, rotate: 0 }, { x: cx - 7 + Math.cos(a) * d, y: cy - 7 + Math.sin(a) * d * 0.8, opacity: 0, scale: 0.3, rotate: 200 * (i % 2 ? 1 : -1), duration: 0.8 + r() * 0.3, ease: "out3" }, at);
	});
}

/**
 * ロゴの登場。at がちょうど拍の頭になるようにする。
 *  - brand.logo.assemble が true なら、SVG の直下の要素が 1 つずつ飛んできて 16 分音符ごとにはまる
 *  - そうでなければ、マーク全体が弾むように現れる
 * 返り値は、最後の部品がはまる時刻。
 */
export function logoReveal(at, { cx = 960, cy = 440, step = 0.125 } = {}) {
	const m = $("#logo-mark");
	set(m, logo.big(cx, cy));
	const pieces = brand.logo.assemble ? [...$("svg", m).children].filter((n) => n.tagName !== "defs") : [];
	let last = at;
	if (pieces.length > 1) {
		tl.show(m, at - 0.6);
		pieces.forEach((node, i) => {
			const a = (i / pieces.length) * Math.PI * 2 + 2.6;
			const land = at + i * step;
			last = land;
			set(node, { opacity: 0 });
			tl.fromTo(node, { x: Math.cos(a) * 820, y: Math.sin(a) * 700, rotate: (i % 2 ? 1 : -1) * (60 + i * 30) }, { x: 0, y: 0, rotate: 0, duration: 0.52, ease: "in3" }, land - 0.52);
			tl.to(node, { opacity: 1, duration: 0.12, ease: "none" }, land - 0.52);
			tl.fromTo(m, { scale: 1.05 }, { scale: 1, duration: 0.24, ease: "out2" }, land);
			cue("logoHit", land, { i, n: pieces.length });
		});
	} else {
		tl.in(m, { scale: 0.3, rotate: -14 }, at - 0.18, { duration: 0.7, ease: "back(2)" });
		cue("logoHit", at, { i: 0, n: 1 });
	}
	sparks(last, cx, cy);
	return last;
}

/** マークが左に寄り、名前がマークの陰から出てくる。 */
export function logoLockup(at, { cy = 440 } = {}) {
	const m = $("#logo-mark");
	const word = $("#logo-word");
	set(word, logo.word(cy));
	tl.to(m, { ...logo.mark(cy), duration: 0.85, ease: "glide" }, at);
	tl.show(word, at + 0.12);
	tl.fromTo($("span", word), { xPercent: -104 }, { xPercent: 0, duration: 0.85, ease: "swift" }, at + 0.12);
	// 名前は、動いているマークの右端より右だけを見せる
	onFrame((t) => {
		if (t < at || t > at + 1.2) {
			if (word.style.clipPath) word.style.clipPath = "";
			return;
		}
		const right = get(m, "x") + logo.mw / 2 + (logo.mw / 2) * get(m, "scale");
		word.style.clipPath = `inset(0px 0px 0px ${Math.max(0, right + 16 - get(word, "x")).toFixed(2)}px)`;
	});
	cue("swell", at);
}

/** ひとこと（brand.tagline）を出す／消す。 */
export function taglineIn(at, { y = 640 } = {}) {
	const tag = $("#logo-tag");
	set(tag, { y });
	tl.show(tag, at);
	tl.in($$("#logo-tag > *"), { y: 24 }, at, { duration: 0.7, ease: "swift", stagger: 0.3 });
	cue("tag", at);
}
export function taglineOut(at) {
	tl.to("#logo-tag", { autoAlpha: 0, duration: 0.4, ease: "in2" }, at);
}

/** ロゴが左上に小さく収まる（本編のあいだ残す）。 */
export function logoToCorner(at) {
	tl.to("#logo-mark", { ...logo.bugMark, duration: 0.9, ease: "glide" }, at);
	tl.to("#logo-word", { ...logo.bugWord, duration: 0.9, ease: "glide" }, at);
	cue("whoosh", at);
}

/**
 * 最後のカード。左上のロゴが中央へ戻り、at ではまる。続けてひとこと・URL・補足が出る。
 * at は拍の頭にする（音の一撃と合う）。
 */
export function endCard(at, { cy = 370 } = {}) {
	tl.to("#logo-mark", { ...logo.mark(cy), duration: 0.62, ease: "in3" }, at - 0.62);
	tl.to("#logo-word", { ...logo.word(cy), duration: 0.62, ease: "in3" }, at - 0.62);
	tl.fromTo("#logo-mark", { scale: 0.62 * 1.09 }, { scale: 0.62, duration: 0.5, ease: "out2" }, at);
	sparks(at, 960, cy, { seed: 5, reach: 1.5 });
	const tag = $("#logo-tag");
	// ひとことは 2 度めの登場。いったん中身を消してから、もう一度出す
	tl.set($$("#logo-tag > *"), { autoAlpha: 0 }, at + 0.4);
	tl.set(tag, { y: cy + 196, autoAlpha: 1 }, at + 0.45);
	tl.fromTo($$("#logo-tag > *"), { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: "swift", stagger: 0.3 }, at + 0.5);
	set("#end-url", { y: cy + 402 });
	tl.in("#end-url", { y: 20 }, at + 1.5, { duration: 0.6 });
	set("#end-meta", { y: cy + 488 });
	tl.show("#end-meta", at + 1.9);
	set("#end-meta span", { opacity: 0, y: 14 });
	tl.to("#end-meta span", { opacity: 1, y: 0, duration: 0.45, stagger: 0.08 }, at + 1.9);
	tl.to("#fine", { opacity: 1, duration: 0.6 }, at + 2.4);
	cue("tag", at + 0.5);
}
