// 映像と音で共有する時刻。シーンを組み立てるときに効果音の合図（cue）を積み、音の合成で使う。
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

/** 各シーンの開始時刻（秒）。小節（2 秒）の頭に合わせてある。 */
export const T = {
	problem: 0,
	reveal: 8,
	same: 14,
	steer: 26,
	review: 32,
	fleet: 40,
	handoff: 48,
	toolkit: 58,
	resilient: 66,
	private: 72,
	setup: 78,
	end: 84,
	total: 90,
};

export const cues = [];
export function cue(type, t, data = {}) {
	cues.push({ type, t, ...data });
}
