// Produce a portable HTML demo from the exact modules used by the CLI and tests.
import { readFile, writeFile } from "node:fs/promises";
const read = name => readFile(new URL("./src/" + name, import.meta.url), "utf8");
const [template, styles, engine, audio, ui] = await Promise.all(
  ["screen.html", "style.css", "engine.mjs", "audio.mjs", "ui.mjs"].map(read)
);
const script = [engine, audio, ui].map(source => source
  .replace(/^import .* from "\.\/[^"]+";\n/gm, "")
  .replace(/^export (?=(function|const) )/gm, "")).join("\n");
const html = template.replace("/* STYLES */", () => styles)
  .replace("/* ENGINE + AUDIO + APP */", () => '"use strict";\n' + script);
await writeFile(new URL("./index.html", import.meta.url), html);
