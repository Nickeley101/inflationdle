// Synthesizes the soundtracks for promo/guess.html and promo/teaser.html videos: a soft beat, typing clicks, "wrong" buzzes,
// countdown beeps, a reveal chime and an end sting, timed to the scenes in guess.html's render(t).
// Every sound is generated here from sine waves and noise, so there's no licensed music and no voice.
//   node scripts/video-audio.mjs out/audio.wav [seconds]
import {writeFileSync} from "node:fs";

const RATE = 44100;

// Shared tools: a stereo buffer, a repeatable noise source and a few envelope helpers.
function synth(seconds) {
  const n = Math.round(seconds * RATE), L = new Float32Array(n), R = new Float32Array(n);
  let seed = 12345;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2147483648) - 1;  // repeatable, so every render sounds the same
  const add = (t0, dur, fn, gain = 1, pan = 0) => {
    const a = Math.max(0, Math.round(t0 * RATE)), b = Math.min(n, Math.round((t0 + dur) * RATE));
    for (let i = a; i < b; i++) { const v = fn((i - a) / RATE) * gain; L[i] += v * (1 - pan) ; R[i] += v * (1 + pan); }
  };
  const sine = f => t => Math.sin(2 * Math.PI * f * t);
  const env = (fn, attack, decay) => t => fn(t) * Math.min(1, t / attack) * Math.exp(-t / decay);
  const note = m => 440 * 2 ** ((m - 69) / 12);
  const kick = (t, g) => add(t, 0.35, u => Math.sin(2 * Math.PI * (45 * u + 60 * 0.06 * (1 - Math.exp(-u / 0.06)))) * Math.exp(-u / 0.12), g);
  const hat = (t, g, pan) => add(t, 0.05, u => noise() * Math.exp(-u / 0.012), g, pan);
  // Slow swells keep the pad under everything else.
  const pad = (t0, dur, notes, gain) => notes.forEach((m, k) =>
    add(t0, dur, u => sine(note(m))(u) * Math.min(1, u / 1.2, (dur - u) / 1.0), gain, k % 2 ? 0.25 : -0.25));
  return {add, sine, env, note, noise, kick, hat, pad, wav: () => wav(L, R, n)};
}

export function soundtrack(seconds = 15) {
  const {add, sine, env, note, noise, kick, hat, pad, wav} = synth(seconds);
  // Beat: 120 bpm kick with a falling pitch, offbeat hats. It drops out for the countdown, returns fuller for the reveal
  // and stops before the next question.
  for (let t = 0; t < 12.6; t += 0.5) {
    if (t >= 4.5 && t < 7.5) continue;
    kick(t, t >= 7.5 ? 0.55 : 0.4);
    hat(t + 0.25, 0.06, (t * 2) % 2 ? 0.3 : -0.3);
  }
  // Pad: A minor while guessing, C major from the reveal on.
  pad(0, 8.3, [57, 60, 64], 0.05);
  pad(8.3, 4.6, [60, 64, 67], 0.06);
  // Typing clicks for the two wrong guesses (guess.html types each one over 0.8 s).
  for (const a of [2, 3.3]) for (let t = a; t < a + 0.8; t += 0.1) add(t, 0.02, u => noise() * Math.exp(-u / 0.004), 0.22);
  // "Too high" and "too low" buzzes when each wrong guess lands.
  for (const t of [2.8, 4.1]) add(t, 0.28, env(u => Math.sign(Math.sin(2 * Math.PI * 110 * u)) * 0.6 + Math.sin(2 * Math.PI * 220 * u) * 0.4, 0.005, 0.1), 0.12);
  // Countdown 3, 2, 1, with a clock tick between beeps.
  for (const t of [4.6, 5.6, 6.6]) add(t, 0.25, env(sine(880), 0.003, 0.07), 0.25);
  for (let t = 5.1; t < 7.5; t += 1) add(t, 0.03, u => noise() * Math.exp(-u / 0.006), 0.12);
  // The price ticking up: fast rising blips, like a quote board.
  for (let k = 0; k < 10; k++) add(7.5 + k * 0.08, 0.05, env(sine(note(72 + k)), 0.002, 0.02), 0.12);
  // Reveal: a bell chord, plus a hit, as the price lands.
  [72, 76, 79, 84].forEach((m, k) => add(8.3 + k * 0.03, 2.5, env(u => sine(note(m))(u) + 0.3 * sine(note(m) * 2.01)(u), 0.004, 0.7), 0.16, (k - 1.5) * 0.2));
  add(8.3, 0.6, u => noise() * Math.exp(-u / 0.08), 0.12);
  // Rising sweep while the price line draws.
  add(8.8, 1.8, u => Math.sin(2 * Math.PI * (300 * u + 170 * u * u)) * Math.min(1, u / 0.4) * Math.min(1, (1.8 - u) / 0.3), 0.04);
  // Next question: a sting that doesn't resolve, since that answer comes tomorrow.
  [[12.7, 74], [12.88, 79], [13.06, 81]].forEach(([t, m]) => add(t, 1.8, env(sine(note(m)), 0.004, 0.5), 0.18));
  return wav();
}

// Soundtrack for promo/teaser.html (today's puzzle, no reveal): beat, a blip as each guess slot appears,
// a rising sweep into "comment your guess", and an unresolved end sting, since the answer comes tomorrow.
export function teaserSoundtrack(seconds = 15) {
  const {add, sine, env, note, kick, hat, pad, wav} = synth(seconds);
  for (let t = 0; t < 10.3; t += 0.5) { kick(t, t >= 5.4 ? 0.5 : 0.4); hat(t + 0.25, 0.06, (t * 2) % 2 ? 0.3 : -0.3); }
  pad(0, 5.4, [57, 60, 64], 0.05);
  pad(5.4, 5.2, [53, 57, 60], 0.06);
  // One rising blip per guess slot (teaser.html shows them every 0.45 s from 2.1 s).
  [69, 72, 74, 76, 79, 81].forEach((m, k) => add(2.1 + k * 0.45, 0.3, env(sine(note(m)), 0.003, 0.09), 0.18, (k % 2 ? 0.2 : -0.2)));
  add(4.4, 1.0, u => Math.sin(2 * Math.PI * (250 * u + 180 * u * u)) * Math.min(1, u / 0.4) * Math.min(1, (1.0 - u) / 0.2), 0.05);
  // "Comment your guess" hit.
  [65, 69, 72].forEach((m, k) => add(5.4 + k * 0.02, 1.8, env(u => sine(note(m))(u) + 0.3 * sine(note(m) * 2.01)(u), 0.004, 0.6), 0.14, (k - 1) * 0.2));
  // End card: a question-like sting that doesn't resolve, since the answer comes tomorrow.
  [[10.6, 74], [10.78, 79], [10.96, 81]].forEach(([t, m]) => add(t, 1.8, env(sine(note(m)), 0.004, 0.5), 0.18));
  // A soft blip as the question comes back for the loop.
  add(13.3, 0.4, env(sine(note(69)), 0.003, 0.12), 0.12);
  return wav();
}

// Soundtrack for promo/evening.html (a year's prices vs today): beat, a 3-2-1 countdown, a rising sweep while the prices
// tick up, a hit on the biggest jump, and an end sting.
export function eveningSoundtrack(seconds = 15) {
  const {add, sine, env, note, noise, kick, hat, pad, wav} = synth(seconds);
  for (let t = 0; t < 12.2; t += 0.5) {
    if (t >= 1 && t < 4) continue;  // quiet under the countdown, so the pick feels like a pause
    kick(t, t >= 4 ? 0.5 : 0.4); hat(t + 0.25, 0.06, (t * 2) % 2 ? 0.3 : -0.3);
  }
  pad(0, 7, [57, 60, 64], 0.05);
  pad(7, 5.6, [60, 64, 67], 0.06);
  for (const t of [1.1, 2.1, 3.1]) add(t, 0.25, env(sine(880), 0.003, 0.07), 0.25);
  for (let t = 1.6; t < 4; t += 1) add(t, 0.03, u => noise() * Math.exp(-u / 0.006), 0.12);
  // Prices ticking up for 2.8 s: a sweep plus quote-board blips.
  add(4, 2.8, u => Math.sin(2 * Math.PI * (260 * u + 90 * u * u)) * Math.min(1, u / 0.4) * Math.min(1, (2.8 - u) / 0.3), 0.04);
  for (let k = 0; k < 14; k++) add(4 + k * 0.2, 0.05, env(sine(note(67 + k)), 0.002, 0.02), 0.1);
  // Biggest jump.
  [72, 76, 79, 84].forEach((m, k) => add(7 + k * 0.03, 2.2, env(u => sine(note(m))(u) + 0.3 * sine(note(m) * 2.01)(u), 0.004, 0.6), 0.16, (k - 1.5) * 0.2));
  add(7, 0.5, u => noise() * Math.exp(-u / 0.08), 0.1);
  // End card sting, then a soft blip as the opening frame returns for the loop.
  [[12.4, 79], [12.58, 84]].forEach(([t, m]) => add(t, 1.6, env(sine(note(m)), 0.004, 0.45), 0.2));
  add(14.2, 0.4, env(sine(note(69)), 0.003, 0.12), 0.12);
  return wav();
}

// Soundtrack for promo/spotlight.html (one item's price, year by year, 10 s): a driving beat, a quote-board blip on every
// year as the price races to today, a hit as today's price lands, a slam for the total change, and an end sting.
export function spotlightSoundtrack(seconds = 10, years = 32) {
  const {add, sine, env, note, noise, kick, hat, pad, wav} = synth(seconds);
  for (let t = 0; t < 8; t += 0.25) { if (t % 0.5 === 0) kick(t, t >= 5 ? 0.6 : 0.45); else hat(t, 0.07, (t * 4) % 2 ? 0.3 : -0.3); }
  pad(0, 5.1, [57, 60, 64], 0.05);
  pad(5.1, 3, [60, 64, 67], 0.06);
  // One blip per year from 0.5 s to 5 s, climbing with the line.
  for (let k = 0; k < years; k++) add(0.5 + k * 4.5 / Math.max(1, years - 1), 0.05, env(sine(note(64 + Math.round(k * 20 / years))), 0.002, 0.02), 0.09, (k % 2 ? 0.2 : -0.2));
  add(0.5, 4.5, u => Math.sin(2 * Math.PI * (220 * u + 40 * u * u)) * Math.min(1, u / 0.4) * Math.min(1, (4.5 - u) / 0.3), 0.03);
  // Today's price, then the total change.
  [72, 76, 79].forEach((m, k) => add(5 + k * 0.02, 0.8, env(sine(note(m)), 0.003, 0.25), 0.14, (k - 1) * 0.2));
  [60, 67, 72, 76, 84].forEach((m, k) => add(5.25 + k * 0.03, 2.4, env(u => sine(note(m))(u) + 0.3 * sine(note(m) * 2.01)(u), 0.004, 0.6), 0.15, (k - 2) * 0.15));
  add(5.25, 0.5, u => noise() * Math.exp(-u / 0.08), 0.14);
  [[8.1, 79], [8.28, 84]].forEach(([t, m]) => add(t, 1.4, env(sine(note(m)), 0.004, 0.4), 0.2));
  add(9.5, 0.4, env(sine(note(69)), 0.003, 0.12), 0.12);
  return wav();
}

// Normalize to -3 dBFS so the platforms' loudness matching has headroom, then write a 16-bit stereo WAV.
function wav(L, R, n) {
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak ? 0.708 / peak : 1;
  const pcm = Buffer.alloc(44 + n * 4);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + n * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 4, 28);
  pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), 44 + i * 4);
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), 46 + i * 4);
  }
  return pcm;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [file = "out/audio.wav", secs = "15"] = process.argv.slice(2);
  writeFileSync(file, soundtrack(Number(secs)));
  console.log("wrote " + file);
}
