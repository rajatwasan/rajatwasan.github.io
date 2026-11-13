import { simulate, DEFAULTS, POLICIES, INCIDENTS } from "./engine.mjs";
import { renderAudio } from "./audio.mjs";

const get = id => document.getElementById(id);
const query = new URLSearchParams(location.hash.slice(1));
const fromList = (name, list, fallback) => {
  const value = query.get(name);
  return list.includes(value) ? value : fallback;
};
get("incident").value = fromList("incident", Object.keys(INCIDENTS), DEFAULTS.incident);
get("clients").value = fromList("clients", ["32", "64", "128"], "64");
const seedParam = query.get("seed");
get("seed").value = seedParam && /^\d+$/.test(seedParam) && Number(seedParam) <= 0xffffffff ? Number(seedParam) : DEFAULTS.seed;
let policy = fromList("policy", Object.keys(POLICIES), "fixed");
let traces = {};
let trace;
let position = 0;
let started = null;
let muted = false;
let context;
let source;
let animation;
let requestId = 0;
let buffer;
const canvas = get("raster");
const plot = canvas.getContext("2d");
const duration = () => trace.frames.length * trace.tickMs / 1000 + 0.18;

function draw() {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  plot.setTransform(scale, 0, 0, scale, 0, 0);
  plot.clearRect(0, 0, width, height);
  const left = 30, right = width - 9, top = 12, bottom = height - 24;
  const x = time => left + time / duration() * (right - left);
  const row = (bottom - top) / trace.clients;
  plot.font = "10px monospace";
  plot.fillStyle = "#acbaa4";
  plot.textAlign = "right";
  plot.fillText("C1", left - 5, top + 6);
  plot.fillText("C" + trace.clients, left - 5, bottom);
  plot.strokeStyle = "#34422f";
  plot.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + i * (bottom - top) / 4;
    plot.beginPath(); plot.moveTo(left, y); plot.lineTo(right, y); plot.stroke();
  }
  const targetInterval = duration() / (width < 420 ? 4 : 6);
  const step = [0.25, 0.5, 1, 2, 5, 10, 20, 40].find(n => n >= targetInterval) || 50;
  plot.textAlign = "center";
  for (let sec = 0; sec < duration(); sec += step) {
    plot.beginPath(); plot.moveTo(x(sec), top); plot.lineTo(x(sec), bottom); plot.stroke();
    plot.fillText(String(sec), x(sec), height - 6);
  }
  for (const frame of trace.frames) {
    const at = x(frame.tick * trace.tickMs / 1000);
    for (const event of frame.events) {
      plot.fillStyle = event.ok ? "#b8ea98" : "#ff956a";
      plot.fillRect(at, top + event.client * row, Math.min(4, Math.max(1.5, x(0.07) - left)), Math.max(0.9, row * 0.78));
    }
  }
  if (position > 0 || started !== null) {
    plot.strokeStyle = "#f9f8db";
    plot.beginPath(); plot.moveTo(x(position), top - 4); plot.lineTo(x(position), bottom + 3); plot.stroke();
  }
  get("elapsed").textContent = position.toFixed(1).padStart(4, "0") + " s";
  get("scrub").value = String(position);
  get("scrub").setAttribute("aria-valuetext", position.toFixed(1) + " seconds");
}

function stopAudio() {
  if (!source) return;
  source.stop();
  source.disconnect();
  source = null;
}

async function startAudio() {
  const id = ++requestId;
  if (muted || started === null) return;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    if (id !== requestId || muted || started === null) return;
    if (!buffer) {
      const samples = renderAudio(trace);
      buffer = context.createBuffer(1, samples.length, 22050);
      buffer.copyToChannel(samples, 0);
    }
    stopAudio();
    const offset = (performance.now() - started) / 1000;
    if (offset >= buffer.duration) return;
    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0, offset);
  } catch {
    muted = true;
    get("sound").textContent = "Sound off";
    get("sound").setAttribute("aria-pressed", "false");
    get("status").textContent = "Audio is unavailable. Visual playback is active.";
  }
}

function pause() {
  if (started !== null) position = Math.min(duration(), (performance.now() - started) / 1000);
  started = null;
  requestId++;
  stopAudio();
  cancelAnimationFrame(animation);
  get("play").textContent = position >= duration() ? "Replay" : "Play trace";
  get("signal").textContent = position >= duration() ? "Trace complete" : position > 0 ? "Paused" : "Ready to play";
  draw();
}

function animate() {
  if (started === null) return;
  position = Math.min(duration(), (performance.now() - started) / 1000);
  if (position >= duration()) { pause(); return; }
  draw();
  animation = requestAnimationFrame(animate);
}

function play() {
  if (position >= duration()) position = 0;
  started = performance.now() - position * 1000;
  get("play").textContent = "Pause";
  get("signal").textContent = "Playing trace";
  startAudio();
  animate();
}

function replayHash() {
  return new URLSearchParams({ incident: trace.incident, clients: String(trace.clients), seed: String(trace.seed), policy }).toString();
}

function selectPolicy(name) {
  if (trace) pause();
  policy = name;
  trace = traces[policy];
  position = 0;
  buffer = null;
  get("trace-title").textContent = POLICIES[name];
  get("client-label").textContent = trace.clients + " clients";
  get("scrub").max = duration();
  for (const button of get("policies").children) button.setAttribute("aria-pressed", String(button.value === name));
  for (const row of get("scores").children) row.classList.toggle("active", row.dataset.policy === name);
  pause();
}

function rebuild() {
  if (!get("seed").validity.valid || get("seed").value === "") {
    get("seed").reportValidity();
    get("seed").value = trace?.seed ?? DEFAULTS.seed;
  }
  const config = { clients: Number(get("clients").value), incident: get("incident").value, seed: Number(get("seed").value) };
  get("description").textContent = INCIDENTS[config.incident].description;
  get("scores").replaceChildren();
  for (const [name, label] of Object.entries(POLICIES)) {
    traces[name] = simulate({ ...config, policy: name });
    const { stats } = traces[name];
    const row = get("scores").insertRow();
    row.dataset.policy = name;
    for (const value of [label, stats.retries, stats.peakRetries, (stats.finishMs / 1000).toFixed(1) + " s"]) {
      row.insertCell().textContent = value;
    }
  }
  selectPolicy(policy);
}

for (const [name, label] of Object.entries(POLICIES)) {
  const button = document.createElement("button");
  button.type = "button"; button.value = name; button.textContent = label;
  button.onclick = () => selectPolicy(name);
  get("policies").append(button);
}
for (const id of ["incident", "seed", "clients"]) get(id).addEventListener("change", rebuild);
get("play").onclick = () => started === null ? play() : pause();
get("sound").onclick = () => {
  muted = !muted;
  get("sound").textContent = muted ? "Sound off" : "Sound on";
  get("sound").setAttribute("aria-pressed", String(!muted));
  if (muted) { requestId++; stopAudio(); } else startAudio();
};
get("scrub").oninput = event => {
  const next = Number(event.target.value);
  const resume = started !== null;
  pause();
  position = next;
  if (resume && position < duration()) play(); else pause();
};
let copyTimer;
get("copy").onclick = async () => {
  const url = new URL(location.href);
  url.hash = replayHash();
  // Local files cannot produce portable share links. Use the hosted copy.
  if (url.protocol === "file:") {
    const hosted = new URL("https://raw.githack.com/rajatwasan/rajatwasan.github.io/retry-radio/experiments/retry-radio/index.html");
    hosted.hash = url.hash;
    url.href = hosted.href;
  }
  try {
    await navigator.clipboard.writeText(url.href);
    get("copy").textContent = "Link copied";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { get("copy").textContent = "Copy replay link"; }, 1800);
  } catch {
    window.prompt("Copy this replay link", url.href);
  }
};
rebuild();
new ResizeObserver(draw).observe(canvas);
