import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createSourceLoader } from "./source-loader.mjs";
import { inputs, bigCases, operationNames } from "./benchmark-workloads.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "reports/target-comparison");
fs.mkdirSync(directory, { recursive: true });
const groups = ["small-6-digit", "small", "small-promotion", "boundary", "30-digit"];
const targets = ["ES2022", "ES2020"];
const constructors = Object.fromEntries(targets.map(target => [target,
  createSourceLoader(ts.ScriptTarget[target])(path.join(root, "src/big.ts")).default]));
const sink = new Array(32);
function batch(fn, count) { for (let i = 0; i < count; i++) sink[i & 31] = fn(i & 31); }
function elapsed(fn, count) {
  const start = process.hrtime.bigint(); batch(fn, count);
  return Number(process.hrtime.bigint() - start);
}
function measure(fn) {
  const end = performance.now() + 10;
  do { batch(fn, 32); } while (performance.now() < end);
  let count = 32, duration;
  do { duration = elapsed(fn, count); if (duration < 2e6) count *= 2; } while (duration < 2e6);
  let ns = 0, operations = 0;
  do { ns += elapsed(fn, count); operations += count; } while (ns < 75e6);
  assert.notEqual(sink[0], undefined);
  return ns / operations;
}

const worker = process.argv.indexOf("--worker");
if (worker >= 0) {
  const round = Number(process.argv[worker + 1]), rows = [];
  for (const group of round % 2 ? [...groups].reverse() : groups) {
    const pairs = inputs(group);
    const cases = Object.fromEntries(targets.map(target => [target, bigCases(constructors[target], pairs)]));
    for (const operation of operationNames) {
      for (let i = 0; i < 32; i++) {
        const value = target => { const result = cases[target][operation](i); return typeof result === "object" ? result.valueOf() : result; };
        assert.equal(value("ES2020"), value("ES2022"), `${group}/${operation}/${i}`);
      }
      const values = {};
      for (const target of (round + rows.length) % 2 ? [...targets].reverse() : targets) values[target] = measure(cases[target][operation]);
      rows.push({ group, operation, ...values });
    }
  }
  fs.writeFileSync(path.join(directory, `run-${round + 1}.json`), JSON.stringify(rows, null, 2) + "\n");
} else {
  for (let round = 0; round < 5; round++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", String(round)], { stdio: "inherit", cwd: root });
    if (result.status !== 0) process.exit(result.status || 1);
    console.log(`Target comparison round ${round + 1}/5 complete`);
  }
  const runs = Array.from({ length: 5 }, (_, i) => JSON.parse(fs.readFileSync(path.join(directory, `run-${i + 1}.json`), "utf8")));
  const median = values => [...values].sort((a, b) => a - b)[2];
  const rows = runs[0].map(first => {
    const samples = Object.fromEntries(targets.map(target => [target, runs.map(run => run.find(row => row.group === first.group && row.operation === first.operation)[target])]));
    const medians = Object.fromEntries(targets.map(target => [target, median(samples[target])]));
    return { group: first.group, operation: first.operation, medianNs: medians, samplesNs: samples,
      es2020TimeRatio: medians.ES2020 / medians.ES2022 };
  });
  fs.writeFileSync(path.join(directory, "comparison.json"), JSON.stringify({ generatedAt: new Date().toISOString(),
    cpu: os.cpus()[0]?.model, node: process.version, methodology: { rounds: 5, measurementMs: 75, warmupMs: 10,
      cases: 80, scope: "same current source, two TS emit targets, CommonJS, Node; ratio >1 means ES2020 slower; not an old-browser benchmark" }, rows }, null, 2) + "\n");
  for (const row of rows.filter(row => row.operation === "endToEnd")) console.log(row.group, row.medianNs, row.es2020TimeRatio);
}
