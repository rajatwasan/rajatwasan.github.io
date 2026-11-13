import { simulate } from "./src/engine.mjs";
import { parseArgs } from "node:util";

const help = `Usage: node cli.mjs [--incident restart|brownout|rolling] [--policy fixed|exponential|jitter|all]
                    [--clients 1..128] [--seed 0..4294967295] [--json]

Defaults: restart, all three policies, 64 clients, seed 42. JSON includes every arrival and outcome.
`;
try {
  const { values } = parseArgs({ options: {
    incident: { type: "string", default: "restart" }, policy: { type: "string", default: "all" },
    clients: { type: "string", default: "64" }, seed: { type: "string", default: "42" },
    json: { type: "boolean" }, help: { type: "boolean", short: "h" }
  } });
  if (values.help) {
    console.log(help);
  } else {
    if (!/^\d+$/.test(values.clients) || !/^\d+$/.test(values.seed)) throw new Error("Clients and seed must be whole numbers");
    const policies = values.policy === "all" ? ["fixed", "exponential", "jitter"] : [values.policy];
    const traces = policies.map(policy => simulate({ policy, incident: values.incident, clients: Number(values.clients), seed: Number(values.seed) }));
    if (values.json) console.log(JSON.stringify(traces));
    else {
      console.log(`Retry Radio | ${values.incident} | ${values.clients} clients | seed ${values.seed}`);
      console.table(traces.map(t => ({ policy: t.policy, retries: t.stats.retries,
        "peak retries / 100 ms": t.stats.peakRetries, "last success (s)": t.stats.finishMs / 1000 })));
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
