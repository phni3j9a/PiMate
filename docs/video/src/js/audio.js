// 音楽と効果音を OfflineAudioContext で合成する。素材は使わず、発振器とノイズだけで作る。
// 曲は 120 BPM・ニ長調。効果音はシーンが積んだ合図（cues）の時刻で鳴らす。
import { BAR, BEAT, cues } from "./cues.js";
import { rng } from "./engine.js";

const SR = 48000;
const STEP = BEAT / 4;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
// コンプレッサーの先読みぶん（2 段で約 12 ms）を、書き出すときに前へ詰める
const LATENCY = 0.012;

/* ---------------- 和音と構成 ---------------- */

const CH = {
	G: { bass: 43, pad: [59, 62, 66, 69], arp: [71, 74, 78, 81, 83] },
	A: { bass: 45, pad: [61, 64, 66, 71], arp: [69, 73, 76, 78, 83] },
	Bm: { bass: 47, pad: [57, 62, 66, 69], arp: [71, 74, 78, 81, 86] },
	Df: { bass: 42, pad: [57, 62, 64, 69], arp: [69, 74, 76, 78, 81] },
	Em: { bass: 40, pad: [55, 59, 62, 66], arp: [67, 71, 74, 78, 83] },
	Ac: { bass: 37, pad: [57, 61, 64, 69], arp: [69, 73, 76, 81, 85] },
	D: { bass: 38, pad: [57, 62, 64, 66, 69], arp: [69, 74, 76, 78, 81] },
};

/** [開始, 終了, 和音] */
const CHORDS = [
	[8, 12, "G"], [12, 14, "A"],
	[14, 18, "G"], [18, 22, "A"], [22, 26, "Bm"], [26, 30, "Df"],
	[30, 34, "G"], [34, 38, "A"], [38, 42, "Bm"], [42, 46, "Df"],
	[46, 50, "G"], [50, 54, "A"], [54, 56, "Bm"], [56, 58, "Ac"],
	[58, 60, "G"], [60, 62, "A"], [62, 64, "Bm"], [64, 66, "Df"],
	[66, 70, "Em"], [70, 72, "A"],
	[72, 74, "G"], [74, 76, "Df"], [76, 77, "Em"], [77, 78, "A"],
	[78, 80, "G"], [80, 82, "A"], [82, 83, "Bm"], [83, 84, "Ac"],
	[84, 90, "D"],
];
const chordAt = (t) => CH[(CHORDS.find(([a, b]) => t >= a - 1e-6 && t < b - 1e-6) ?? CHORDS[0])[2]];

/** 旋律（ベル）。[時刻, MIDI, 長さ] */
const MELODY = [];
{
	const phrase = {
		G: [[0, 78, 1.5], [1.5, 81, 1], [3, 83, 3]],
		A: [[0, 81, 2], [2.5, 76, 1], [4, 78, 3]],
		Bm: [[0, 86, 1.5], [1.5, 83, 1], [3, 81, 2], [5, 78, 2]],
		Df: [[0, 76, 2], [2, 78, 1], [3, 81, 4]],
	};
	for (const [a, , name] of CHORDS) {
		if (a < 30 || a >= 54 || !phrase[name]) continue;
		for (const [beat, m, len] of phrase[name]) MELODY.push([a + beat * BEAT, m, len * BEAT]);
	}
	// 静かな場面と、最後のひとふし
	MELODY.push([72, 78, 1], [73, 81, 1], [76, 79, 0.5], [76.5, 78, 0.5], [77, 76, 1]);
	MELODY.push([84, 81, 0.5], [84.5, 78, 0.5], [85, 74, 1], [86, 76, 0.5], [86.5, 78, 0.5], [87, 81, 1], [88, 86, 2]);
}

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

/* ---------------- 曲 ---------------- */

function music(s) {
	const { ctx } = s;
	const pf = s.padFilter.frequency;
	// パッドの明るさ：冒頭は暗く、進むにつれて開く
	pf.setValueAtTime(500, 0);
	pf.linearRampToValueAtTime(1400, 6.4);
	pf.linearRampToValueAtTime(900, 7.9);
	pf.setValueAtTime(2750, 8);
	pf.linearRampToValueAtTime(1900, 14);
	pf.linearRampToValueAtTime(2400, 30);
	pf.linearRampToValueAtTime(2900, 46);
	pf.linearRampToValueAtTime(2500, 56);
	pf.linearRampToValueAtTime(4500, 58);
	pf.setValueAtTime(3500, 58);
	pf.linearRampToValueAtTime(2750, 66);
	pf.linearRampToValueAtTime(1900, 72);
	pf.linearRampToValueAtTime(2250, 78);
	pf.linearRampToValueAtTime(4250, 84);
	pf.setValueAtTime(3500, 84);
	pf.linearRampToValueAtTime(1750, 90);

	if (s.on("pad")) {
		// 冒頭：ロ短調の暗い和音と低い持続音
		s.pad(0.4, 7.45, [59, 61, 62, 66], { gain: 0.022, attack: 2.6, release: 0.35 });
		s.pad(0.2, 7.6, [35, 47], { gain: 0.028, attack: 1.8, release: 0.3 });
		for (const [a, b, name] of CHORDS) {
			const final = name === "D";
			s.pad(a, b - a - (final ? 1.6 : 0.05), CH[name].pad, { gain: a < 14 ? 0.022 : a >= 72 && a < 78 ? 0.024 : 0.019, attack: a === 8 || final ? 0.06 : 0.35, release: final ? 2.4 : 0.9 });
		}
	}

	// 低い持続音（ロゴの場面と最後）
	if (s.on("bass")) {
		s.bass(8, 43, 3.8, 0.072);
		s.bass(12, 45, 1.8, 0.072);
		s.bass(84, 38, 3.6, 0.08);
		s.bass(88, 38, 1.4, 0.068);
	}

	const groove = (t) => (t >= 14 && t < 56) || (t >= 66 && t < 72);
	const montage = (t) => t >= 58 && t < 66;
	const build = (t) => t >= 78 && t < 84;
	const outro = (t) => t >= 84 && t < 88;

	for (let bar = 0; bar * BAR < 90; bar++) {
		const b0 = bar * BAR;
		for (let i = 0; i < 16; i++) {
			const t = b0 + i * STEP;
			const ch = chordAt(t);

			/* 打楽器 */
			if (s.on("drums")) {
				if (groove(t)) {
					if (i === 0 || i === 6 || i === 8 || (i === 14 && bar % 2 === 1)) s.kick(t, i === 0 ? 0.42 : 0.35);
					if (i === 4 || i === 12) s.rim(t, 0.105);
					if (i % 2 === 0) s.hat(t, { gain: i % 4 === 2 ? 0.075 : 0.044 });
					if (t >= 30 && i === 14 && bar % 4 === 3) s.hat(t, { gain: 0.055, open: true });
				} else if (montage(t)) {
					if (i % 4 === 0) s.kick(t, 0.42);
					if (i === 4 || i === 12) s.clap(t, 0.12);
					if (i % 4 === 2) s.hat(t, { gain: 0.064, open: true });
					s.hat(t, { gain: i % 2 ? 0.024 : 0.036, pan: -0.2 });
				} else if (build(t)) {
					if (i % 4 === 0) s.kick(t, 0.3 + 0.12 * ((t - 78) / 6));
					if (i % 2 === 0) s.hat(t, { gain: 0.036 + 0.034 * ((t - 78) / 6) });
					if (t >= 80 && (i === 4 || i === 12)) s.rim(t, 0.1);
				} else if (outro(t)) {
					if (i === 0 || i === 8) s.kick(t, 0.36);
					if (i % 2 === 0) s.hat(t, { gain: i % 4 === 2 ? 0.06 : 0.034 });
					if (i === 4 || i === 12) s.rim(t, 0.09);
				} else if (t >= 12 && t < 14) {
					if (i % 2 === 0) s.hat(t, { gain: 0.022 + 0.034 * ((t - 12) / 2) });
				} else if (t >= 76 && t < 78) {
					if (i % 4 === 2) s.hat(t, { gain: 0.036 });
				}
			}

			/* ベース */
			if (s.on("bass")) {
				if (groove(t)) {
					if (i === 0) s.bass(t, ch.bass, 0.62, 0.088);
					if (i === 6) s.bass(t, ch.bass, 0.2, 0.076);
					if (i === 8) s.bass(t, ch.bass, 0.45, 0.084);
					if (i === 14 && bar % 2 === 1) s.bass(t, ch.bass + 12, 0.16, 0.064);
				} else if (montage(t) || build(t)) {
					if (i % 4 === 0) s.bass(t, ch.bass, 0.2, 0.084);
					if (i % 4 === 2) s.bass(t, ch.bass + 12, 0.14, 0.056);
				} else if (outro(t)) {
					if (i === 0 || i === 8) s.bass(t, ch.bass, 0.5, 0.076);
				} else if (t >= 72 && t < 78 && i === 0) s.bass(t, ch.bass, 1.7, 0.064);
			}

			/* アルペジオ */
			if (s.on("arp")) {
				const wave = [0, 2, 1, 3, 2, 4, 3, 1];
				const pan = ((i % 4) - 1.5) * 0.18;
				if (t >= 10 && t < 14 && i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: 0.065 + 0.065 * ((t - 10) / 4), bright: 0.7 + 0.3 * ((t - 10) / 4), pan });
				else if (groove(t) && i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: t < 30 ? 0.13 : 0.15, bright: t < 30 ? 0.85 : 1, pan });
				else if (montage(t)) s.pluck(t, ch.arp[[0, 1, 2, 3, 4, 3, 2, 1][i % 8]] + (i >= 8 ? 0 : 0), { gain: i % 2 ? 0.09 : 0.14, dur: 0.22, bright: 1.25, pan });
				else if (t >= 72 && t < 78 && i % 4 === 0) s.pluck(t, ch.arp[wave[i / 4]], { gain: 0.12, dur: 0.5, bright: 0.8, pan, delay: 0.7 });
				else if (build(t) && (t >= 82 ? true : i % 2 === 0)) s.pluck(t, ch.arp[wave[(t >= 82 ? i : i / 2) % 8]], { gain: 0.11 + 0.05 * ((t - 78) / 6), dur: 0.26, bright: 0.9 + 0.5 * ((t - 78) / 6), pan });
				else if (outro(t) && i % 2 === 0) s.pluck(t, ch.arp[wave[i / 2]], { gain: 0.145 * (1 - (t - 84) / 6), bright: 1.1, pan });
			}
		}
	}

	if (s.on("melody")) for (const [t, m, len] of MELODY) s.bell(s.music, t, m, { gain: t >= 84 ? 0.16 : 0.15, dur: Math.max(0.9, len * 1.3), pan: 0.1, send: 0.5, verb: s.verbIn });

	if (s.on("fx")) {
		// 冒頭の脈（1 拍ごとの低い鼓動）
		for (let t = 2; t < 6.4; t += BEAT) s.tone(s.sfx, t, { f: 62, f1: 44, dur: 0.24, gain: 0.15, attack: 0.004 });
		// 場面の頭へ向かう上昇音
		const riser = (t0, t1, gain) => {
			s.hiss(s.sfx, t0, { dur: t1 - t0, gain, type: "bandpass", f: 400, f1: 7000, q: 1.3, shape: 0.985, send: 0.3 });
			s.hiss(s.sfx, t1 - 0.9, { dur: 0.9, gain: gain * 0.9, type: "highpass", f: 5200, shape: 0.99 });
		};
		riser(5.8, 8, 0.07);
		riser(56, 58, 0.075);
		riser(82, 84, 0.085);
		// 細かい連打で盛り上げる
		const roll = (t0, t1) => {
			for (let t = t0; t < t1 - 1e-6; t += t > t1 - 0.5 ? STEP / 2 : STEP) s.hiss(s.music, t, { dur: 0.05, gain: 0.02 + 0.065 * ((t - t0) / (t1 - t0)) ** 2, type: "bandpass", f: 2100, q: 1.4 });
		};
		roll(56, 57.45);
		roll(82.5, 84);
		roll(13.5, 14);
		// 場面の頭の一撃
		s.impact(8, 1);
		s.impact(58, 0.75);
		s.impact(84, 1.05);
		s.hiss(s.sfx, 14, { dur: 0.6, gain: 0.05, type: "highpass", f: 6500, send: 0.5 });
		s.hiss(s.sfx, 72, { dur: 0.9, gain: 0.05, type: "highpass", f: 6500, send: 0.6 });
		// 最後の和音
		for (const [m, pan] of [[62, -0.3], [69, 0.3], [74, 0], [78, 0.2]]) s.bell(s.sfx, 84, m, { gain: 0.1, dur: 2.6, pan, send: 0.6 });
		for (const [m, pan] of [[62, -0.3], [69, 0.3], [78, 0]]) s.bell(s.sfx, 88, m, { gain: 0.085, dur: 2.2, pan, send: 0.7 });
	}

	// 曲全体の音量の流れ
	const mg = s.music.gain;
	mg.setValueAtTime(0.9, 0);
	mg.setValueAtTime(0.9, 86.5);
	mg.linearRampToValueAtTime(0.75, 88);
	mg.linearRampToValueAtTime(0.0, 89.75);
	void ctx;
}

/* ---------------- 効果音 ---------------- */

const PENTA = [74, 76, 78, 81, 83, 86, 88, 90, 93];
const LEFT = -0.45;
const RIGHT = 0.5;

function effects(s) {
	if (!s.on("sfx")) return;
	const x = s.sfx;
	const r = rng(4242);
	for (const c of cues) {
		const t = c.t;
		switch (c.type) {
			case "row": // PC のターミナルに 1 行出る
				s.tone(x, t, { f: mtof(62), dur: 0.07, gain: c.far ? 0.035 : 0.05, pan: LEFT, type: "triangle" });
				s.hiss(x, t, { dur: 0.02, gain: 0.02, f: 3000, pan: LEFT });
				break;
			case "rowPhone": // スマホに 1 行出る
				s.tone(x, t, { f: mtof(81), dur: 0.09, gain: 0.04, pan: RIGHT, send: 0.2 });
				break;
			case "blip":
				s.tone(x, t, { f: mtof(86), dur: 0.08, gain: 0.03, pan: RIGHT * c.dir });
				break;
			case "tap":
				s.tone(x, t, { f: 210, f1: 120, dur: 0.05, gain: 0.09, pan: RIGHT * 0.6 });
				s.hiss(x, t, { dur: 0.012, gain: 0.05, type: "highpass", f: 3000, pan: RIGHT * 0.6 });
				break;
			case "type": {
				const n = c.n;
				for (let i = 0; i < n; i++) {
					const tt = t + (c.dur * i) / n + (r() - 0.5) * 0.012;
					if (c.key) s.hiss(x, tt, { dur: 0.022, gain: 0.035 + r() * 0.02, f: 1900 + r() * 700, q: 1.5, pan: LEFT });
					else s.hiss(x, tt, { dur: 0.014, gain: 0.028 + r() * 0.015, f: 3600 + r() * 900, q: 2, pan: RIGHT * 0.6 });
				}
				break;
			}
			case "enter":
				s.hiss(x, t, { dur: 0.04, gain: 0.07, f: 1500, q: 1.2, pan: LEFT });
				s.tone(x, t, { f: 160, f1: 110, dur: 0.05, gain: 0.08, pan: LEFT });
				break;
			case "send":
				s.tone(x, t, { f: 520, f1: 1040, dur: 0.11, gain: 0.07, pan: RIGHT * 0.6, send: 0.3 });
				break;
			case "ask": // 質問が出る（解決しない上行）
				s.bell(x, t, 78, { gain: 0.06, dur: 0.9, pan: LEFT * 0.4 });
				s.bell(x, t + 0.13, 83, { gain: 0.06, dur: 1.3, pan: LEFT * 0.4 });
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
			case "notify": // スマホの通知
				s.bell(x, t, 81, { gain: 0.12, dur: 0.9, send: 0.5, index: 1.8 });
				s.bell(x, t + 0.14, 86, { gain: 0.13, dur: 1.6, send: 0.5, index: 1.8 });
				break;
			case "buzz":
				for (const d of [0, 0.19]) {
					s.tone(x, t + d, { f: 165, type: "square", dur: 0.13, gain: 0.035, attack: 0.01 });
					s.tone(x, t + d, { f: 82.5, type: "sine", dur: 0.13, gain: 0.09, attack: 0.01 });
				}
				break;
			case "wipe":
				s.hiss(x, t, { dur: c.dur + 0.12, gain: 0.13, f: 500, f1: 5200, q: 0.9, shape: 0.8, curve: "lin", send: 0.3 });
				break;
			case "whoosh":
				s.hiss(x, t, { dur: 0.5, gain: 0.05, f: 700, f1: 2400, q: 0.8, shape: 0.45, curve: "lin" });
				break;
			case "logoHit":
				s.pluck(t, [74, 78, 81, 86, 90][c.i], { gain: 0.14, dur: 0.6, bright: 1.4, delay: 0.6 });
				s.tone(x, t, { f: 120, f1: 60, dur: 0.12, gain: 0.12 });
				if (c.i === 4) s.hiss(x, t, { dur: 1.1, gain: 0.06, type: "highpass", f: 7000, send: 0.7 });
				break;
			case "swell":
				for (const [m, pan] of [[74, -0.3], [81, 0.3]]) s.bell(x, t + 0.1, m, { gain: 0.07, dur: 2.2, pan, send: 0.7 });
				break;
			case "tag":
				s.bell(x, t, 86, { gain: 0.06, dur: 1.8, send: 0.7 });
				s.bell(x, t + 0.08, 90, { gain: 0.045, dur: 1.8, send: 0.7, pan: 0.3 });
				break;
			case "answer":
				s.bell(x, t, 81, { gain: 0.09, dur: 0.7, pan: RIGHT * 0.6 });
				s.bell(x, t + 0.09, 86, { gain: 0.1, dur: 1.1, pan: RIGHT * 0.6 });
				break;
			case "stream":
				for (let tt = t; tt < t + c.dur; tt += 0.034) s.hiss(x, tt, { dur: 0.01, gain: 0.012 + r() * 0.008, f: 4200, q: 3, pan: RIGHT * 0.6 });
				break;
			case "done":
				s.bell(x, t, 81, { gain: 0.07, dur: 1, pan: RIGHT * 0.5 });
				s.bell(x, t + 0.1, 85, { gain: 0.07, dur: 1.3, pan: RIGHT * 0.5 });
				break;
			case "cascade": // 差分の行が順に出る（音階を上る）
				for (let i = 0; i < c.n; i++) s.tone(x, t + i * c.step, { f: mtof(PENTA[i % PENTA.length] - 12), dur: 0.08, gain: 0.03, pan: RIGHT * 0.6, send: 0.3 });
				break;
			case "pop":
				s.tone(x, t, { f: 300, f1: 620, dur: 0.07, gain: 0.07 });
				s.bell(x, t, PENTA[c.i % PENTA.length], { gain: 0.085, dur: 0.8, pan: ((c.i % 4) - 1.5) * 0.3, send: 0.45 });
				break;
			case "tick":
				s.hiss(x, t, { dur: 0.015, gain: 0.05, f: 3000, q: 3 });
				break;
			case "check":
				s.bell(x, t, [78, 81, 86][c.i], { gain: 0.11, dur: 1.3, pan: (c.i - 1) * 0.4, send: 0.6 });
				s.tone(x, t, { f: 300, f1: 620, dur: 0.07, gain: 0.05 });
				break;
			case "launch":
				s.tone(x, t, { f: 330, f1: 1320, dur: 0.3, gain: 0.06, pan: RIGHT * 0.6, send: 0.4 });
				s.bell(x, t + 0.22, 85, { gain: 0.09, dur: 1.2, pan: RIGHT * 0.6 });
				break;
			case "attach": // PC 側でつながる
				s.bell(x, t, 74, { gain: 0.09, dur: 0.8, pan: LEFT });
				s.bell(x, t + 0.1, 78, { gain: 0.09, dur: 0.8, pan: LEFT });
				s.bell(x, t + 0.2, 83, { gain: 0.1, dur: 1.3, pan: LEFT });
				break;
			case "drop": // 切断
				s.tone(x, t, { f: 620, f1: 130, dur: 0.42, gain: 0.11, type: "triangle", send: 0.3 });
				s.hiss(x, t, { dur: 0.3, gain: 0.05, f: 2400, f1: 300, q: 1 });
				break;
			case "reconnect":
				s.tone(x, t, { f: 220, f1: 880, dur: 0.3, gain: 0.07, type: "triangle", send: 0.3 });
				[81, 85, 88].forEach((m, i) => s.bell(x, t + 0.2 + i * 0.07, m, { gain: 0.1, dur: 1.2, pan: RIGHT * 0.5, send: 0.5 }));
				break;
			case "scan":
				s.tone(x, t, { f: 900, f1: 1500, dur: c.dur / 2, glide: c.dur / 2, gain: 0.02, attack: 0.05 });
				s.tone(x, t + c.dur / 2, { f: 1500, f1: 900, dur: c.dur / 2, glide: c.dur / 2, gain: 0.02, attack: 0.05 });
				break;
			case "success":
				[74, 78, 81, 86].forEach((m, i) => s.bell(x, t + i * 0.065, m, { gain: 0.1, dur: 1.2, pan: 0.4, send: 0.5 }));
				break;
			case "impact":
				break;
		}
	}
}

/* ---------------- 書き出し ---------------- */

function muffle(s) {
	// 切断のあいだ、曲がこもって聞こえる
	const drop = cues.find((c) => c.type === "drop")?.t;
	const back = cues.find((c) => c.type === "reconnect")?.t;
	if (drop === undefined || back === undefined) return;
	const f = s.muffle.frequency;
	f.setValueAtTime(20000, drop);
	f.exponentialRampToValueAtTime(420, drop + 0.3);
	f.setValueAtTime(420, back - 0.05);
	f.exponentialRampToValueAtTime(20000, back + 0.4);
}

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

/** 合成して WAV（24 bit）を作り、大きさ（バイト）を返す。only で 1 系統だけにできる。 */
export async function render(duration, only) {
	const skip = Math.round(LATENCY * SR);
	const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR) + skip, SR);
	const s = new Synth(ctx, duration, only);
	music(s);
	effects(s);
	muffle(s);
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
