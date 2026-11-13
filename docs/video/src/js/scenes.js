// 全シーンの動き。時刻は秒、120 BPM（1 拍 0.5 秒・1 小節 2 秒）に合わせてある。
// 構成（場面の順番と時間割）は cues.js の先頭の表にある。場面の中の時刻は、場面の頭（t0）からの秒数で書く。
import { cue, T } from "./cues.js";
import { $, $$, closeNow, closeRow, ease, el, growIn, gsap, label, mmss, onFrame, openRow, prog, rng, tl, toggle, typed } from "./engine.js";
import { capIn, capOut, extraText, flash, linkDraw, linkShape, mount, packet, parts, pose, status, tap, theme, toolMark, W, wipe } from "./stage.js";
import { stage as SP } from "./tokens.js";

export { extraText, mount };

const show = (sel, at) => tl.set(sel, { autoAlpha: 1 }, at);
const hide = (sel, at) => tl.set(sel, { autoAlpha: 0 }, at);
/** immediateRender なしの fromTo（同じ部品を後のシーンで動かし直すため）。 */
const ft = (sel, from, to, at) => tl.fromTo(sel, from, { ...to, immediateRender: false }, at);

const TERM = { x: 128, y: 492 };
const CAP_TOP = 116;
const PH_SIDE = pose(1500, 540, 1.1);
// Grok Bot の場面: 左に会話、右に PC のターミナル
const G_CHAT = { x: 128, y: 318, w: 520 };
const G_TERM = { x: 900, y: 398 };

let phone;
let term;

export function build() {
	phone = $("#phone");
	term = $("#term");
	init();
	hook();
	logo();
	connect();
	launch();
	sync();
	resilient();
	grok();
	toolkit();
	setup();
	end();
	tl.set({}, {}, T.total);
	return T.total;
}

function init() {
	gsap.set(["#phone", "#link", "#link-x", ".cap", "#tiles", ".step", "#logo-mark", "#logo-word", "#logo-tag", "#end-url", "#end-meta", "#gchat", ".gpill"], { autoAlpha: 0 });
	gsap.set(["#newpi", "#chatB", "#scrim", "#drawer", "#tvShell", "#tvB", "#tvG"], { autoAlpha: 0 });
	gsap.set(".tool .mk .spin", { autoAlpha: 0 });
	term.insertAdjacentHTML("beforeend", '<i id="term-dim" style="position:absolute;inset:0;background:#04070d;opacity:0;pointer-events:none"></i>');
	gsap.set("#chapters", { opacity: 0 });

	// 入力欄の輪（コンテキストの使用量）。値は例。
	const C = 2 * Math.PI * 10.5;
	for (const k of ["A", "B"]) $(`#g1${k}`).setAttribute("stroke-dasharray", `${(C * 0.41).toFixed(1)} ${C.toFixed(1)}`);
}

/* ================= 導入 1：Pi が待っている ================= */

function hook() {
	const S = 1.24;
	gsap.set(term, { x: (W - 900 * S) / 2, y: 56, scale: S, autoAlpha: 1 });
	ft("#blackout", { opacity: 1 }, { opacity: 0, duration: 0.9, ease: "power2.out" }, 0);
	gsap.set("#blackout", { opacity: 1 });

	// PC の Pi が調べて、質問を出す
	growIn($("#ta-1"), 0.35, { dur: 0.25 });
	growIn($("#ta-2"), 0.6, { dur: 0.25 });
	growIn($("#ta-3"), 0.85, { dur: 0.25 });
	growIn($("#ta-x"), 1.15, { dur: 0.28 });
	for (const t of [0.35, 0.6, 0.85, 1.15]) cue("row", t);
	closeRow($("#ta-work"), 1.5, { dur: 0.22 });
	growIn($("#ta-ask"), 1.55, { dur: 0.4 });
	cue("ask", 1.6);
	for (const id of ["ta-ans", "ta-4", "ta-5", "ta-6", "ta-7"]) closeNow($(`#${id}`));

	// 待ち時間が流れていく
	const waited = (t) => {
		if (t < 1.55) return 0;
		if (t < 2.2) return t - 1.55;
		if (t < 3.35) return 0.65 + (2832 - 0.65) * ease.inOut3(prog(t, 2.2, 3.35));
		return 2832 + (t - 3.35);
	};
	label($("#ta-wait"), (t) => `入力待ち ${mmss(waited(t))}`);
	cue("timelapse", 2.2, { dur: 1.15 });
	tl.to("#vignette", { opacity: 1, duration: 1.15, ease: "sine.inOut" }, 2.2);
	tl.to("#term-dim", { opacity: 0.42, duration: 1.15, ease: "sine.inOut" }, 2.2);

	// 見出し
	const c = parts("c1");
	gsap.set("#c1", { y: 770 });
	show("#c1", 1.75);
	tl.fromTo(c.lines[0], { yPercent: 112 }, { yPercent: 0, duration: 0.8, ease: "swift" }, 1.8);
	tl.fromTo(c.en, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 }, 2.3);

	// 紙の色のマスで覆って、次へ
	wipe(T.logo - 0.55, { dur: 0.55, color: SP.light.paper, origin: [8, 0], seed: 7 });
	tl.set(theme, { stage: 0 }, T.logo);
	hide([term, "#c1"], T.logo);
	tl.set("#vignette", { opacity: 0 }, T.logo);
	tl.set("#term-dim", { opacity: 0 }, T.logo);
}

/* ================= 導入 2：ロゴ ================= */

const lockup = {};

function logo() {
	const t0 = T.logo;
	const m = $("#logo-mark");
	const word = $("#logo-word");
	const tag = $("#logo-tag");
	const cx = 960;
	const cy = 440;
	gsap.set(m, { x: cx - 230, y: cy - 204, scale: 1, transformOrigin: "50% 50%" });
	show(m, t0 - 0.6);
	// 暗い場面の上を飛んでくる間も、紙の上の色で描く
	toggle(m, "paper", [0, t0 + 0.02]);

	// 5 つの形が 16 分音符ごとにはまる
	const pieces = {
		blue1: { x: -820, y: 160, r: -55 },
		blue2: { x: -120, y: 760, r: 130 },
		coral: { x: 380, y: -760, r: 70 },
		yellow1: { x: 900, y: -140, r: 210 },
		yellow2: { x: 760, y: 620, r: -100 },
	};
	Object.entries(pieces).forEach(([k, p], i) => {
		const node = $(`[data-p="${k}"]`, m);
		const land = t0 + i * 0.125;
		tl.fromTo(node, { x: p.x, y: p.y, rotation: p.r, transformOrigin: "50% 50%" }, { x: 0, y: 0, rotation: 0, duration: 0.52, ease: "power3.in" }, land - 0.52);
		tl.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, land - 0.52);
		ft(m, { scale: 1.05 }, { scale: 1, duration: 0.24, ease: "power2.out" }, land);
		cue("logoHit", land, { i });
	});

	// はまった瞬間に小さなマスが散る
	const r = rng(11);
	$$("#sparks .spark").forEach((s, i) => {
		const a = (i / 16) * Math.PI * 2 + r() * 0.3;
		const d = 300 + r() * 260;
		gsap.set(s, { backgroundColor: ["var(--blue)", "var(--coral)", "var(--yellow)"][i % 3] });
		ft(s, { x: cx - 7 + Math.cos(a) * 120, y: cy - 7 + Math.sin(a) * 110, opacity: 1, scale: 1.4, rotation: 0 }, { x: cx - 7 + Math.cos(a) * d, y: cy - 7 + Math.sin(a) * d * 0.8, opacity: 0, scale: 0.3, rotation: 200 * (i % 2 ? 1 : -1), duration: 0.8 + r() * 0.3, ease: "power3.out" }, t0 + 0.5);
	});

	// マークが左に寄り、名前が出る
	const s = 0.62;
	const mw = 460 * s;
	const gap = 54;
	const total = mw + gap + word.offsetWidth;
	const left = (W - total) / 2;
	const lock = t0 + 0.7;
	lockup.mark = { x: left + mw / 2 - 230, y: cy - 204, scale: s };
	lockup.word = { x: left + mw + gap, y: cy - 100, scale: 1 };
	gsap.set(word, lockup.word);
	tl.to(m, { ...lockup.mark, duration: 0.75, ease: "glide" }, lock);
	show(word, lock + 0.1);
	tl.fromTo($("span", word), { xPercent: -104 }, { xPercent: 0, duration: 0.75, ease: "swift" }, lock + 0.1);
	cue("swell", lock);
	// 名前は、動いているマークの右端より右だけを見せる（マークの陰から出てくる）
	onFrame((t) => {
		if (t < lock || t > lock + 1.1) {
			if (word.style.clipPath) word.style.clipPath = "";
			return;
		}
		const right = gsap.getProperty(m, "x") + 230 + 230 * gsap.getProperty(m, "scaleX");
		const cut = Math.max(0, right + 16 - gsap.getProperty(word, "x"));
		word.style.clipPath = `inset(0px 0px 0px ${cut.toFixed(2)}px)`;
	});

	// ひとこと
	gsap.set(tag, { y: 640 });
	show(tag, t0 + 1.15);
	tl.fromTo($(".jp", tag), { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.7, ease: "swift" }, t0 + 1.15);
	tl.fromTo($(".en", tag), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, t0 + 1.45);
	cue("tag", t0 + 1.15);

	// 左上に小さく収まり、最後まで残る
	tl.to(tag, { opacity: 0, y: 620, duration: 0.35, ease: "power2.in" }, t0 + 2.9);
	hide(tag, t0 + 3.3);
	lockup.bugMark = { x: 64 + 20 - 230, y: 52 + 18 - 204, scale: 40 / 460 };
	lockup.bugWord = { x: 118, y: 57, scale: 0.13 };
	tl.to(m, { ...lockup.bugMark, duration: 0.8, ease: "glide" }, t0 + 3.0);
	tl.to(word, { ...lockup.bugWord, duration: 0.8, ease: "glide" }, t0 + 3.0);
	cue("whoosh", t0 + 3.0);
	ft("#bg-grid", { opacity: 0 }, { opacity: 0.55, duration: 1.2, ease: "power1.out" }, t0);
	ft("#bg-glow", { opacity: 0 }, { opacity: 1, duration: 1.5, ease: "power1.out" }, t0);
	gsap.set(["#bg-grid", "#bg-glow"], { opacity: 0 });
}

/* ================= 01. PC の Pi につながる ================= */

function connect() {
	const t0 = T.connect;
	const answered = t0 + 3.38;

	// スマホの入力欄と会話の、最初の状態
	const phA = $("#phA");
	const caretA = $("#caretA");
	caretA.dataset.solid = "1";
	caretA.style.opacity = 0;
	onFrame((t) => {
		const ph = t < answered ? "上の質問に回答すると入力できます" : "Pi にメッセージ";
		if (phA.textContent !== ph) phA.textContent = ph;
	});
	gsap.set("#stopA", { autoAlpha: 0 });
	closeNow($("#queuedA"));
	for (const id of ["a-ask", "a-t1", "a-t2", "a-t3", "a-t4", "a-steer", "a-t5", "a-t6", "a-out", "a-meta"]) closeNow($(`#${id}`));
	gsap.set("#a-ans", { display: "none" });
	gsap.set("#qA1 .radio", { "--on": 0 });
	status("A", "wait", 0);
	label($("#stA [data-tm]"), (t) => mmss(t - answered));

	// 登場
	ft(term, { x: -980, y: TERM.y, scale: 1, autoAlpha: 1 }, { x: TERM.x, duration: 0.95, ease: "swift" }, t0 - 0.65);
	gsap.set(phone, PH_SIDE);
	ft(phone, { y: PH_SIDE.y + 300, autoAlpha: 0 }, { y: PH_SIDE.y, autoAlpha: 1, duration: 0.95, ease: "swift" }, t0 - 0.5);
	cue("whoosh", t0 - 0.65);
	tl.to("#chapters", { opacity: 1, duration: 0.5 }, t0);
	capIn("c2", t0, { y: CAP_TOP });

	linkShape(TERM.x + 900 + 10, TERM.y + 300, PH_SIDE.x - 10, 540);
	linkDraw(t0 + 0.5);

	// PC の Pi の質問が、スマホにも出ている
	[0, 1, 2].forEach((i) => packet(t0 + 1.0 + i * 0.11, { color: i, dur: 0.5, sound: i === 0 }));
	tl.to("#ta-ask", { scale: 1.02, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut", transformOrigin: "50% 50%" }, t0 + 1.0);
	tl.to("#qA", { scale: 1.02, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut" }, t0 + 1.45);

	// スマホで答える
	tap($("#qA1"), t0 + 2.4, { dx: -90, press: false });
	tl.to("#qA1 .radio", { "--on": 1, duration: 0.22, ease: "power2.out" }, t0 + 2.42);
	tap($("#qAgo"), t0 + 3.2);
	cue("answer", t0 + 3.22);
	closeRow($("#qA"), t0 + 3.35, { dur: 0.5 });
	openRow($("#a-ask"), t0 + 3.45);
	status("A", "work", answered);
	show("#stopA", answered);
	packet(t0 + 3.28, { dir: -1, color: 0, dur: 0.42 });
	packet(t0 + 3.36, { dir: -1, color: 2, dur: 0.42 });

	// PC の Pi が動き出し、同じ行がスマホにも流れる
	closeRow($("#ta-ask"), t0 + 3.7, { dur: 0.32 });
	openRow($("#ta-ans"), t0 + 3.8, { dur: 0.3 });
	openRow($("#ta-work"), t0 + 3.9, { dur: 0.3 });
	[
		[t0 + 4.3, "ta-4", "a-t1"],
		[t0 + 4.9, "ta-5", "a-t2"],
	].forEach(([t, a, b], i) => {
		openRow($(`#${a}`), t, { dur: 0.28 });
		flash($(`#${a}`), t, { color: "124,190,222", peak: 0.3 });
		packet(t + 0.02, { color: i, dur: 0.34 });
		openRow($(`#${b}`), t + 0.16, { dur: 0.36 });
		flash($(`#${b}`), t + 0.3);
		cue("row", t);
		cue("rowPhone", t + 0.2);
	});

	// 退場（スマホは残る）
	capOut("c2", t0 + 5.2);
	linkDraw(t0 + 5.3, { dur: 0.35, out: true });
	tl.to(term, { x: -980, duration: 0.6, ease: "power3.in" }, t0 + 5.35);
	hide(term, t0 + 6.0);
}

/* ================= 02. スマホから起動 ================= */

function launch() {
	const t0 = T.launch;
	capIn("c3", t0, { y: 318 });

	// 左端から一覧を引き出す
	const sw = el('<div class="touch"><i></i><b></b></div>');
	$("#pscreen").appendChild(sw);
	tl.fromTo(sw, { x: 16, y: 440, opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.18 }, t0 + 0.2);
	tl.to(sw, { x: 250, duration: 0.5, ease: "power2.inOut" }, t0 + 0.36);
	tl.to(sw, { opacity: 0, duration: 0.18 }, t0 + 0.82);
	ft("#drawer", { x: -330, autoAlpha: 1 }, { x: 0, duration: 0.56, ease: "swift" }, t0 + 0.38);
	ft("#scrim", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: "power2.out" }, t0 + 0.38);
	cue("whoosh", t0 + 0.36);
	const rows = $$("#drawer .dw-list > *");
	tl.fromTo(rows, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.42, ease: "power3.out", stagger: 0.04 }, t0 + 0.5);

	// 「新しい Pi」を開く
	tap($("#dw-new"), t0 + 1.7);
	ft("#newpi", { y: 844, autoAlpha: 1 }, { y: 0, duration: 0.58, ease: "swift" }, t0 + 1.92);
	cue("whoosh", t0 + 1.9);
	hide(["#drawer", "#scrim", "#chatA"], t0 + 2.52);

	// フォルダと最初のメッセージを入れて、起動
	const pick = t0 + 3.0;
	const typeAt = t0 + 3.6;
	const go = t0 + 5.3;
	const msg = "トップページを速くして";
	label($("#np-folder"), (t) => (t >= pick + 0.1 ? "~/work/site" : ""));
	label($("#np-msg"), (t) => typed(msg, t, typeAt, 9.5));
	const ph = $("#np-ph");
	const c1 = $("#np-caret1");
	const c2 = $("#np-caret2");
	c1.dataset.solid = "1";
	c2.dataset.solid = "1";
	onFrame((t) => {
		ph.style.visibility = t >= typeAt ? "hidden" : "visible";
		c1.style.opacity = t < typeAt - 0.2 && t % 1.06 < 0.6 ? 1 : 0;
		c2.style.opacity = t >= typeAt - 0.2 && (t < typeAt + 1.2 || t % 1.06 < 0.6) ? 1 : 0;
	});
	tap($("#np-r1"), pick, { dx: -110, press: false });
	cue("type", typeAt, { dur: 1.16, n: 11 });
	tap($("#np-go"), go);
	cue("launch", go + 0.05);

	// PC で新しい Pi が動き出す
	for (const id of ["b-u", "b-t1", "b-t2", "b-t3", "b-t4", "b-t4b", "b-t5", "b-t6", "b-t7", "b-t8"]) closeNow($(`#${id}`));
	closeNow($("#queuedB"));
	$("#inB").textContent = "";
	$("#caretB").dataset.solid = "1";
	$("#caretB").style.opacity = 0;
	status("B", "work", 0);
	label($("#stB [data-tm]"), (t) => mmss(t - (go + 0.3)));
	show("#chatB", go + 0.2);
	tl.to("#newpi", { autoAlpha: 0, scale: 0.96, duration: 0.36, ease: "power2.in" }, go + 0.2);
	openRow($("#b-u"), go + 0.4, { dur: 0.45 });
	openRow($("#b-t1"), go + 1.1, { dur: 0.34 });
	cue("rowPhone", go + 1.12);
	openRow($("#b-t2"), go + 1.8, { dur: 0.34 });
	cue("rowPhone", go + 1.82);
	toolMark("b-t2", "run", 0);
	label($("#b-t2 [data-st]"), (t) => `${Math.min(14, Math.max(0, Math.floor((t - (go + 1.8)) * 4)))}秒`);

	capOut("c3", T.sync - 0.75);
}

/* ================= 03. PC と同期 ================= */

function sync() {
	const t0 = T.sync;
	const cmd = "pimate attach pimate-4f2a91c0";
	const typeAt = t0 + 0.4;
	const enter = typeAt + 1.42;
	const attach = enter + 0.38;

	// PC のターミナルから、スマホで起動した Pi につなぐ
	hide("#tvA", t0 - 1.5);
	show("#tvShell", t0 - 1.5);
	label($("#term-title"), (t) => (t < t0 - 1.5 ? "pi — ~/work/web" : t < attach ? "dev-laptop — bash" : t < T.grok ? "pi — ~/work/site" : "pi — ~/work/reports"));
	label($("#sh-cmd"), (t) => typed(cmd, t, typeAt, 23));
	gsap.set("#sh-out", { autoAlpha: 0 });
	ft(term, { x: -980, y: TERM.y, scale: 1, autoAlpha: 1 }, { x: TERM.x, duration: 0.9, ease: "swift" }, t0 - 0.6);
	cue("whoosh", t0 - 0.6);
	capIn("c4", t0, { y: CAP_TOP });
	cue("type", typeAt, { dur: 1.3, n: 30, key: true });
	show("#sh-out", enter + 0.02);
	hide("#sh-caret", enter + 0.02);
	cue("enter", enter);
	hide("#tvShell", attach);
	ft("#tvB", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: "power2.out" }, attach);
	cue("attach", attach);
	for (const id of ["tb-3", "tb-4", "tb-4b", "tb-5", "tb-6", "tb-7", "tb-8"]) closeNow($(`#${id}`));
	$("#tb-2").classList.add("run");
	toggle($("#tb-2"), "run", [0, attach + 0.7]);
	toolMark("b-t2", "done", attach + 0.7);

	// 同じ行が、PC とスマホに同時に流れる
	linkDraw(attach + 0.2, { dur: 0.5 });
	[
		[attach + 0.8, "tb-3", "b-t3"],
		[attach + 1.5, "tb-4", "b-t4"],
		[attach + 2.2, "tb-4b", "b-t4b"],
	].forEach(([t, a, b], i) => {
		openRow($(`#${a}`), t, { dur: 0.28 });
		flash($(`#${a}`), t, { color: "124,190,222", peak: 0.3 });
		packet(t + 0.02, { color: i, dur: 0.34 });
		openRow($(`#${b}`), t + 0.16, { dur: 0.36 });
		flash($(`#${b}`), t + 0.3);
		cue("row", t);
		cue("rowPhone", t + 0.2);
	});

	capOut("c4", T.resilient - 0.7);
}

/* ================= 04. 切れても止まらない ================= */

function resilient() {
	const t0 = T.resilient;
	const drop = t0 + 1.0;
	const back = t0 + 3.5;
	capIn("c5", t0, { y: CAP_TOP });
	packet(t0 + 0.5, { color: 0, dur: 0.36 });

	// 切れる
	const mid = $("#link-line").getPointAtLength($("#link-line").getTotalLength() / 2);
	gsap.set("#link-x", { x: mid.x - 22, y: mid.y - 22 });
	cue("drop", drop);
	tl.to("#link-line", { stroke: SP.light.coral, opacity: 0.8, duration: 0.2 }, drop);
	ft("#link-x", { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, drop);
	tl.to(phone, { x: PH_SIDE.x + 7, duration: 0.05, yoyo: true, repeat: 3, ease: "sine.inOut" }, drop);
	status("B", "reconn", drop + 0.12);
	tl.to("#trB", { opacity: 0.42, duration: 0.35 }, drop + 0.12);

	// PC の Pi は進み続ける
	[
		[drop + 0.6, "tb-5"],
		[drop + 1.3, "tb-6"],
		[drop + 2.0, "tb-7"],
	].forEach(([t, id]) => {
		openRow($(`#${id}`), t, { dur: 0.28 });
		cue("row", t, { far: true });
	});

	// つながり直すと、今の状態に追いつく
	cue("reconnect", back);
	tl.to("#link-line", { stroke: SP.light.ink, opacity: 0.6, duration: 0.25 }, back);
	tl.to("#link-x", { autoAlpha: 0, scale: 0.4, duration: 0.25, ease: "power2.in" }, back);
	[0, 1, 2].forEach((i) => packet(back + 0.02 + i * 0.1, { color: i, dur: 0.36 }));
	status("B", "work", back + 0.32);
	tl.to("#trB", { opacity: 1, duration: 0.3 }, back + 0.32);
	["b-t5", "b-t6", "b-t7"].forEach((id, i) => {
		openRow($(`#${id}`), back + 0.4 + i * 0.15, { dur: 0.26 });
		flash($(`#${id}`), back + 0.45 + i * 0.15, { peak: 0.4, dur: 1.2 });
		cue("rowPhone", back + 0.42 + i * 0.15);
	});
	openRow($("#tb-8"), back + 1.3, { dur: 0.28 });
	$("#tb-8").classList.add("run");
	packet(back + 1.32, { color: 1, dur: 0.34 });
	openRow($("#b-t8"), back + 1.46, { dur: 0.34 });
	toolMark("b-t8", "run", 0);
	label($("#b-t8 [data-st]"), (t) => `${Math.max(0, Math.floor((t - (back + 1.46)) * 3))}秒`);
	cue("row", back + 1.3);

	// 夜の色へ
	capOut("c5", t0 + 5.25);
	linkDraw(t0 + 5.3, { dur: 0.3, out: true });
	wipe(T.grok - 0.55, { dur: 0.55, color: SP.dark.paper, origin: [3, 4], seed: 23 });
	tl.set(theme, { stage: 1, phone: 1 }, T.grok);
	hide([phone, term, "#link"], T.grok);
	tl.set("#link-line", { stroke: SP.dark.ink }, T.grok);
}

/* ================= 05. Grok Bot ================= */

function grok() {
	const t0 = T.grok;
	const chat = $("#gchat");
	const ask = t0 + 0.75;
	const spawn = t0 + 1.5;
	const question = t0 + 3.5;
	const pick = t0 + 5.25;
	const done = t0 + 7.25;
	const RIGHT = { pan: 0.45 };
	const LEFT = { pan: -0.45 };

	gsap.set(chat, { x: G_CHAT.x, y: G_CHAT.y });
	for (const id of ["g-u1", "g-b1", "g-q", "g-b2"]) closeNow($(`#${id}`));
	for (const id of ["tg-1", "tg-2", "tg-ask", "tg-ans", "tg-3", "tg-4", "tg-done"]) closeNow($(`#${id}`));

	// 会話とターミナルの間を行き来するたびに出る、小さな札
	const midX = (G_CHAT.x + G_CHAT.w + G_TERM.x) / 2;
	const lineY = G_TERM.y + 270;
	const pill = (i, at) => {
		const n = $(`#gp${i}`);
		gsap.set(n, { x: midX, y: lineY - 74, xPercent: -50 });
		ft(n, { autoAlpha: 0, scale: 0.6, y: lineY - 62 }, { autoAlpha: 1, scale: 1, y: lineY - 74, duration: 0.35, ease: "back.out(2)" }, at);
		tl.to(n, { autoAlpha: 0, y: lineY - 90, duration: 0.3, ease: "power2.in" }, at + 1.3);
	};

	capIn("c6a", t0 + 0.05, { y: 60 });
	ft(chat, { y: G_CHAT.y + 70, autoAlpha: 0 }, { y: G_CHAT.y, autoAlpha: 1, duration: 0.7, ease: "swift" }, t0 + 0.1);
	cue("whoosh", t0 + 0.1);

	// 1. Grok Bot に頼む
	openRow($("#g-u1"), ask, { dur: 0.36 });
	cue("send", ask, LEFT);

	// 2. PC で Pi が起動する（ターミナルが現れる）
	hide("#tvB", t0);
	show("#tvG", t0);
	ft(term, { x: 1940, y: G_TERM.y, scale: 1, autoAlpha: 1 }, { x: G_TERM.x, duration: 0.8, ease: "swift" }, spawn);
	cue("whoosh", spawn);
	cue("launch", spawn + 0.1, RIGHT);
	linkShape(G_TERM.x - 10, lineY, G_CHAT.x + G_CHAT.w + 10, lineY);
	linkDraw(spawn + 0.6, { dur: 0.4 });
	pill(1, spawn + 0.65);
	openRow($("#g-b1"), spawn + 0.75, { dur: 0.36 });
	cue("rowPhone", spawn + 0.8, LEFT);
	openRow($("#tg-1"), spawn + 1.1, { dur: 0.28 });
	cue("row", spawn + 1.1, RIGHT);
	openRow($("#tg-2"), spawn + 1.55, { dur: 0.28 });
	cue("row", spawn + 1.55, RIGHT);

	// 3. Pi の質問が、会話にカードで届く
	closeRow($("#tg-work"), question - 0.12, { dur: 0.2 });
	openRow($("#tg-ask"), question, { dur: 0.4 });
	cue("ask", question, RIGHT);
	packet(question + 0.1, { dir: 1, color: 2, dur: 0.4 });
	pill(2, question + 0.15);
	openRow($("#g-q"), question + 0.5, { dur: 0.45 });
	cue("rowPhone", question + 0.55, LEFT);
	capOut("c6a", question - 0.5);
	capIn("c6b", question, { y: 60 });

	// 4. 会話で選ぶと、PC の Pi が続きを進める
	tap($("#g-o1"), pick, { root: chat, sound: false });
	cue("tap", pick, LEFT);
	tl.to("#g-o1", { backgroundColor: "#f2f4f7", color: "#0b111d", duration: 0.2 }, pick + 0.02);
	tl.to("#g-o2", { opacity: 0.35, duration: 0.2 }, pick + 0.02);
	cue("answer", pick + 0.04, LEFT);
	packet(pick + 0.12, { dir: -1, color: 0, dur: 0.4 });
	pill(3, pick + 0.17);
	closeRow($("#tg-ask"), pick + 0.52, { dur: 0.3 });
	openRow($("#tg-ans"), pick + 0.6, { dur: 0.28 });
	openRow($("#tg-work"), pick + 0.7, { dur: 0.25 });
	openRow($("#tg-3"), pick + 1.05, { dur: 0.28 });
	cue("row", pick + 1.05, RIGHT);
	openRow($("#tg-4"), pick + 1.55, { dur: 0.28 });
	cue("row", pick + 1.55, RIGHT);

	// 5. 終わったら、会話に知らせが届く
	closeRow($("#tg-work"), done - 0.12, { dur: 0.2 });
	openRow($("#tg-done"), done, { dur: 0.3 });
	packet(done + 0.1, { dir: 1, color: 1, dur: 0.4 });
	pill(4, done + 0.15);
	openRow($("#g-b2"), done + 0.5, { dur: 0.4 });
	cue("done", done + 0.55, LEFT);

	// 退場
	capOut("c6b", T.toolkit - 0.75);
	linkDraw(T.toolkit - 0.75, { dur: 0.3, out: true });
	tl.to(chat, { autoAlpha: 0, y: G_CHAT.y - 40, duration: 0.35, ease: "power2.in" }, T.toolkit - 0.7);
	tl.to(term, { autoAlpha: 0, y: G_TERM.y - 40, duration: 0.35, ease: "power2.in" }, T.toolkit - 0.65);
	cue("whoosh", T.toolkit - 0.7);
}

/* ================= 06. 機能一覧 ================= */

function toolkit() {
	const t0 = T.toolkit;
	const tiles = $$("#tiles .tile");
	show("#tiles", t0);
	gsap.set(tiles, { autoAlpha: 0 });
	capIn("c7", t0 + 0.1, { y: 132 });
	const at = (i) => t0 + 0.5 + i * 0.5;
	tiles.forEach((tile, i) => {
		ft(tile, { autoAlpha: 0, y: 46, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, at(i));
		cue("pop", at(i), { i });
	});

	// サブエージェント：時間が進み、1 つ終わる
	for (const e of $$("[data-sa]")) label(e, (t) => mmss(Number(e.dataset.sa) + (t - at(0))));
	gsap.set("#sa3 .dot", { autoAlpha: 0 });
	label($("#sa3t"), (t) => (t < t0 + 3.5 ? mmss(158 + (t - at(0))) : "完了"));
	tl.set("#sa3 .spin", { autoAlpha: 0 }, t0 + 3.5);
	tl.set("#sa3 .dot", { autoAlpha: 1 }, t0 + 3.5);
	ft("#sa3 .dot", { scale: 2.2 }, { scale: 1, duration: 0.4, ease: "back.out(2)" }, t0 + 3.5);

	// Thinking を 1 段上げる
	const cell = (344 - 8) / 6;
	const spans = $$(".think span");
	gsap.set("#think-pill", { x: cell * 3 });
	tl.to("#think-pill", { x: cell * 4, duration: 0.42, ease: "power3.inOut" }, at(1) + 1.2);
	onFrame((t) => {
		const on = t < at(1) + 1.4 ? 3 : 4;
		spans.forEach((s, i) => {
			s.style.color = i === on ? "var(--text)" : "";
			s.style.fontWeight = i === on ? 600 : 400;
		});
	});
	cue("tick", at(1) + 1.2);

	// 利用枠の輪
	const C = 2 * Math.PI * 35;
	[
		["ug1", 0.41],
		["ug2", 0.67],
		["ug3", 0.12],
	].forEach(([id, v], i) => {
		const ring = $(`#${id}`);
		const num = $(`#${id}-n`);
		onFrame((t) => {
			const p = v * ease.out5(prog(t, at(2) + 0.2 + i * 0.12, at(2) + 1.5 + i * 0.12));
			ring.setAttribute("stroke-dasharray", `${(C * p).toFixed(2)} ${C.toFixed(2)}`);
			const s = `${Math.round(p * 100)}%`;
			if (num.textContent !== s) num.textContent = s;
		});
	});

	const inside = (i, sel, stagger = 0.12, from = { opacity: 0, y: 14 }) =>
		tl.fromTo($$(sel, tiles[i]), from, { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.45, ease: "power3.out", stagger }, at(i) + 0.18);
	inside(0, ".sa", 0.1);
	inside(3, ".nt", 0.16, { opacity: 0, x: 30 });
	inside(4, ".gh, .gh-st", 0.12);
	inside(5, ".im", 0.09, { opacity: 0, scale: 0.6 });
	inside(6, ".cmds span", 0.07, { opacity: 0, scale: 0.7 });
	inside(7, ".tdf, .tdl", 0.09, { opacity: 0, x: 16 });

	capOut("c7", t0 + 7.25);
	tl.to(tiles, { autoAlpha: 0, y: -34, scale: 0.96, duration: 0.34, ease: "power2.in", stagger: 0.035 }, t0 + 7.25);
	hide("#tiles", t0 + 7.95);
	cue("whoosh", t0 + 7.3);
}

/* ================= 07. 導入方法 ================= */

function setup() {
	const t0 = T.setup;
	capIn("c8", t0, { y: 124 });
	const steps = $$(".step");
	const xs = [150, 700, 1250];
	steps.forEach((s, i) => {
		gsap.set(s, { x: xs[i], y: 420 });
		ft(s, { autoAlpha: 0, y: 480, scale: 0.94 }, { autoAlpha: 1, y: 420, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, t0 + 0.5 + i * 0.5);
		cue("pop", t0 + 0.5 + i * 0.5, { i: i * 2 });
	});
	const a = "pi install npm:@phni3j9a/pimate";
	label($("#st1-a"), (t) => typed(a, t, t0 + 0.85, 36));
	label($("#st1-b"), (t) => typed("pi", t, t0 + 2.0, 9));
	cue("type", t0 + 0.85, { dur: 0.86, n: 31, key: true });
	label($("#st2-a"), (t) => typed("/pimate setup", t, t0 + 1.5, 15));
	cue("type", t0 + 1.5, { dur: 0.86, n: 13, key: true });
	ft("#st3-qr", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, t0 + 1.75);
	gsap.set("#st3-qr", { opacity: 0 });
	ft("#st3-scan", { y: 0, opacity: 1 }, { y: 150, duration: 0.7, ease: "sine.inOut", yoyo: true, repeat: 1 }, t0 + 2.5);
	tl.set("#st3-scan", { opacity: 0 }, t0 + 3.9);
	cue("scan", t0 + 2.5, { dur: 1.4 });
	ft("#st3-ok", { opacity: 0 }, { opacity: 1, duration: 0.3 }, t0 + 4.0);
	ft("#st3-ok svg", { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)" }, t0 + 4.0);
	cue("success", t0 + 4.0);

	gsap.set("#setup-note", { y: 908 });
	ft("#setup-note", { opacity: 0, y: 924 }, { opacity: 1, y: 908, duration: 0.6 }, t0 + 2.2);

	capOut("c8", t0 + 5.1);
	tl.to("#setup-note", { opacity: 0, duration: 0.3, ease: "power2.in" }, t0 + 5.05);
	tl.to(steps, { autoAlpha: 0, y: 380, duration: 0.35, ease: "power2.in", stagger: 0.05 }, t0 + 5.1);
	tl.to("#chapters", { opacity: 0, duration: 0.3 }, t0 + 5.1);
}

/* ================= 最後のカード ================= */

function end() {
	const t0 = T.end;
	const m = $("#logo-mark");
	const word = $("#logo-word");
	const tag = $("#logo-tag");
	const up = -70;
	// 左上のロゴが中央へ戻る
	tl.to(m, { x: lockup.mark.x, y: lockup.mark.y + up, scale: lockup.mark.scale, duration: 0.62, ease: "power3.in" }, t0 - 0.62);
	tl.to(word, { x: lockup.word.x, y: lockup.word.y + up, scale: 1, duration: 0.62, ease: "power3.in" }, t0 - 0.62);
	ft(m, { scale: lockup.mark.scale * 1.09 }, { scale: lockup.mark.scale, duration: 0.5, ease: "power2.out" }, t0);
	const r = rng(5);
	const cx = 960;
	const cy = 440 + up;
	$$("#sparks .spark").forEach((s, i) => {
		const a = (i / 16) * Math.PI * 2 + r() * 0.3;
		const d = 420 + r() * 380;
		ft(s, { x: cx + Math.cos(a) * 260, y: cy + Math.sin(a) * 120, opacity: 1, scale: 1.5, rotation: 0 }, { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d * 0.62, opacity: 0, scale: 0.3, rotation: 220 * (i % 2 ? 1 : -1), duration: 0.9 + r() * 0.3, ease: "power3.out" }, t0);
	});

	ft(tag, { autoAlpha: 1, y: 566, opacity: 1 }, { y: 566, duration: 0.01 }, t0 + 0.5);
	ft($(".jp", tag), { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.75, ease: "swift" }, t0 + 0.5);
	ft($(".en", tag), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, t0 + 0.85);
	gsap.set("#end-url", { y: 772 });
	ft("#end-url", { autoAlpha: 0, y: 792 }, { autoAlpha: 1, y: 772, duration: 0.6 }, t0 + 1.5);
	gsap.set("#end-meta", { y: 858 });
	show("#end-meta", t0 + 1.9);
	ft($$("#end-meta span"), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08 }, t0 + 1.9);
	gsap.set($$("#end-meta span"), { opacity: 0 });
	tl.to("#fine", { opacity: 1, duration: 0.6 }, t0 + 2.4);
	cue("tag", t0 + 0.5);

	tl.to("#blackout", { opacity: 1, duration: 1.1, ease: "power2.inOut" }, T.total - 1.3);
}
