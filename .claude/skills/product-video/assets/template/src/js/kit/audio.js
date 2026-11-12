// 曲と効果音を OfflineAudioContext で合成する。音の素材ファイルは使わず、発振器とノイズだけで作る。
//
//   曲     … music.js の「区間の並び」（intro / reveal / groove / peak / calm / build / outro）から自動で編曲する
//   効果音 … 場面を組むときに積んだ合図（cue）の時刻で鳴らす
//
// 作った人（AI）は音を聴けない。だからここの音量や音色は、測って確かめた値にしてある。
// 変えるときは render.mjs --audio --stems … で系統ごとに書き出し、tools/qa.mjs audio で測り直すこと。
import { cues } from "./cue.js";
import { rng } from "./engine.js";

const SR = 48000;
// コンプレッサーの先読みぶん（2 段で約 12 ms）を、書き出すときに前へ詰める
const LATENCY = 0.012;

let BEAT = 0.5;
let BAR = 2;
let STEP = 0.125;
let KEY = 0;
/** MIDI 番号 → 周波数。曲の調（KEY）のぶんだけ全体を移す。 */
const mtof = (m) => 440 * 2 ** ((m + KEY - 69) / 12);

/* ---------------- 和音（ニ長調で書き、KEY で移調する） ---------------- */

const CH = {
	IV: { bass: 43, pad: [59, 62, 66, 69], arp: [71, 74, 78, 81, 83] },
	V: { bass: 45, pad: [61, 64, 66, 71], arp: [69, 73, 76, 78, 83] },
	vi: { bass: 47, pad: [57, 62, 66, 69], arp: [71, 74, 78, 81, 86] },
	I3: { bass: 42, pad: [57, 62, 64, 69], arp: [69, 74, 76, 78, 81] },
	ii: { bass: 40, pad: [55, 59, 62, 66], arp: [67, 71, 74, 78, 83] },
	V3: { bass: 37, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81, 85] },
	I: { bass: 38, pad: [57, 62, 64, 66, 69], arp: [69, 74, 76, 78, 81] },
};
// 旋律（ベル）。和音ごとの 2 小節のひとふし: [拍, MIDI, 拍数]
const PHRASE = {
	IV: [[0, 78, 1.5], [1.5, 81, 1], [3, 83, 3]],
	V: [[0, 81, 2], [2.5, 76, 1], [4, 78, 3]],
	vi: [[0, 86, 1.5], [1.5, 83, 1], [3, 81, 2], [5, 78, 2]],
	I3: [[0, 76, 2], [2, 78, 1], [3, 81, 4]],
};
const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93];

/* ---------------- 部品 ---------------- */

function makeNoise(ctx, seed, seconds = 3) {
	const buf = ctx.createBuffer(2, SR * seconds, SR);
	const r = rng(seed);
	for (let c = 0; c < 2; c++) {
		const d = buf.getChannelData(c);
		for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
	}
	return buf;
}

function makeImpulse(ctx, seed, seconds, tau) {
	const buf = ctx.createBuffer(2, Math.floor(SR * seconds), SR);
	const r = rng(seed);
	for (let c = 0; c < 2; c++) {
		const d = buf.getChannelData(c);
		let lp = 0;
		for (let i = 0; i < d.length; i++) {
			const t = i / SR;
			// 時間がたつほど高い音が先に消える
			const k = 0.75 - 0.6 * Math.min(1, t / seconds);
			lp += k * (r() * 2 - 1 - lp);
			const pre = t < 0.012 ? 0 : 1;
			d[i] = lp * Math.exp(-t / tau) * pre;
		}
	}
	return buf;
}

class Synth {
	constructor(ctx, duration, only) {
		this.ctx = ctx;
		this.duration = duration;
		this.only = only;
		this.noise = makeNoise(ctx, 1234);
		this.r = rng(99);

		// 出力の手前：圧縮 → 持ち上げ → 頭打ち
		const comp = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 12, ratio: 2.2, attack: 0.015, release: 0.25 });
		const makeup = new GainNode(ctx, { gain: 1.3 });
		const limit = new DynamicsCompressorNode(ctx, { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.09 });
		comp.connect(makeup).connect(limit).connect(ctx.destination);
		this.master = comp;

		// 残響
		const verb = new ConvolverNode(ctx, { buffer: makeImpulse(ctx, 7, 2.8, 0.62), disableNormalization: false });
		const verbOut = new GainNode(ctx, { gain: 0.9 });
		verb.connect(verbOut);
		this.verbIn = verb;

		// 曲の束（切断の場面でこもらせるためのフィルターを通す）
		this.music = new GainNode(ctx, { gain: 1 });
		this.muffle = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.5 });
		this.music.connect(this.muffle).connect(this.master);
		verbOut.connect(this.muffle);

		// キックに合わせて沈む束（パッドとベース）
		this.duck = new GainNode(ctx, { gain: 1 });
		this.duck.connect(this.music);
		this.padFilter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 900, Q: 0.6 });
		this.padFilter.connect(this.duck);
		const padVerb = new GainNode(ctx, { gain: 0.5 });
		this.padFilter.connect(padVerb).connect(verb);

		// 付点 8 分のディレイ（左右に振る）
		const dl = new DelayNode(ctx, { delayTime: BEAT * 0.75, maxDelayTime: 1 });
		const dr = new DelayNode(ctx, { delayTime: BEAT * 0.75, maxDelayTime: 1 });
		const fb1 = new GainNode(ctx, { gain: 0.42 });
		const fb2 = new GainNode(ctx, { gain: 0.42 });
		const tone = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 3200 });
		const pl = new StereoPannerNode(ctx, { pan: -0.65 });
		const pr = new StereoPannerNode(ctx, { pan: 0.65 });
		this.delayIn = new GainNode(ctx, { gain: 1 });
		this.delayIn.connect(tone).connect(dl);
		dl.connect(pl).connect(this.music);
		dl.connect(fb1).connect(dr);
		dr.connect(pr).connect(this.music);
		dr.connect(fb2).connect(dl);
		const delayVerb = new GainNode(ctx, { gain: 0.3 });
		pl.connect(delayVerb).connect(verb);
		pr.connect(delayVerb);

		// 効果音の束
		this.sfx = new GainNode(ctx, { gain: 1 });
		this.sfx.connect(this.master);
		this.sfxVerb = new GainNode(ctx, { gain: 1 });
		const sfxVerbOut = new ConvolverNode(ctx, { buffer: makeImpulse(ctx, 21, 1.8, 0.4) });
		const sv = new GainNode(ctx, { gain: 0.8 });
		this.sfxVerb.connect(sfxVerbOut).connect(sv).connect(this.master);
	}

	on(stem) {
		return !this.only || this.only === stem;
	}

	out(dest, pan = 0, gain = 1) {
		const g = new GainNode(this.ctx, { gain });
		if (pan) {
			const p = new StereoPannerNode(this.ctx, { pan });
			g.connect(p).connect(dest);
		} else g.connect(dest);
		return g;
	}

	/** 単純な発振音。周波数は f0 → f1 に滑らせられる。 */
	tone(dest, t, { f, f1, type = "sine", dur = 0.1, gain = 0.1, attack = 0.003, pan = 0, glide, send = 0, detune = 0 }) {
		if (t < 0) return;
		const { ctx } = this;
		const o = new OscillatorNode(ctx, { type, frequency: f, detune });
		if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + (glide ?? dur));
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		const post = this.out(dest, pan);
		g.connect(post);
		if (send) g.connect(this.out(this.sfxVerb, pan, send));
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	/** ノイズ。フィルターの周波数を f0 → f1 に動かせる。shape: 立ち上がりの割合。 */
	hiss(dest, t, { dur = 0.05, gain = 0.1, type = "bandpass", f = 4000, f1, q = 1, attack = 0.002, pan = 0, shape, send = 0, curve = "exp" }) {
		if (t < 0) return;
		const { ctx } = this;
		const src = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
		const filt = new BiquadFilterNode(ctx, { type, frequency: f, Q: q });
		if (f1) {
			filt.frequency.setValueAtTime(f, t);
			filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
		}
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		if (shape !== undefined) {
			// 山なり（whoosh）や右上がり（riser）
			const peak = t + dur * shape;
			if (curve === "exp") {
				g.gain.setValueAtTime(0.0005, t);
				g.gain.exponentialRampToValueAtTime(gain, peak);
			} else g.gain.linearRampToValueAtTime(gain, peak);
			g.gain.linearRampToValueAtTime(0, t + dur);
		} else {
			g.gain.linearRampToValueAtTime(gain, t + attack);
			g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		}
		src.connect(filt).connect(g);
		g.connect(this.out(dest, pan));
		if (send) g.connect(this.out(this.sfxVerb, pan, send));
		src.start(t, this.r() * 2);
		src.stop(t + dur + 0.02);
	}

	/** ベル（FM）。澄んだ短い音。 */
	bell(dest, t, m, { gain = 0.12, dur = 1.2, pan = 0, send = 0.35, ratio = 2, index = 1.4, verb } = {}) {
		if (t < 0) return;
		const { ctx } = this;
		const f = mtof(m);
		const car = new OscillatorNode(ctx, { type: "sine", frequency: f });
		const mod = new OscillatorNode(ctx, { type: "sine", frequency: f * ratio });
		const mg = new GainNode(ctx, { gain: f * index });
		mg.gain.setValueAtTime(f * index, t);
		mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.35);
		mod.connect(mg).connect(car.frequency);
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.004);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		car.connect(g);
		g.connect(this.out(dest, pan));
		g.connect(this.out(verb ?? this.sfxVerb, pan, send));
		car.start(t);
		mod.start(t);
		car.stop(t + dur + 0.05);
		mod.stop(t + dur + 0.05);
	}

	/** はじく音（アルペジオ）。 */
	pluck(t, m, { gain = 0.13, dur = 0.32, bright = 1, pan = 0, delay = 0.5 } = {}) {
		if (t < 0) return;
		const { ctx } = this;
		const f = mtof(m);
		const o1 = new OscillatorNode(ctx, { type: "sawtooth", frequency: f, detune: -6 });
		const o2 = new OscillatorNode(ctx, { type: "triangle", frequency: f, detune: 7 });
		const filt = new BiquadFilterNode(ctx, { type: "lowpass", Q: 1.2 });
		filt.frequency.setValueAtTime(Math.min(11000, f * 7 * bright), t);
		filt.frequency.exponentialRampToValueAtTime(Math.max(400, f * 1.7), t + dur * 0.6);
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.003);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		const mix1 = new GainNode(ctx, { gain: 0.55 });
		o1.connect(mix1).connect(filt);
		o2.connect(filt);
		filt.connect(g);
		g.connect(this.out(this.music, pan));
		g.connect(this.out(this.delayIn, 0, delay));
		for (const o of [o1, o2]) {
			o.start(t);
			o.stop(t + dur + 0.05);
		}
	}

	kick(t, gain = 0.42) {
		if (t < 0) return;
		const { ctx } = this;
		const o = new OscillatorNode(ctx, { type: "sine", frequency: 150 });
		o.frequency.setValueAtTime(150, t);
		o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.002);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
		o.connect(g).connect(this.music);
		o.start(t);
		o.stop(t + 0.32);
		this.hiss(this.music, t, { dur: 0.012, gain: gain * 0.12, type: "highpass", f: 2500 });
		// パッドとベースを沈める
		this.duck.gain.setTargetAtTime(0.5, t, 0.006);
		this.duck.gain.setTargetAtTime(1, t + 0.07, 0.085);
	}

	hat(t, { gain = 0.06, open = false, pan = 0.15 } = {}) {
		this.hiss(this.music, t, { dur: open ? 0.22 : 0.045, gain, type: "highpass", f: 7800, q: 0.7, pan });
	}

	rim(t, gain = 0.13) {
		this.hiss(this.music, t, { dur: 0.07, gain, type: "bandpass", f: 1900, q: 2.2, pan: -0.1, send: 0 });
		this.tone(this.music, t, { f: 420, f1: 300, dur: 0.035, gain: gain * 0.6 });
	}

	clap(t, gain = 0.16) {
		for (const [d, k] of [[0, 0.6], [0.011, 0.7], [0.023, 1]]) this.hiss(this.music, t + d, { dur: d > 0.02 ? 0.16 : 0.02, gain: gain * k, type: "bandpass", f: 1300, q: 1.1 });
		this.hiss(this.verbIn, t + 0.023, { dur: 0.12, gain: gain * 0.35, type: "bandpass", f: 1500, q: 1 });
	}

	bass(t, m, dur, gain = 0.42) {
		if (t < 0) return;
		const { ctx } = this;
		const f = mtof(m);
		const sub = new OscillatorNode(ctx, { type: "sine", frequency: f / 2 });
		const body = new OscillatorNode(ctx, { type: "triangle", frequency: f });
		const edge = new OscillatorNode(ctx, { type: "sawtooth", frequency: f });
		const filt = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 520, Q: 0.8 });
		filt.frequency.setValueAtTime(900, t);
		filt.frequency.exponentialRampToValueAtTime(380, t + 0.18);
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + 0.008);
		g.gain.setTargetAtTime(gain * 0.72, t + 0.02, 0.08);
		g.gain.setTargetAtTime(0, t + dur, 0.03);
		const es = new GainNode(ctx, { gain: 0.22 });
		const ss = new GainNode(ctx, { gain: 0.7 });
		sub.connect(ss).connect(g);
		body.connect(filt);
		edge.connect(es).connect(filt);
		filt.connect(g);
		g.connect(this.duck);
		for (const o of [sub, body, edge]) {
			o.start(t);
			o.stop(t + dur + 0.3);
		}
	}

	pad(t, dur, notes, { gain = 0.03, attack = 0.5, release = 0.9 } = {}) {
		const { ctx } = this;
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(gain, t + attack);
		g.gain.setTargetAtTime(0, t + dur, release / 3);
		g.connect(this.padFilter);
		notes.forEach((m, i) => {
			for (const [det, pan] of [[-8, -0.7], [9, 0.7]]) {
				const o = new OscillatorNode(ctx, { type: "sawtooth", frequency: mtof(m), detune: det + (i - 1.5) * 1.5 });
				const p = new StereoPannerNode(ctx, { pan: pan * (0.5 + 0.12 * i) });
				o.connect(p).connect(g);
				o.start(t);
				o.stop(t + dur + release * 2);
			}
		});
	}

	/** 低い一撃と、きらめき。 */
	impact(t, gain = 1) {
		const { ctx } = this;
		const o = new OscillatorNode(ctx, { type: "sine", frequency: 90 });
		o.frequency.setValueAtTime(90, t);
		o.frequency.exponentialRampToValueAtTime(36, t + 0.5);
		const g = new GainNode(ctx, { gain: 0 });
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(0.5 * gain, t + 0.004);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
		o.connect(g).connect(this.sfx);
		o.start(t);
		o.stop(t + 1.4);
		this.hiss(this.sfx, t, { dur: 0.5, gain: 0.16 * gain, type: "lowpass", f: 500, q: 0.5 });
		this.hiss(this.sfx, t, { dur: 0.9, gain: 0.055 * gain, type: "highpass", f: 6000, send: 0.6 });
	}
}

/* ---------------- 編曲 ---------------- */

const CYCLE = ["IV", "V", "vi", "I3"];

/** 区間の並びから、小節ごとの和音を決める。 */
function harmony(plan) {
	const bars = [];
	let g = 0;
	let prev = "";
	for (const sec of plan.sections) {
		const a = Math.round(sec.from / BAR);
		const n = Math.round(sec.to / BAR) - a;
		if (sec.type === "groove" && prev !== "groove") g = 0;
		for (let k = 0; k < n; k++) {
			let name = "I";
			if (sec.type === "intro") name = "vi";
			else if (sec.type === "reveal") name = k < Math.ceil((n * 2) / 3) ? "IV" : "V";
			else if (sec.type === "groove") name = CYCLE[Math.floor(g++ / 2) % 4];
			else if (sec.type === "peak") name = CYCLE[k % 4];
			else if (sec.type === "calm") name = ["IV", "I3", "ii", "V"][k % 4];
			else if (sec.type === "build") name = ["V3", "vi", "V", "IV"][(n - 1 - k) % 4];
			bars[a + k] = name;
		}
		prev = sec.type;
	}
	return bars;
}

// パッドの明るさ（ローパスの周波数）: 区間の頭 → 終わり
const BRIGHT = { intro: [520, 1350], reveal: [2750, 1900], groove: [2100, 2700], peak: [3500, 2800], calm: [1900, 2250], build: [2250, 4250], outro: [3500, 1750] };
const HIT = { reveal: 1, peak: 0.75, outro: 1.05 };

function compose(s, plan) {
	const secs = plan.sections;
	const end = secs[secs.length - 1].to;
	const bars = harmony(plan);
	const nameAt = (t) => bars[Math.min(bars.length - 1, Math.floor(t / BAR + 1e-6))];
	const secAt = (t) => secs.find((x) => t >= x.from - 1e-6 && t < x.to - 1e-6);

	// パッドの明るさと、和音
	const pf = s.padFilter.frequency;
	pf.setValueAtTime(BRIGHT[secs[0].type][0], 0);
	for (const sec of secs) {
		const [a, b] = BRIGHT[sec.type];
		pf.setValueAtTime(a, sec.from);
		pf.linearRampToValueAtTime(b, sec.to - 0.02);
	}
	if (s.on("pad")) {
		for (const sec of secs) {
			const len = sec.to - sec.from;
			if (sec.type === "intro") {
				// 暗い和音（短調に 9 度を足した濁り）と、低い持続音
				s.pad(sec.from + 0.4, len - 0.95, [59, 61, 62, 66], { gain: 0.022, attack: Math.min(2.6, len * 0.4), release: 0.35 });
				s.pad(sec.from + 0.2, len - 0.6, [35, 47], { gain: 0.028, attack: Math.min(1.8, len * 0.3), release: 0.3 });
				continue;
			}
			for (let t = sec.from; t < sec.to - 1e-6; ) {
				const name = nameAt(t);
				let u = t + BAR;
				while (u < sec.to - 1e-6 && nameAt(u) === name) u += BAR;
				const first = t === sec.from && (sec.hit || sec.type === "outro");
				const final = sec.type === "outro";
				s.pad(t, u - t - (final ? 1.6 : 0.05), CH[name].pad, { gain: sec.type === "reveal" ? 0.022 : sec.type === "calm" ? 0.024 : 0.019, attack: first ? 0.06 : 0.35, release: final ? 2.4 : 0.9 });
				if (s.on("bass") && sec.type === "reveal") s.bass(t, CH[name].bass, u - t - 0.2, 0.072);
				t = u;
			}
		}
	}

	const wave = [0, 2, 1, 3, 2, 4, 3, 1];
	for (let k = 0; k * STEP < end - 1e-6; k++) {
		const t = k * STEP;
		const i = k % 16;
		const bar = Math.floor(k / 16);
		const sec = secAt(t);
		if (!sec) continue;
		const type = sec.type;
		const len = sec.to - sec.from;
		const p = (t - sec.from) / len;
		const ch = CH[nameAt(t)];
		const lastBar = t >= sec.to - BAR - 1e-6;
		const tail = type === "outro" && t >= sec.to - 2 - 1e-6;
		const pan = ((i % 4) - 1.5) * 0.18;

		if (s.on("drums")) {
			if (type === "groove") {
				if (i === 0 || i === 6 || i === 8 || (i === 14 && bar % 2 === 1)) s.kick(t, i === 0 ? 0.42 : 0.35);
				if (i === 4 || i === 12) s.rim(t, 0.105);
				if (i % 2 === 0) s.hat(t, { gain: i % 4 === 2 ? 0.075 : 0.044 });
				if (sec.melody && i === 14 && bar % 4 === 3) s.hat(t, { gain: 0.055, open: true });
			} else if (type === "peak") {
				if (i % 4 === 0) s.kick(t, 0.42);
				if (i === 4 || i === 12) s.clap(t, 0.12);
				if (i % 4 === 2) s.hat(t, { gain: 0.064, open: true });
				s.hat(t, { gain: i % 2 ? 0.024 : 0.036, pan: -0.2 });
			} else if (type === "build") {
				if (i % 4 === 0) s.kick(t, 0.3 + 0.12 * p);
				if (i % 2 === 0) s.hat(t, { gain: 0.036 + 0.034 * p });
				if (p >= 0.33 && (i === 4 || i === 12)) s.rim(t, 0.1);
			} else if (type === "outro" && !tail && len >= 4) {
				if (i === 0 || i === 8) s.kick(t, 0.36);
				if (i % 2 === 0) s.hat(t, { gain: i % 4 === 2 ? 0.06 : 0.034 });
				if (i === 4 || i === 12) s.rim(t, 0.09);
			} else if (type === "reveal" && lastBar) {
				if (i % 2 === 0) s.hat(t, { gain: 0.022 + 0.034 * (i / 16) });
			} else if (type === "calm" && lastBar) {
				if (i % 4 === 2) s.hat(t, { gain: 0.036 });
			}
		}

		if (s.on("bass")) {
			if (type === "groove") {
				if (i === 0) s.bass(t, ch.bass, 0.62, 0.088);
				if (i === 6) s.bass(t, ch.bass, 0.2, 0.076);
				if (i === 8) s.bass(t, ch.bass, 0.45, 0.084);
				if (i === 14 && bar % 2 === 1) s.bass(t, ch.bass + 12, 0.16, 0.064);
			} else if (type === "peak" || type === "build") {
				if (i % 4 === 0) s.bass(t, ch.bass, 0.2, 0.084);
				if (i % 4 === 2) s.bass(t, ch.bass + 12, 0.14, 0.056);
			} else if (type === "outro") {
				if (t === sec.from) s.bass(t, ch.bass, Math.max(1, Math.min(3.6, len - 2.4)), 0.08);
				if (Math.abs(t - (sec.to - 2)) < 1e-6) s.bass(t, ch.bass, 1.4, 0.068);
				if (!tail && len >= 4 && (i === 0 || i === 8)) s.bass(t, ch.bass, 0.5, 0.076);
			} else if (type === "calm" && i === 0) s.bass(t, ch.bass, BAR - 0.3, 0.064);
		}

		if (s.on("arp")) {
			if (type === "reveal") {
				const a = sec.from + len / 3;
				const q = (t - a) / (sec.to - a);
				if (q >= 0 && i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: 0.065 + 0.065 * q, bright: 0.7 + 0.3 * q, pan });
			} else if (type === "groove") {
				if (i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: sec.melody ? 0.15 : 0.13, bright: sec.melody ? 1 : 0.85, pan });
			} else if (type === "peak") s.pluck(t, ch.arp[[0, 1, 2, 3, 4, 3, 2, 1][i % 8]], { gain: i % 2 ? 0.09 : 0.14, dur: 0.22, bright: 1.25, pan });
			else if (type === "calm") {
				if (i % 4 === 0) s.pluck(t, ch.arp[wave[i / 4]], { gain: 0.12, dur: 0.5, bright: 0.8, pan, delay: 0.7 });
			} else if (type === "build") {
				if (lastBar || i % 2 === 0) s.pluck(t, ch.arp[wave[(lastBar ? i : i / 2) % 8]], { gain: 0.11 + 0.05 * p, dur: 0.26, bright: 0.9 + 0.5 * p, pan });
			} else if (type === "outro" && !tail && i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: 0.145 * (1 - p), bright: 1.1, pan });
		}
	}

	if (s.on("melody")) {
		const bell = (t, m, beats, gain = 0.15) => s.bell(s.music, t, m, { gain, dur: Math.max(0.9, beats * BEAT * 1.3), pan: 0.1, send: 0.5, verb: s.verbIn });
		for (const sec of secs) {
			if (sec.type === "groove" && sec.melody) {
				for (let t = sec.from; t < sec.to - 1e-6; ) {
					const name = nameAt(t);
					let u = t + BAR;
					while (u < sec.to - 1e-6 && nameAt(u) === name && u - t < 2 * BAR - 1e-6) u += BAR;
					for (const [beat, m, beats] of PHRASE[name] ?? []) if (t + beat * BEAT < u - 1e-6) bell(t + beat * BEAT, m, beats);
					t = u;
				}
			} else if (sec.type === "calm") {
				for (let t = sec.from; t < sec.to - 1e-6; t += BAR) bell(t, CH[nameAt(t)].arp[2], 2, 0.13);
			} else if (sec.type === "outro") {
				if (sec.to - sec.from >= 5) for (const [beat, m] of [[0, 81], [1, 78], [2, 74], [4, 76], [5, 78], [6, 81]]) if (sec.from + beat * BEAT < sec.to - 2.2) bell(sec.from + beat * BEAT, m, 1, 0.16);
				bell(sec.to - 2, 86, 4, 0.16);
			}
		}
	}

	if (s.on("fx")) {
		const riser = (t0, t1, gain) => {
			s.hiss(s.sfx, t0, { dur: t1 - t0, gain, type: "bandpass", f: 400, f1: 7000, q: 1.3, shape: 0.985, send: 0.3 });
			s.hiss(s.sfx, Math.max(t0, t1 - 0.9), { dur: Math.min(0.9, t1 - t0), gain: gain * 0.9, type: "highpass", f: 5200, shape: 0.99 });
		};
		// 細かい連打で盛り上げる
		const roll = (t0, t1) => {
			for (let t = t0; t < t1 - 1e-6; t += t > t1 - 0.5 ? STEP / 2 : STEP) s.hiss(s.music, t, { dur: 0.05, gain: 0.02 + 0.065 * ((t - t0) / (t1 - t0)) ** 2, type: "bandpass", f: 2100, q: 1.4 });
		};
		secs.forEach((sec, n) => {
			const prev = secs[n - 1];
			const next = secs[n + 1];
			if (sec.type === "intro") for (let t = sec.from + BAR; t < sec.to - 1.6; t += BEAT) s.tone(s.sfx, t, { f: 62, f1: 44, dur: 0.24, gain: 0.15, attack: 0.004 });
			if (sec.hit && prev) {
				riser(Math.max(prev.from, sec.from - 2.2), sec.from, 0.075);
				s.impact(sec.from, HIT[sec.type] ?? 0.7);
				if (sec.type === "peak" && prev.type !== "build") roll(Math.max(prev.from, sec.from - 2), sec.from - 0.5);
			} else if (prev && (sec.type === "groove" || sec.type === "calm")) s.hiss(s.sfx, sec.from, { dur: 0.7, gain: 0.05, type: "highpass", f: 6500, send: 0.5 });
			if (sec.type === "build") roll(Math.max(sec.from, sec.to - 1.5), sec.to);
			if (sec.type === "reveal" && next?.type === "groove") roll(sec.to - 0.5, sec.to);
			if (sec.type === "outro") {
				for (const [m, pan] of [[62, -0.3], [69, 0.3], [74, 0], [78, 0.2]]) s.bell(s.sfx, sec.from, m, { gain: 0.1, dur: 2.6, pan, send: 0.6 });
				for (const [m, pan] of [[62, -0.3], [69, 0.3], [78, 0]]) s.bell(s.sfx, sec.to - 2, m, { gain: 0.085, dur: 2.2, pan, send: 0.7 });
			}
		});
	}

	// 終わりに向けて曲を絞る
	const mg = s.music.gain;
	mg.setValueAtTime(0.9, 0);
	mg.setValueAtTime(0.9, Math.max(0, end - 3.5));
	mg.linearRampToValueAtTime(0.75, end - 2);
	mg.linearRampToValueAtTime(0, end - 0.25);

	// こもらせる区間（通信が切れる場面など）
	for (const [a, b] of plan.muffle ?? []) {
		const f = s.muffle.frequency;
		f.setValueAtTime(20000, a);
		f.exponentialRampToValueAtTime(420, a + 0.3);
		f.setValueAtTime(420, b - 0.05);
		f.exponentialRampToValueAtTime(20000, b + 0.4);
	}
	return end;
}

/* ---------------- 効果音 ---------------- */

// 合図の一覧は references/audio.md にある。pan は -1（左）〜 1（右）。画面の左右に合わせると、どこで起きたかが伝わる。
function effects(s) {
	if (!s.on("sfx")) return;
	const x = s.sfx;
	const r = rng(4242);
	for (const c of cues) {
		const t = c.t;
		const pan = c.pan ?? 0;
		switch (c.type) {
			case "row": // 一覧やログに 1 行出る（hi: true で 1 オクターブ上。2 つの画面を呼び交わすときに使う）
				s.tone(x, t, { f: mtof(c.hi ? 81 : 62), dur: c.hi ? 0.09 : 0.07, gain: c.soft ? 0.035 : 0.05, pan, type: c.hi ? "sine" : "triangle", send: c.hi ? 0.2 : 0 });
				if (!c.hi) s.hiss(x, t, { dur: 0.02, gain: 0.02, f: 3000, pan });
				break;
			case "blip":
				s.tone(x, t, { f: mtof(86), dur: 0.08, gain: 0.03, pan });
				break;
			case "tap": // 指で押す
				s.tone(x, t, { f: 210, f1: 120, dur: 0.05, gain: 0.09, pan });
				s.hiss(x, t, { dur: 0.012, gain: 0.05, type: "highpass", f: 3000, pan });
				break;
			case "click": // マウスで押す
				s.hiss(x, t, { dur: 0.016, gain: 0.07, f: 2400, q: 2, pan });
				s.tone(x, t, { f: 300, f1: 200, dur: 0.03, gain: 0.05, pan });
				break;
			case "type": {
				// 文字を打つ。key: true はキーボード（低め）、なければスマホ（軽め）
				for (let i = 0; i < c.n; i++) {
					const tt = t + (c.dur * i) / c.n + (r() - 0.5) * 0.012;
					if (c.key) s.hiss(x, tt, { dur: 0.022, gain: 0.035 + r() * 0.02, f: 1900 + r() * 700, q: 1.5, pan });
					else s.hiss(x, tt, { dur: 0.014, gain: 0.028 + r() * 0.015, f: 3600 + r() * 900, q: 2, pan });
				}
				break;
			}
			case "enter":
				s.hiss(x, t, { dur: 0.04, gain: 0.07, f: 1500, q: 1.2, pan });
				s.tone(x, t, { f: 160, f1: 110, dur: 0.05, gain: 0.08, pan });
				break;
			case "send":
				s.tone(x, t, { f: 520, f1: 1040, dur: 0.11, gain: 0.07, pan, send: 0.3 });
				break;
			case "ask": // 問いかけ（解決しない上行）
				s.bell(x, t, 78, { gain: 0.06, dur: 0.9, pan });
				s.bell(x, t + 0.13, 83, { gain: 0.06, dur: 1.3, pan });
				break;
			case "confirm": // 決定・回答
				s.bell(x, t, 81, { gain: 0.09, dur: 0.7, pan });
				s.bell(x, t + 0.09, 86, { gain: 0.1, dur: 1.1, pan });
				break;
			case "done": // 作業の完了
				s.bell(x, t, 81, { gain: 0.07, dur: 1, pan });
				s.bell(x, t + 0.1, 85, { gain: 0.07, dur: 1.3, pan });
				break;
			case "success":
				[74, 78, 81, 86].forEach((m, i) => s.bell(x, t + i * 0.065, m, { gain: 0.1, dur: 1.2, pan, send: 0.5 }));
				break;
			case "error": // 失敗・切断（下がる音）
				s.tone(x, t, { f: 620, f1: 130, dur: 0.42, gain: 0.11, type: "triangle", send: 0.3, pan });
				s.hiss(x, t, { dur: 0.3, gain: 0.05, f: 2400, f1: 300, q: 1, pan });
				break;
			case "connect": // つながる・復帰（上がる音）
				s.tone(x, t, { f: 220, f1: 880, dur: 0.3, gain: 0.07, type: "triangle", send: 0.3, pan });
				[81, 85, 88].forEach((m, i) => s.bell(x, t + 0.2 + i * 0.07, m, { gain: 0.1, dur: 1.2, pan, send: 0.5 }));
				break;
			case "launch":
				s.tone(x, t, { f: 330, f1: 1320, dur: 0.3, gain: 0.06, pan, send: 0.4 });
				s.bell(x, t + 0.22, 85, { gain: 0.09, dur: 1.2, pan });
				break;
			case "notify": // スマホの通知
				s.bell(x, t, 81, { gain: 0.12, dur: 0.9, send: 0.5, index: 1.8, pan });
				s.bell(x, t + 0.14, 86, { gain: 0.13, dur: 1.6, send: 0.5, index: 1.8, pan });
				break;
			case "buzz": // バイブレーション
				for (const d of [0, 0.19]) {
					s.tone(x, t + d, { f: 165, type: "square", dur: 0.13, gain: 0.035, attack: 0.01 });
					s.tone(x, t + d, { f: 82.5, type: "sine", dur: 0.13, gain: 0.09, attack: 0.01 });
				}
				break;
			case "timelapse": {
				// 時計の刻みが速くなっていく
				let tt = t;
				let gap = 0.26;
				let k = 0;
				while (tt < t + c.dur) {
					const p = (tt - t) / c.dur;
					s.hiss(x, tt, { dur: 0.012, gain: 0.03 + 0.05 * p, f: k % 2 ? 2600 : 3300, q: 4, pan: (k % 2 ? 1 : -1) * 0.25, send: 0.2 });
					gap = Math.max(0.045, gap * 0.93);
					tt += gap;
					k++;
				}
				break;
			}
			case "wipe":
				s.hiss(x, t, { dur: c.dur + 0.12, gain: 0.13, f: 500, f1: 5200, q: 0.9, shape: 0.8, curve: "lin", send: 0.3 });
				break;
			case "whoosh":
				s.hiss(x, t, { dur: 0.5, gain: 0.05, f: 700, f1: 2400, q: 0.8, shape: 0.45, curve: "lin", pan });
				break;
			case "logoHit": {
				// ロゴの部品がはまる。部品が複数なら、はまるたびに音が上がっていく
				const notes = [74, 78, 81, 86, 90, 93];
				if ((c.n ?? 1) > 1) s.pluck(t, notes[c.i % notes.length], { gain: 0.14, dur: 0.6, bright: 1.4, delay: 0.6 });
				else for (const m of [74, 81, 86]) s.pluck(t, m, { gain: 0.1, dur: 0.7, bright: 1.4, delay: 0.6 });
				s.tone(x, t, { f: 120, f1: 60, dur: 0.12, gain: 0.12 });
				if (c.i === (c.n ?? 1) - 1) s.hiss(x, t, { dur: 1.1, gain: 0.06, type: "highpass", f: 7000, send: 0.7 });
				break;
			}
			case "swell":
				for (const [m, p2] of [[74, -0.3], [81, 0.3]]) s.bell(x, t + 0.1, m, { gain: 0.07, dur: 2.2, pan: p2, send: 0.7 });
				break;
			case "tag":
				s.bell(x, t, 86, { gain: 0.06, dur: 1.8, send: 0.7 });
				s.bell(x, t + 0.08, 90, { gain: 0.045, dur: 1.8, send: 0.7, pan: 0.3 });
				break;
			case "stream": // 文章が流れてくる
				for (let tt = t; tt < t + c.dur; tt += 0.034) s.hiss(x, tt, { dur: 0.01, gain: 0.012 + r() * 0.008, f: 4200, q: 3, pan });
				break;
			case "cascade": // 行が順に出る（音階を上る）
				for (let i = 0; i < c.n; i++) s.tone(x, t + i * c.step, { f: mtof(PENTA[i % PENTA.length] - 12), dur: 0.08, gain: 0.03, pan, send: 0.3 });
				break;
			case "pop": // 部品が弾んで出る。i を 0,1,2… と増やすと音階を上る
				s.tone(x, t, { f: 300, f1: 620, dur: 0.07, gain: 0.07, pan });
				s.bell(x, t, PENTA[(c.i ?? 0) % PENTA.length], { gain: 0.085, dur: 0.8, pan: c.pan ?? (((c.i ?? 0) % 4) - 1.5) * 0.3, send: 0.45 });
				break;
			case "tick":
				s.hiss(x, t, { dur: 0.015, gain: 0.05, f: 3000, q: 3, pan });
				break;
			case "check":
				s.bell(x, t, [78, 81, 86][(c.i ?? 0) % 3], { gain: 0.11, dur: 1.3, pan: c.pan ?? ((c.i ?? 0) - 1) * 0.4, send: 0.6 });
				s.tone(x, t, { f: 300, f1: 620, dur: 0.07, gain: 0.05 });
				break;
			case "scan":
				s.tone(x, t, { f: 900, f1: 1500, dur: c.dur / 2, glide: c.dur / 2, gain: 0.02, attack: 0.05 });
				s.tone(x, t + c.dur / 2, { f: 1500, f1: 900, dur: c.dur / 2, glide: c.dur / 2, gain: 0.02, attack: 0.05 });
				break;
			default:
				console.warn(`[kit] 知らない合図です: ${c.type}`);
		}
	}
}

/* ---------------- 書き出し ---------------- */

function encodeWav(buf, skip) {
	const n = buf.length - skip;
	const ch = [buf.getChannelData(0), buf.getChannelData(1)];
	let peak = 0;
	for (const d of ch) for (let i = skip; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
	const norm = peak > 0.89 ? 0.89 / peak : 1;
	const bytes = new Uint8Array(44 + n * 6);
	const v = new DataView(bytes.buffer);
	const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, "RIFF");
	v.setUint32(4, 36 + n * 6, true);
	str(8, "WAVEfmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 2, true);
	v.setUint32(24, SR, true);
	v.setUint32(28, SR * 6, true);
	v.setUint16(32, 6, true);
	v.setUint16(34, 24, true);
	str(36, "data");
	v.setUint32(40, n * 6, true);
	let o = 44;
	for (let i = 0; i < n; i++) {
		for (let c = 0; c < 2; c++) {
			const x = Math.max(-1, Math.min(1, ch[c][i + skip] * norm));
			const q = Math.round(x * 8388607);
			v.setUint8(o, q & 255);
			v.setUint8(o + 1, (q >> 8) & 255);
			v.setUint8(o + 2, (q >> 16) & 255);
			o += 3;
		}
	}
	return { bytes, peak };
}

let wav = null;

/** 区間が小節の頭に乗っているか、すき間がないかを確かめる。 */
export function checkPlan(plan) {
	const problems = [];
	const bar = 240 / plan.bpm;
	plan.sections.forEach((sec, i) => {
		for (const k of ["from", "to"]) if (Math.abs(sec[k] / bar - Math.round(sec[k] / bar)) > 1e-6) problems.push(`区間 ${i}（${sec.type}）の ${k}=${sec[k]} が小節の頭（${bar} 秒の倍数）にありません`);
		if (i && Math.abs(plan.sections[i - 1].to - sec.from) > 1e-6) problems.push(`区間 ${i - 1} と ${i} の間にすき間か重なりがあります`);
		if (!BRIGHT[sec.type]) problems.push(`区間 ${i} の type「${sec.type}」は使えません（intro / reveal / groove / peak / calm / build / outro）`);
	});
	return problems;
}

/** 合成して WAV（24 bit）を作り、大きさ（バイト）を返す。only で 1 系統だけにできる。 */
export async function render(plan, only) {
	for (const p of checkPlan(plan)) console.warn(`[music] ${p}`);
	BEAT = 60 / plan.bpm;
	BAR = BEAT * 4;
	STEP = BEAT / 4;
	KEY = plan.key ?? 0;
	const duration = plan.sections[plan.sections.length - 1].to;
	const skip = Math.round(LATENCY * SR);
	const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR) + skip, SR);
	const s = new Synth(ctx, duration, only);
	compose(s, plan);
	effects(s);
	const buf = await ctx.startRendering();
	const { bytes, peak } = encodeWav(buf, skip);
	wav = bytes;
	return { size: bytes.length, peak };
}

/** 作った WAV を、base64 の断片で渡す（一度に渡すと大きすぎるため）。 */
export function chunk(offset, size) {
	const part = wav.subarray(offset, offset + size);
	let bin = "";
	for (let i = 0; i < part.length; i += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
	return btoa(bin);
}
