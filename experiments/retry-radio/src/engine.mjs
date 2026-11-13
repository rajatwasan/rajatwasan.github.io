// One tick represents 100 ms. Each client has one outstanding operation.
export const TICK_MS = 100;
export const POLICIES = {
  fixed: "Fixed interval",
  exponential: "Exponential",
  jitter: "Full jitter"
};
export const INCIDENTS = {
  restart: { label: "Cold restart", description: "Offline for 2 seconds, then 6 requests per tick." },
  brownout: { label: "Brownout", description: "1 request per tick for 5 seconds, then 6 per tick." },
  rolling: { label: "Rolling recovery", description: "Offline for 1 second, then capacity rises from 1 to 6 requests per tick." }
};
export const DEFAULTS = { incident: "restart", clients: 64, seed: 42 };

// SplitMix32 gives each client its own reproducible stream of retry delays.
function randomStream(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x9e3779b9) >>> 0;
    let value = state ^ (state >>> 16);
    value = Math.imul(value, 0x21f0aaad);
    value ^= value >>> 15;
    value = Math.imul(value, 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
}

export function capacityAt(tick, incident) {
  if (incident === "restart") return tick < 20 ? 0 : 6;
  if (incident === "brownout") return tick < 50 ? 1 : 6;
  if (incident === "rolling") return tick < 10 ? 0 : Math.min(6, 1 + Math.floor((tick - 10) / 8));
  throw new RangeError("Unknown incident");
}

function retryDelay(policy, failures, random) {
  if (policy === "fixed") return 8;
  const ceiling = Math.min(32, 8 * 2 ** Math.min(failures - 1, 2));
  // A failed request can only be rescheduled into a future tick.
  if (policy === "jitter") return 1 + Math.floor(random() * ceiling);
  return ceiling;
}

export function simulate({ incident = "restart", clients = 64, seed = 42, policy = "jitter" } = {}) {
  if (!Object.hasOwn(INCIDENTS, incident) || !Object.hasOwn(POLICIES, policy)) throw new RangeError("Unknown scenario or policy");
  if (!Number.isInteger(clients) || clients < 1 || clients > 128) throw new RangeError("Clients must be 1 to 128");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be an unsigned 32-bit integer");
  const queue = new Map([[0, Array.from({ length: clients }, (_, id) => id)]]);
  const random = Array.from({ length: clients }, (_, id) => randomStream(seed ^ Math.imul(id + 1, 0x85ebca6b)));
  const failures = Array(clients).fill(0);
  const frames = [];
  let attempts = 0;
  let peakRetries = 0;
  let completed = 0;

  for (let tick = 0; completed < clients; tick++) {
    const due = queue.get(tick) || [];
    queue.delete(tick);
    const capacity = capacityAt(tick, incident);
    // Client ID breaks ties when several arrivals compete for the same slot.
    due.sort((a, b) => a - b);
    const events = due.map((client, slot) => {
      const retry = failures[client] > 0;
      const ok = slot < capacity;
      if (ok) {
        completed++;
      } else {
        failures[client]++;
        const next = tick + retryDelay(policy, failures[client], random[client]);
        if (!queue.has(next)) queue.set(next, []);
        queue.get(next).push(client);
      }
      return { client, ok, retry };
    });
    attempts += due.length;
    if (tick > 0) peakRetries = Math.max(peakRetries, due.length);
    frames.push({ tick, capacity, events, completed });
  }
  return { incident, clients, seed, policy, tickMs: TICK_MS, frames,
    stats: { attempts, retries: attempts - clients, peakRetries, finishMs: (frames.length - 1) * TICK_MS } };
}
