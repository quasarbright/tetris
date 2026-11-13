// Small synthesized sound effects (the pygame version used NES samples, which aren't ours to
// ship). One short envelope per event; repeats of the same sound within 40 ms are dropped so
// the AI at high speed doesn't turn into noise.
let ctx = null, master = null;
let muted = false;
const last = {};

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function unlockAudio() { ensure(); }
export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

function tone({ freq, to = freq, dur = 0.08, type = "square", gain = 0.5, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to !== freq) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SOUNDS = {
  shift: () => tone({ freq: 520, dur: 0.03, gain: 0.18 }),
  rotate: () => tone({ freq: 700, to: 900, dur: 0.05, gain: 0.2, type: "triangle" }),
  lock: () => tone({ freq: 160, to: 70, dur: 0.09, gain: 0.5, type: "triangle" }),
  hardDrop: () => { tone({ freq: 240, to: 50, dur: 0.14, gain: 0.6, type: "sawtooth" }); },
  hold: () => tone({ freq: 440, to: 330, dur: 0.07, gain: 0.25, type: "triangle" }),
  clear: (n = 1) => [0, 1, 2].slice(0, n + 1).forEach((i) => tone({ freq: 660 * 2 ** (i * 4 / 12), dur: 0.12, gain: 0.3, delay: i * 0.05, type: "square" })),
  tetris: () => [0, 4, 7, 12, 16].forEach((s, i) => tone({ freq: 523 * 2 ** (s / 12), dur: 0.16, gain: 0.32, delay: i * 0.06 })),
  levelUp: () => [0, 7, 12, 19].forEach((s, i) => tone({ freq: 392 * 2 ** (s / 12), dur: 0.2, gain: 0.3, delay: i * 0.08, type: "triangle" })),
  death: () => [0, -3, -7, -12].forEach((s, i) => tone({ freq: 330 * 2 ** (s / 12), dur: 0.3, gain: 0.35, delay: i * 0.16, type: "sawtooth" })),
};

export function play(name, arg) {
  if (muted || !ctx || ctx.state !== "running") return;
  const now = performance.now();
  if (last[name] && now - last[name] < 40) return;
  last[name] = now;
  SOUNDS[name]?.(arg);
}
