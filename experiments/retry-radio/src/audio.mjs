// A failed burst is a crackle. A successful burst plays a pitched sine note.
// Summing by tick keeps the sound intelligible when dozens of clients collide.
export function renderAudio(trace, sampleRate = 22050) {
  const step = Math.round(trace.tickMs * sampleRate / 1000);
  const pcm = new Float32Array(trace.frames.length * step + Math.ceil(0.18 * sampleRate));
  const notes = [220, 261.63, 329.63, 392, 440];
  let noiseState = 1;
  for (const frame of trace.frames) {
    if (!frame.events.length) continue;
    const successes = frame.events.filter(event => event.ok);
    const hits = successes.length;
    const misses = frame.events.length - hits;
    const pitch = notes[(successes[0]?.client || 0) % notes.length];
    const crackle = misses ? Math.min(0.54, 0.12 + 0.07 * Math.log2(misses + 1)) : 0;
    const chime = hits ? Math.min(0.42, 0.17 + 0.07 * Math.log2(hits + 1)) : 0;
    const start = frame.tick * step;
    const length = Math.round((hits ? 0.16 : 0.07) * sampleRate);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
      const noise = noiseState / 2147483648 - 1;
      const attack = Math.min(1, t / 0.002);
      pcm[start + i] += attack * (crackle * Math.exp(-65 * t) * noise
        + chime * Math.exp(-28 * t) * Math.sin(2 * Math.PI * pitch * t));
    }
  }
  return pcm;
}
