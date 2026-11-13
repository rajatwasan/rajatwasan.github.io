import test from "node:test";
import assert from "node:assert/strict";
import { capacityAt, simulate, POLICIES, INCIDENTS } from "../src/engine.mjs";
import { renderAudio } from "../src/audio.mjs";

test("service capacity changes exactly at incident boundaries", () => {
  assert.deepEqual([19, 20].map(t => capacityAt(t, "restart")), [0, 6]);
  assert.deepEqual([49, 50].map(t => capacityAt(t, "brownout")), [1, 6]);
  assert.deepEqual([9, 10, 17, 18, 49, 50, 100].map(t => capacityAt(t, "rolling")), [0, 1, 1, 2, 5, 6, 6]);
});

test("one client retries after the configured delay", () => {
  const ticks = policy => simulate({ clients: 1, policy }).frames.filter(f => f.events.length).map(f => f.tick);
  assert.deepEqual(ticks("fixed"), [0, 8, 16, 24]);
  assert.deepEqual(ticks("exponential"), [0, 8, 24]);
  const immediate = simulate({ clients: 1, incident: "brownout" });
  assert.deepEqual(immediate.stats, { attempts: 1, retries: 0, peakRetries: 0, finishMs: 0 });
});

test("the same seed reconstructs the same arrivals and PCM samples", () => {
  const run = seed => simulate({ policy: "jitter", seed });
  const first = run(0);
  assert.deepEqual(first, run(0));
  assert.notDeepEqual(first.frames, run(1).frames);
  assert.deepEqual(renderAudio(first, 8000), renderAudio(run(0), 8000));
});

test("all clients complete once, only within capacity, and all counters reconcile", () => {
  for (const policy of Object.keys(POLICIES)) {
    for (const incident of Object.keys(INCIDENTS)) {
      for (const clients of [1, 32, 64, 128]) {
        for (const seed of [0, 42, 0xffffffff]) {
          const run = simulate({ policy, incident, clients, seed });
          const done = new Set();
          const seen = new Set();
          let retries = 0, peak = 0, attempts = 0;
          for (const frame of run.frames) {
            const ids = frame.events.map(e => e.client);
            assert.equal(new Set(ids).size, ids.length);
            assert.ok(frame.events.filter(e => e.ok).length <= frame.capacity);
            for (const event of frame.events) {
              assert.ok(event.client >= 0 && event.client < clients);
              assert.ok(!done.has(event.client));
              assert.equal(event.retry, seen.has(event.client));
              seen.add(event.client);
              if (event.ok) done.add(event.client);
              if (event.retry) retries++;
              attempts++;
            }
            assert.equal(frame.completed, done.size);
            peak = Math.max(peak, frame.events.filter(e => e.retry).length);
          }
          assert.equal(done.size, clients);
          assert.deepEqual(run.stats, { retries, peakRetries: peak, attempts, finishMs: run.frames.at(-1).tick * run.tickMs });
        }
      }
    }
  }
});

test("jitter stays inside each client's backoff window", () => {
  const run = simulate({ clients: 128, seed: 42 });
  const history = new Map();
  for (const frame of run.frames) {
    for (const event of frame.events) {
      const previous = history.get(event.client);
      if (previous) {
        const delay = frame.tick - previous.tick;
        assert.ok(delay >= 1 && delay <= Math.min(32, 8 * 2 ** Math.min(previous.count - 1, 2)));
      }
      history.set(event.client, { tick: frame.tick, count: (previous?.count || 0) + 1 });
    }
  }
});

test("cold restart README numbers are reproducible", () => {
  const rows = Object.keys(POLICIES).map(policy => {
    const s = simulate({ policy }).stats;
    return [s.retries, s.peakRetries, s.finishMs];
  });
  assert.deepEqual(rows, [[502, 64, 10400], [438, 64, 34400], [203, 18, 4900]]);
});

test("PCM rejects silence for active traces and stays inside the output range", () => {
  const samples = renderAudio(simulate({ clients: 128 }));
  assert.ok(samples.some(n => n !== 0));
  assert.ok(samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1));
  assert.equal(samples[0], 0);
});

test("invalid requests fail before the simulation starts", () => {
  for (const options of [{ clients: 0 }, { clients: 129 }, { clients: 1.5 },
    { seed: -1 }, { seed: 2 ** 32 }, { incident: "test" }, { policy: "constructor" }]) {
    assert.throws(() => simulate(options), RangeError);
  }
});
