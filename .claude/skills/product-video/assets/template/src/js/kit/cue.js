// 効果音の合図。場面を組むときに cue("tap", 時刻) のように積み、音の合成（kit/audio.js）がその時刻で鳴らす。
// 映像の動きと音を同じ場所で決めるので、動きの時刻をずらせば音も一緒にずれる。
export const cues = [];
export function cue(type, t, data = {}) {
	cues.push({ type, t, ...data });
}
