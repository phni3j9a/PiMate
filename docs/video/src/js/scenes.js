// 全シーンの動き。時刻は秒、120 BPM（1 拍 0.5 秒・1 小節 2 秒）に合わせてある。
import { cue, T } from "./cues.js";
import { $, $$, closeNow, closeRow, ease, el, growIn, gsap, label, lerp, mmss, onFrame, openRow, prog, rng, stream, tl, toggle, typed } from "./engine.js";
import { capIn, capOut, extraText, H, linkDraw, linkShape, mount, packet, parts, pose, status, tap, theme, toolMark, W, wipe } from "./stage.js";
import { stage as SP } from "./tokens.js";

export { extraText, mount };

const show = (sel, at) => tl.set(sel, { autoAlpha: 1 }, at);
const hide = (sel, at) => tl.set(sel, { autoAlpha: 0 }, at);
/** immediateRender なしの fromTo（同じ部品を後のシーンで動かし直すため）。 */
const ft = (sel, from, to, at) => tl.fromTo(sel, from, { ...to, immediateRender: false }, at);

const TERM = { x: 128, y: 492 };
const CAP_TOP = 116;
const PH_SIDE = pose(1500, 540, 1.1);
const PH_MID = pose(1420, 540, 1.1);

let phone;
let term;

export function build() {
	phone = $("#phone");
	term = $("#term");
	init();
	problem();
	reveal();
	samePi();
	steer();
	review();
	fleet();
	handoff();
	toolkit();
	resilient();
	privacy();
	setup();
	end();
	tl.set({}, {}, T.total);
	return T.total;
}

function init() {
	gsap.set(
		["#phone", "#link", "#link-x", ".cap", "#notif", "#tiles", "#dia", "#checks", ".step", "#pts6", "#logo-mark", "#logo-word", "#logo-tag", "#end-url", "#end-meta"],
		{ autoAlpha: 0 },
	);
	gsap.set(["#review", "#newpi", "#chatB", "#scrim", "#drawer", "#tvShell", "#tvB"], { autoAlpha: 0 });
	gsap.set(".tool .mk .spin", { autoAlpha: 0 });
	term.insertAdjacentHTML("beforeend", '<i id="term-dim" style="position:absolute;inset:0;background:#04070d;opacity:0;pointer-events:none"></i>');
	gsap.set("#chapters", { opacity: 0 });

	// 入力欄の輪（コンテキストの使用量）。値は例。
	const C = 2 * Math.PI * 10.5;
	for (const k of ["A", "B"]) $(`#g1${k}`).setAttribute("stroke-dasharray", `${(C * 0.41).toFixed(1)} ${C.toFixed(1)}`);
}

/* ================= 1. 冒頭：Pi が待っている ================= */

function problem() {
	const S = 1.24;
	gsap.set(term, { x: (W - 900 * S) / 2, y: 56, scale: S, autoAlpha: 1 });
	ft("#blackout", { opacity: 1 }, { opacity: 0, duration: 1.3, ease: "power2.out" }, 0);
	gsap.set("#blackout", { opacity: 1 });

	// PC の Pi が調べて、質問を出す
	growIn($("#ta-1"), 0.75, { dur: 0.28 });
	growIn($("#ta-2"), 1.1, { dur: 0.28 });
	growIn($("#ta-3"), 1.45, { dur: 0.28 });
	growIn($("#ta-x"), 1.9, { dur: 0.3 });
	for (const t of [0.75, 1.1, 1.45, 1.9]) cue("row", t);
	closeRow($("#ta-work"), 2.4, { dur: 0.25 });
	growIn($("#ta-ask"), 2.5, { dur: 0.45 });
	cue("ask", 2.55);
	for (const id of ["ta-ans", "ta-4", "ta-5", "ta-6", "ta-7"]) closeNow($(`#${id}`));

	// 待ち時間が流れていく
	const waited = (t) => {
		if (t < 2.5) return 0;
		if (t < 3.6) return t - 2.5;
		if (t < 6.4) return 1.1 + (2832 - 1.1) * ease.inOut3(prog(t, 3.6, 6.4));
		return 2832 + (t - 6.4);
	};
	label($("#ta-wait"), (t) => `入力待ち ${mmss(waited(t))}`);
	cue("timelapse", 3.6, { dur: 2.8 });
	tl.to("#vignette", { opacity: 1, duration: 2.8, ease: "sine.inOut" }, 3.6);
	tl.to("#term-dim", { opacity: 0.42, duration: 2.8, ease: "sine.inOut" }, 3.6);
	tl.to(term, { scale: S * 0.965, x: (W - 900 * S * 0.965) / 2, y: 68, duration: 7.4, ease: "none" }, 0.2);

	// 見出し
	const c = parts("c1");
	gsap.set("#c1", { y: 772 });
	show("#c1", 2.9);
	tl.fromTo(c.lines[0], { yPercent: 112 }, { yPercent: 0, duration: 0.85, ease: "swift" }, 3.0);
	tl.fromTo(c.lines[1], { yPercent: 112 }, { yPercent: 0, duration: 0.85, ease: "swift" }, 4.6);
	tl.fromTo(c.en, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.6 }, 5.0);

	// スマホに通知が届く
	gsap.set("#notif", { x: (W - 620) / 2, y: -240, transformOrigin: "50% 0%" });
	ft("#notif", { y: -240, autoAlpha: 1 }, { y: 40, duration: 0.6, ease: "settle" }, 6.5);
	tl.to("#notif", { rotation: 1.1, duration: 0.045, yoyo: true, repeat: 7, ease: "sine.inOut" }, 7.0);
	tl.set("#notif", { rotation: 0 }, 7.4);
	cue("notify", 6.55);
	cue("buzz", 7.0);

	// 紙の色のマスで覆って、次へ
	wipe(7.45, { dur: 0.55, color: SP.light.paper, origin: [8, 0], seed: 7 });
	tl.set(theme, { stage: 0 }, T.reveal);
	hide([term, "#c1", "#notif"], T.reveal);
	tl.set("#vignette", { opacity: 0 }, T.reveal);
	tl.set("#term-dim", { opacity: 0 }, T.reveal);
}

/* ================= 2. ロゴ ================= */

const lockup = {};

function reveal() {
	const m = $("#logo-mark");
	const word = $("#logo-word");
	const tag = $("#logo-tag");
	const cx = 960;
	const cy = 440;
	gsap.set(m, { x: cx - 230, y: cy - 204, scale: 1, transformOrigin: "50% 50%" });
	show(m, 7.4);

	// 5 つの形が 16 分音符ごとにはまる
	const pieces = {
		blue1: { x: -820, y: 160, r: -55, land: 8.0 },
		blue2: { x: -120, y: 760, r: 130, land: 8.125 },
		coral: { x: 380, y: -760, r: 70, land: 8.25 },
		yellow1: { x: 900, y: -140, r: 210, land: 8.375 },
		yellow2: { x: 760, y: 620, r: -100, land: 8.5 },
	};
	Object.entries(pieces).forEach(([k, p], i) => {
		const node = $(`[data-p="${k}"]`, m);
		tl.fromTo(node, { x: p.x, y: p.y, rotation: p.r, transformOrigin: "50% 50%" }, { x: 0, y: 0, rotation: 0, duration: 0.52, ease: "power3.in" }, p.land - 0.52);
		tl.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, p.land - 0.52);
		ft(m, { scale: 1.05 }, { scale: 1, duration: 0.24, ease: "power2.out" }, p.land);
		cue("logoHit", p.land, { i });
	});

	// はまった瞬間に小さなマスが散る
	const r = rng(11);
	$$("#sparks .spark").forEach((s, i) => {
		const a = (i / 16) * Math.PI * 2 + r() * 0.3;
		const d = 300 + r() * 260;
		gsap.set(s, { backgroundColor: ["var(--blue)", "var(--coral)", "var(--yellow)"][i % 3] });
		ft(s, { x: cx - 7 + Math.cos(a) * 120, y: cy - 7 + Math.sin(a) * 110, opacity: 1, scale: 1.4, rotation: 0 }, { x: cx - 7 + Math.cos(a) * d, y: cy - 7 + Math.sin(a) * d * 0.8, opacity: 0, scale: 0.3, rotation: 200 * (i % 2 ? 1 : -1), duration: 0.8 + r() * 0.3, ease: "power3.out" }, 8.5);
	});

	// マークが左に寄り、名前が出る
	const s = 0.62;
	const mw = 460 * s;
	const gap = 54;
	const total = mw + gap + word.offsetWidth;
	const left = (W - total) / 2;
	lockup.mark = { x: left + mw / 2 - 230, y: cy - 204, scale: s };
	lockup.word = { x: left + mw + gap, y: cy - 100, scale: 1 };
	gsap.set(word, lockup.word);
	tl.to(m, { ...lockup.mark, duration: 0.85, ease: "glide" }, 9.0);
	show(word, 9.12);
	tl.fromTo($("span", word), { xPercent: -104 }, { xPercent: 0, duration: 0.85, ease: "swift" }, 9.12);
	cue("swell", 9.0);

	// ひとこと
	gsap.set(tag, { y: 640 });
	show(tag, 10.0);
	tl.fromTo($(".jp", tag), { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.75, ease: "swift" }, 10.0);
	tl.fromTo($(".en", tag), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6 }, 10.35);
	cue("tag", 10.0);

	// 左上に小さく収まり、最後まで残る
	tl.to(tag, { opacity: 0, y: 620, duration: 0.4, ease: "power2.in" }, 12.6);
	hide(tag, 13.05);
	lockup.bugMark = { x: 64 + 20 - 230, y: 52 + 18 - 204, scale: 40 / 460 };
	lockup.bugWord = { x: 118, y: 57, scale: 0.13 };
	tl.to(m, { ...lockup.bugMark, duration: 0.9, ease: "glide" }, 12.75);
	tl.to(word, { ...lockup.bugWord, duration: 0.9, ease: "glide" }, 12.75);
	cue("whoosh", 12.75);
	ft("#bg-grid", { opacity: 0 }, { opacity: 0.55, duration: 1.2, ease: "power1.out" }, 8.0);
	ft("#bg-glow", { opacity: 0 }, { opacity: 1, duration: 1.5, ease: "power1.out" }, 8.0);
	gsap.set(["#bg-grid", "#bg-glow"], { opacity: 0 });
}

/* ================= 3. 同じ Pi を、スマホで ================= */

function samePi() {
	const t0 = T.same;
	// 入力欄の状態（文字・プレースホルダー・カーソル）は、まとめて時刻から決める
	const draft = "このターンの変更（src/auth/LoginForm.tsx ほか 2 ファイル）について：";
	const steerMsg = "テストは vitest に合わせて";
	const inA = $("#inA");
	const phA = $("#phA");
	const caretA = $("#caretA");
	caretA.dataset.solid = "1";
	onFrame((t) => {
		let s = "";
		if (t >= 26.4 && t < 28.1) s = typed(steerMsg, t, 26.4, 12);
		else if (t >= 39.32) s = draft;
		if (inA.textContent !== s) inA.textContent = s;
		const ph = t < 17.78 ? "上の質問に回答すると入力できます" : "Pi にメッセージ";
		if (phA.textContent !== ph) phA.textContent = ph;
		phA.style.visibility = s ? "hidden" : "visible";
		const focus = (t >= 26.2 && t < 28.1) || t >= 39.32;
		caretA.style.opacity = focus && (s.length < steerMsg.length && t < 28.1 ? true : t % 1.06 < 0.6) ? 1 : 0;
	});
	toggle($("#sendA"), "on", [26.45, 28.1], [39.32]);
	gsap.set("#stopA", { autoAlpha: 0 });
	closeNow($("#queuedA"));
	$("#queuedTxA").textContent = steerMsg;

	// スマホの会話：質問より後の行は閉じておく
	for (const id of ["a-ask", "a-t1", "a-t2", "a-t3", "a-t4", "a-steer", "a-t5", "a-t6", "a-out", "a-meta"]) closeNow($(`#${id}`));
	gsap.set("#a-ans", { display: "none" });
	gsap.set("#qA1 .radio", { "--on": 0 });
	status("A", "wait", 0);
	label($("#stA [data-tm]"), (t) => mmss(t - 17.8));

	// 登場
	ft(term, { x: -980, y: TERM.y, scale: 1, autoAlpha: 1 }, { x: TERM.x, duration: 0.95, ease: "swift" }, 13.35);
	gsap.set(phone, PH_SIDE);
	ft(phone, { y: PH_SIDE.y + 300, autoAlpha: 0 }, { y: PH_SIDE.y, autoAlpha: 1, duration: 0.95, ease: "swift" }, 13.5);
	cue("whoosh", 13.35);
	tl.to("#chapters", { opacity: 1, duration: 0.5 }, t0);
	capIn("c3a", t0, { y: CAP_TOP });

	linkShape(TERM.x + 900 + 10, TERM.y + 300, PH_SIDE.x - 10, 540);
	linkDraw(14.5);

	// 同じ質問が、両方に出ている
	[0, 1, 2].forEach((i) => packet(15.0 + i * 0.11, { color: i, dur: 0.5, sound: i === 0 }));
	tl.to("#ta-ask", { scale: 1.02, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut", transformOrigin: "50% 50%" }, 15.0);
	tl.to("#qA", { scale: 1.02, duration: 0.2, yoyo: true, repeat: 1, ease: "sine.inOut" }, 15.45);

	// スマホで答える
	tap($("#qA1"), 16.6, { dx: -90, press: false });
	tl.to("#qA1 .radio", { "--on": 1, duration: 0.22, ease: "power2.out" }, 16.62);
	tap($("#qAgo"), 17.6);
	cue("answer", 17.62);
	closeRow($("#qA"), 17.75, { dur: 0.5 });
	openRow($("#a-ask"), 17.85);
	status("A", "work", 17.78);
	show("#stopA", 17.78);
	packet(17.68, { dir: -1, color: 0, dur: 0.42 });
	packet(17.76, { dir: -1, color: 2, dur: 0.42 });

	// PC の Pi が動き出し、同じ行がスマホにも流れる
	closeRow($("#ta-ask"), 18.1, { dur: 0.32 });
	openRow($("#ta-ans"), 18.2, { dur: 0.3 });
	openRow($("#ta-work"), 18.3, { dur: 0.3 });
	const rows = [
		[18.8, "ta-4", "a-t1"],
		[19.8, "ta-5", "a-t2"],
		[20.8, "ta-6", "a-t3"],
		[21.8, "ta-7", "a-t4"],
	];
	rows.forEach(([t, a, b], i) => {
		openRow($(`#${a}`), t, { dur: 0.28 });
		packet(t + 0.02, { color: i, dur: 0.34 });
		openRow($(`#${b}`), t + 0.16, { dur: 0.36 });
		cue("row", t);
		cue("rowPhone", t + 0.2);
	});
	$("#ta-7").classList.add("run");
	toolMark("a-t4", "run", 0);
	toolMark("a-t4", "done", 28.92);
	label($("#a-t4 [data-st]"), (t) => `${Math.min(7, Math.max(0, Math.floor(t - 21.9)))}秒`);

	// 見出しの 2 つめ
	capOut("c3a", 19.55);
	capIn("c3b", 20.0, { y: CAP_TOP });

	// 退場
	capOut("c3b", 25.35);
	linkDraw(25.4, { dur: 0.4, out: true });
	tl.to(term, { x: -980, duration: 0.7, ease: "power3.in" }, 25.45);
	hide(term, 26.2);
}

/* ================= 4. 作業中でも割り込む ================= */

function steer() {
	const t0 = T.steer;
	tl.to(phone, { ...pose(1420, 449, 1.5), duration: 1.05, ease: "glide" }, 25.45);
	cue("whoosh", 25.5);
	capIn("c4", t0, { y: 318 });

	cue("type", 26.4, { dur: 1.4, n: 17 });
	tap($("#sendA"), 28.05);
	cue("send", 28.07);
	openRow($("#queuedA"), 28.15, { dur: 0.3 });
	closeRow($("#queuedA"), 28.85, { dur: 0.3 });
	openRow($("#a-steer"), 28.9, { dur: 0.45 });
	cue("rowPhone", 28.95);
	openRow($("#a-t5"), 29.4, { dur: 0.34 });
	cue("rowPhone", 29.42);
	openRow($("#a-t6"), 29.95, { dur: 0.34 });
	cue("rowPhone", 29.97);
	toolMark("a-t6", "run", 0);
	toolMark("a-t6", "done", 30.6);
	label($("#a-t6 [data-st]"), (t) => `${t < 30.6 ? Math.max(0, Math.floor((t - 29.95) * 3)) : 2}秒`);
	openRow($("#a-out"), 30.55, { dur: 0.36 });
	tl.set("#a-ans", { display: "flex" }, 30.85);
	const done = stream($("#a-ans"), 30.85, { cps: 52 });
	cue("stream", 30.85, { dur: done - 30.85 });
	openRow($("#a-meta"), done + 0.02, { dur: 0.25 });
	status("A", "idle", done + 0.05);
	hide("#stopA", done + 0.05);
	cue("done", done + 0.05);
	capOut("c4", 31.6);
}

/* ================= 5. 変更は差分で ================= */

function review() {
	const t0 = T.review;
	tl.to(phone, { ...pose(1420, 615, 1.5), duration: 1.0, ease: "glide" }, 31.85);
	ft("#review", { x: 390, autoAlpha: 1 }, { x: 0, duration: 0.55, ease: "swift" }, t0);
	tl.to("#chatA", { x: -120, duration: 0.55, ease: "swift" }, t0);
	cue("whoosh", t0 - 0.05);
	capIn("c5", t0 + 0.15, { y: 318 });

	const lines = $$("#rv-diff > *");
	tl.fromTo(lines, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.32, ease: "power2.out", stagger: 0.06 }, t0 + 0.45);
	cue("cascade", t0 + 0.45, { n: lines.length, step: 0.06 });
	label($("#rv-add"), (t) => `+${Math.round(97 * ease.out3(prog(t, t0 + 0.4, t0 + 1.4)))}`);
	label($("#rv-del"), (t) => `−${Math.round(3 * ease.out3(prog(t, t0 + 0.4, t0 + 1.4)))}`);

	// 2 つめのファイルを開く
	closeNow($("#rv-diff2"));
	tap($("#rv-f2"), 35.2, { press: false });
	closeRow($("#rv-diff"), 35.3, { dur: 0.5 });
	openRow($("#rv-diff2"), 35.34, { dur: 0.5 });
	tl.to("#rv-f1 .chev", { rotation: 180, duration: 0.4 }, 35.3);
	tl.to("#rv-f2 .chev", { rotation: 180, duration: 0.4 }, 35.3);
	const lines2 = $$("#rv-diff2 > *");
	tl.fromTo(lines2, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.3, ease: "power2.out", stagger: 0.05 }, 35.5);
	cue("cascade", 35.5, { n: lines2.length, step: 0.05 });

	// 引いて、この変更について依頼する
	tl.to(phone, { ...PH_MID, duration: 0.95, ease: "glide" }, 38.0);
	cue("whoosh", 38.0);
	tap($("#rv-ask"), 39.1);
	tl.to("#review", { x: 390, duration: 0.5, ease: "swift" }, 39.3);
	tl.to("#chatA", { x: 0, duration: 0.5, ease: "swift" }, 39.3);
	hide("#review", 39.85);
	capOut("c5", 39.5);
}

/* ================= 6. 複数の Pi を一覧に ================= */

function fleet() {
	const t0 = T.fleet;
	capIn("c6", t0, { y: 262 });

	// 左端から引き出す
	const sw = el('<div class="touch"><i></i><b></b></div>');
	$("#pscreen").appendChild(sw);
	tl.fromTo(sw, { x: 16, y: 440, opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.18 }, 40.2);
	tl.to(sw, { x: 250, duration: 0.5, ease: "power2.inOut" }, 40.36);
	tl.to(sw, { opacity: 0, duration: 0.18 }, 40.82);
	ft("#drawer", { x: -330, autoAlpha: 1 }, { x: 0, duration: 0.56, ease: "swift" }, 40.38);
	ft("#scrim", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: "power2.out" }, 40.38);
	cue("whoosh", 40.36);
	const rows = $$("#drawer .dw-list > *");
	tl.fromTo(rows, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.42, ease: "power3.out", stagger: 0.04 }, 40.5);

	// 要対応は上に、PC ごとに並ぶ
	const pts = $$("#pts6 li");
	gsap.set("#pts6", { y: 640 });
	show("#pts6", 41.9);
	gsap.set("#dw-1 .hl", { background: "rgba(225,173,66,0.18)" });
	gsap.set("#dw-2 .hl", { background: "rgba(227,119,105,0.18)" });
	tl.fromTo(pts[0], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.55 }, 42.0);
	tl.to(["#dw-1 .hl", "#dw-2 .hl"], { opacity: 1, duration: 0.3, stagger: 0.14 }, 42.05);
	tl.to(["#dw-1 .hl", "#dw-2 .hl"], { opacity: 0, duration: 0.5 }, 43.5);
	cue("pop", 42.0, { i: 0 });
	tl.fromTo(pts[1], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.55 }, 44.0);
	const groups = $$("#drawer .grp:not(.att)");
	tl.to(groups, { x: 8, color: "var(--text)", duration: 0.25, stagger: 0.16, ease: "power2.out" }, 44.05);
	tl.to(groups, { x: 0, color: "var(--text2)", duration: 0.5, stagger: 0.16 }, 44.9);
	cue("pop", 44.0, { i: 1 });

	// 新しい Pi へ
	tap($("#dw-new"), 46.5);
	ft("#newpi", { y: 844, autoAlpha: 1 }, { y: 0, duration: 0.58, ease: "swift" }, 46.72);
	cue("whoosh", 46.7);
	hide(["#drawer", "#scrim", "#chatA"], 47.32);
	capOut("c6", 47.2);
	tl.to(pts, { opacity: 0, x: -20, duration: 0.35, stagger: 0.05, ease: "power2.in" }, 47.2);
	hide("#pts6", 47.7);
	tl.to(phone, { ...PH_SIDE, duration: 0.9, ease: "glide" }, 47.1);
}

/* ================= 7. スマホで始めて、PC で続ける ================= */

function handoff() {
	const t0 = T.handoff;
	capIn("c7", t0, { y: 318 });
	tl.to("#c7", { y: CAP_TOP, duration: 0.9, ease: "glide" }, 51.7);

	// フォルダと最初のメッセージ
	const folder = $("#np-folder");
	const msg = "トップページを速くして";
	label(folder, (t) => (t >= 48.45 ? "~/work/site" : ""));
	label($("#np-msg"), (t) => typed(msg, t, 49.1, 9.5));
	const ph = $("#np-ph");
	const c1 = $("#np-caret1");
	const c2 = $("#np-caret2");
	c1.dataset.solid = "1";
	c2.dataset.solid = "1";
	onFrame((t) => {
		ph.style.visibility = t >= 49.1 ? "hidden" : "visible";
		c1.style.opacity = t < 48.9 && t % 1.06 < 0.6 ? 1 : 0;
		c2.style.opacity = t >= 48.9 && (t < 50.3 || t % 1.06 < 0.6) ? 1 : 0;
	});
	tap($("#np-r1"), 48.35, { dx: -110, press: false });
	cue("type", 49.1, { dur: 1.16, n: 11 });
	tap($("#np-go"), 50.9);
	cue("launch", 50.95);

	// 新しい Pi が動き出す
	for (const id of ["b-u", "b-t1", "b-t2", "b-t3", "b-t4", "b-t5", "b-t6", "b-t7", "b-t8"]) closeNow($(`#${id}`));
	closeNow($("#queuedB"));
	$("#inB").textContent = "";
	$("#caretB").dataset.solid = "1";
	$("#caretB").style.opacity = 0;
	status("B", "work", 0);
	label($("#stB [data-tm]"), (t) => mmss(t < 60 ? t - 51.2 : 192 + (t - 66)));
	show("#chatB", 51.1);
	tl.to("#newpi", { autoAlpha: 0, scale: 0.96, duration: 0.36, ease: "power2.in" }, 51.1);
	openRow($("#b-u"), 51.3, { dur: 0.45 });
	openRow($("#b-t1"), 52.1, { dur: 0.34 });
	cue("rowPhone", 52.12);
	openRow($("#b-t2"), 52.9, { dur: 0.34 });
	cue("rowPhone", 52.92);
	toolMark("b-t2", "run", 0);
	toolMark("b-t2", "done", 55.5);
	label($("#b-t2 [data-st]"), (t) => `${Math.min(14, Math.max(0, Math.floor((t - 52.9) * 5.4)))}秒`);

	// PC のターミナルからつなぐ
	const cmd = "pimate attach pimate-4f2a91c0";
	hide("#tvA", 50);
	show("#tvShell", 50);
	label($("#term-title"), (t) => (t < 50 ? "pi — ~/work/web" : t < 54.75 ? "dev-laptop — bash" : "pi — ~/work/site"));
	label($("#sh-cmd"), (t) => typed(cmd, t, 52.95, 23));
	gsap.set("#sh-out", { autoAlpha: 0 });
	ft(term, { x: -980, y: TERM.y, scale: 1, autoAlpha: 1 }, { x: TERM.x, duration: 0.9, ease: "swift" }, 52.1);
	cue("whoosh", 52.1);
	cue("type", 52.95, { dur: 1.3, n: 30, key: true });
	show("#sh-out", 54.38);
	hide("#sh-caret", 54.38);
	cue("enter", 54.36);
	hide("#tvShell", 54.75);
	ft("#tvB", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: "power2.out" }, 54.75);
	cue("attach", 54.75);
	for (const id of ["tb-3", "tb-4", "tb-5", "tb-6", "tb-7", "tb-8"]) closeNow($(`#${id}`));
	$("#tb-2").classList.add("run");
	toggle($("#tb-2"), "run", [0, 55.5]);

	linkDraw(55.0, { dur: 0.6 });
	const rows = [
		[55.6, "tb-3", "b-t3"],
		[56.4, "tb-4", "b-t4"],
	];
	rows.forEach(([t, a, b], i) => {
		openRow($(`#${a}`), t, { dur: 0.28 });
		packet(t + 0.02, { color: i + 1, dur: 0.34 });
		openRow($(`#${b}`), t + 0.16, { dur: 0.36 });
		cue("row", t);
		cue("rowPhone", t + 0.2);
	});

	// 夜の色へ
	capOut("c7", 57.05);
	wipe(57.45, { dur: 0.55, color: SP.dark.paper, origin: [13, 4], seed: 23 });
	tl.set(theme, { stage: 1, phone: 1 }, T.toolkit);
	hide([phone, term, "#link"], T.toolkit);
}

/* ================= 8. ほかの機能 ================= */

function toolkit() {
	const t0 = T.toolkit;
	const tiles = $$("#tiles .tile");
	show("#tiles", t0);
	gsap.set(tiles, { autoAlpha: 0 });
	capIn("c8", t0 + 0.1, { y: 132 });
	const at = (i) => t0 + 0.5 + i * 0.5;
	tiles.forEach((tile, i) => {
		ft(tile, { autoAlpha: 0, y: 46, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, at(i));
		cue("pop", at(i), { i });
	});

	// サブエージェント：時間が進み、1 つ終わる
	for (const e of $$("[data-sa]")) label(e, (t) => mmss(Number(e.dataset.sa) + (t - at(0))));
	gsap.set("#sa3 .dot", { autoAlpha: 0 });
	label($("#sa3t"), (t) => (t < 61.5 ? mmss(158 + (t - at(0))) : "完了"));
	tl.set("#sa3 .spin", { autoAlpha: 0 }, 61.5);
	tl.set("#sa3 .dot", { autoAlpha: 1 }, 61.5);
	ft("#sa3 .dot", { scale: 2.2 }, { scale: 1, duration: 0.4, ease: "back.out(2)" }, 61.5);

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
	tl.fromTo("#th-d", { clipPath: "inset(0% 0% 0% 100%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "power3.inOut" }, at(7) + 0.35);
	tl.to("#th-d", { clipPath: "inset(0% 0% 0% 50%)", duration: 0.8, ease: "power3.inOut" }, at(7) + 1.5);

	capOut("c8", 65.25);
	tl.to(tiles, { autoAlpha: 0, y: -34, scale: 0.96, duration: 0.34, ease: "power2.in", stagger: 0.035 }, 65.25);
	hide("#tiles", 65.95);
	cue("whoosh", 65.3);
}

/* ================= 9. 切れても止まらない ================= */

function resilient() {
	const t0 = T.resilient;
	ft(term, { x: -980, y: TERM.y, scale: 1, autoAlpha: 1 }, { x: TERM.x, duration: 0.9, ease: "swift" }, 65.6);
	ft(phone, { ...PH_SIDE, y: PH_SIDE.y + 300, autoAlpha: 0 }, { y: PH_SIDE.y, autoAlpha: 1, duration: 0.9, ease: "swift" }, 65.72);
	capIn("c9", t0, { y: CAP_TOP });
	linkDraw(66.25, { dur: 0.5 });
	packet(66.6, { color: 0, dur: 0.36 });

	// 切れる
	const mid = $("#link-line").getPointAtLength($("#link-line").getTotalLength() / 2);
	gsap.set("#link-x", { x: mid.x - 22, y: mid.y - 22 });
	cue("drop", 67.0);
	tl.to("#link-line", { stroke: SP.dark.coral, opacity: 0.55, duration: 0.2 }, 67.0);
	ft("#link-x", { autoAlpha: 0, scale: 0.4 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, 67.0);
	tl.to(phone, { x: PH_SIDE.x + 7, duration: 0.05, yoyo: true, repeat: 3, ease: "sine.inOut" }, 67.0);
	status("B", "reconn", 67.12);
	tl.to("#trB", { opacity: 0.42, duration: 0.35 }, 67.12);

	// PC の Pi は進み続ける
	[
		[67.6, "tb-5"],
		[68.3, "tb-6"],
		[69.0, "tb-7"],
	].forEach(([t, id]) => {
		openRow($(`#${id}`), t, { dur: 0.28 });
		cue("row", t, { far: true });
	});

	// つながり直すと、今の状態に追いつく
	cue("reconnect", 69.5);
	tl.to("#link-line", { stroke: SP.dark.ink, opacity: 1, duration: 0.25 }, 69.5);
	tl.to("#link-x", { autoAlpha: 0, scale: 0.4, duration: 0.25, ease: "power2.in" }, 69.5);
	[0, 1, 2].forEach((i) => packet(69.52 + i * 0.1, { color: i, dur: 0.36 }));
	status("B", "work", 69.82);
	tl.to("#trB", { opacity: 1, duration: 0.3 }, 69.82);
	["b-t5", "b-t6", "b-t7"].forEach((id, i) => {
		openRow($(`#${id}`), 69.9 + i * 0.15, { dur: 0.26 });
		cue("rowPhone", 69.92 + i * 0.15);
	});
	openRow($("#tb-8"), 70.8, { dur: 0.28 });
	$("#tb-8").classList.add("run");
	packet(70.82, { color: 1, dur: 0.34 });
	openRow($("#b-t8"), 70.96, { dur: 0.34 });
	toolMark("b-t8", "run", 0);
	label($("#b-t8 [data-st]"), (t) => `${Math.max(0, Math.floor((t - 70.96) * 3))}秒`);
	cue("row", 70.8);

	capOut("c9", 71.3);
	linkDraw(71.35, { dur: 0.35, out: true });
	tl.to(term, { x: -980, duration: 0.6, ease: "power3.in" }, 71.4);
	tl.to(phone, { y: PH_SIDE.y + 1100, duration: 0.6, ease: "power3.in" }, 71.4);
	hide([term, phone], 72.0);
}

/* ================= 10. Pi はそのまま、データは PC のまま ================= */

function privacy() {
	const t0 = T.private;
	capIn("c10", t0, { y: 112 });
	show("#dia", t0);
	gsap.set("#dia-pc", { x: 470, y: 435 });
	gsap.set("#dia-ph", { x: 1090, y: 435 });
	ft("#dia-net", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.7, ease: "power3.out" }, t0 + 0.3);
	ft("#dia-pc", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: "back.out(1.6)" }, t0 + 0.5);
	ft("#dia-ph", { autoAlpha: 0, scale: 0.8 }, { autoAlpha: 1, scale: 1, duration: 0.55, ease: "back.out(1.6)" }, t0 + 1.0);
	cue("pop", t0 + 0.5, { i: 0 });
	cue("pop", t0 + 1.0, { i: 2 });
	ft("#dia-link", { opacity: 0 }, { opacity: 1, duration: 0.4 }, t0 + 1.3);
	gsap.set(["#dia-net", "#dia-pc", "#dia-ph", "#dia-link"], { opacity: 0 });
	// PC とスマホの間だけを行き来する
	const pk = [$("#dia-pk1"), $("#dia-pk2")];
	gsap.set(pk[0], { backgroundColor: "var(--blue)" });
	gsap.set(pk[1], { backgroundColor: "var(--yellow)" });
	onFrame((t) => {
		pk.forEach((p, i) => {
			const local = (t - (t0 + 1.5) - i * 0.5) % 1.0;
			const vis = t >= t0 + 1.5 + i * 0.5 && t < 77.3 && local < 0.62;
			const u = ease.inOut3(Math.min(1, Math.max(0, local / 0.62)));
			const x = i === 0 ? lerp(838, 1082, u) : lerp(1082, 838, u);
			p.style.transform = `translate(${x}px, 560px)`;
			p.style.opacity = vis ? Math.min(1, local / 0.08, (0.62 - local) / 0.1) : 0;
		});
	});

	const checks = $$("#checks .check");
	gsap.set("#checks", { y: 838 });
	show("#checks", t0);
	gsap.set(checks, { autoAlpha: 0 });
	checks.forEach((c, i) => {
		const t = t0 + 2.0 + i * 0.5;
		ft(c, { autoAlpha: 0, y: 30, scale: 0.92 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.7)" }, t);
		cue("check", t, { i });
	});

	capOut("c10", 77.25);
	tl.to(["#dia", "#checks"], { opacity: 0, y: "-=24", duration: 0.4, ease: "power2.in" }, 77.3);
	hide(["#dia", "#checks"], 77.8);
}

/* ================= 11. はじめかた ================= */

function setup() {
	const t0 = T.setup;
	capIn("c11", t0, { y: 112 });
	const steps = $$(".step");
	const xs = [150, 700, 1250];
	steps.forEach((s, i) => {
		gsap.set(s, { x: xs[i], y: 400 });
		ft(s, { autoAlpha: 0, y: 460, scale: 0.94 }, { autoAlpha: 1, y: 400, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, t0 + 0.5 + i * 0.5);
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

	capOut("c11", 83.1);
	tl.to(steps, { autoAlpha: 0, y: 360, duration: 0.35, ease: "power2.in", stagger: 0.05 }, 83.1);
	tl.to("#chapters", { opacity: 0, duration: 0.3 }, 83.1);
}

/* ================= 12. 最後のカード ================= */

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
	cue("impact", t0);
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

// 未使用の値を参照（将来の調整用の寸法）
void H;
