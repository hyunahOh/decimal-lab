import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Reference from "big.js";
import { loadSource } from "./source-loader.mjs";
import { groups as allGroups, operationNames, inputs, bigCases, decimalCases } from "./benchmark-workloads.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const Local = loadSource(path.join(root, "src/big.ts")).default;
const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const groups = argument("--groups", allGroups.join(",")).split(",");
if (groups.some(group => !allGroups.includes(group)) || new Set(groups).size !== groups.length) throw new Error("Invalid groups");
const baselinePath = argument("--baseline", undefined);
const Baseline = baselinePath ? loadSource(path.resolve(baselinePath, "big.ts")).default : undefined;
const libraries = [...(Baseline ? ["before"] : []), "decimal-lab", "big.js", "decimal.js"];
const caseCount = groups.length * operationNames.length;
const minutes = Number(argument("--minutes", "10"));
const rounds = Number(argument("--rounds", "5"));
const isSmoke = process.argv.includes("--smoke");
if (!(minutes > 0) || !Number.isFinite(minutes) || !Number.isInteger(rounds) || rounds < 1) throw new Error("Invalid minutes/rounds");
const outputPath = argument("--output", undefined);
const directory = outputPath ? path.resolve(root, outputPath) : path.join(root, "reports", isSmoke ? "three-way-smoke" : "three-way");
fs.mkdirSync(directory, { recursive: true });
const measurementMs = minutes * 60_000 / (caseCount * rounds);
const sink = new Array(32);

function batch(operation, count) {
  for (let i = 0; i < count; i++) sink[i & 31] = operation(i & 31);
}
function timedBatch(operation, count) {
  const start = process.hrtime.bigint();
  batch(operation, count);
  return Number(process.hrtime.bigint() - start);
}
function measure(operation) {
  const warmupEnd = performance.now() + 20;
  let cursor = 0;
  do { sink[cursor & 31] = operation(cursor++ & 31); } while (performance.now() < warmupEnd);
  let iterations = 32, elapsed;
  do {
    elapsed = timedBatch(operation, iterations);
    if (elapsed < 2e6) iterations *= 2;
  } while (elapsed < 2e6);
  let elapsedNs = 0, operations = 0;
  do { elapsedNs += timedBatch(operation, iterations); operations += iterations; }
  while (elapsedNs < measurementMs * 1e6);
  assert.notEqual(sink[0], undefined);
  return { nsPerOp: elapsedNs / operations, elapsedNs, operations };
}

function workloads(group) {
  const pairs = inputs(group), decimal = decimalCases(pairs);
  return { pairs, settings: decimal.settings, cases: {
    ...(Baseline ? { before: bigCases(Baseline, pairs) } : {}),
    "decimal-lab": bigCases(Local, pairs), "big.js": bigCases(Reference, pairs), "decimal.js": decimal.cases,
  } };
}

if (process.argv.includes("--preflight")) {
  let assertions = 0;
  const settings = {};
  const representations = {};
  for (const group of groups) {
    const workload = workloads(group); settings[group] = workload.settings;
    const counts = () => ({ small: 0, big: 0, scalar: 0 });
    const kind = value => value && typeof value === "object" && value.data ? value.data.kind : "scalar";
    const inputsByKind = { a: counts(), b: counts() };
    for (const pair of workload.pairs) { inputsByKind.a[kind(Local(pair[0]))]++; inputsByKind.b[kind(Local(pair[1]))]++; }
    const resultsByKind = Object.fromEntries(operationNames.map(name => [name, counts()]));
    for (const name of operationNames) for (let i = 0; i < 32; i++) {
      const stringify = value => typeof value === "object" ? value.valueOf() : value;
      const expected = stringify(workload.cases["big.js"][name](i));
      for (const library of libraries.filter(library => library !== "big.js")) {
        const result = workload.cases[library][name](i);
        assert.equal(stringify(result), expected, `${library}/${group}/${name}/${i}`);
        if (library === "decimal-lab") resultsByKind[name][kind(result)]++;
        assertions++;
      }
    }
    representations[group] = { inputs: inputsByKind, results: resultsByKind };
    if (group === "small-6-digit") {
      assert.equal(resultsByKind.plus.small, 32);
      assert.equal(resultsByKind.times.small, 32);
    } else if (group === "small-promotion") {
      assert.equal(inputsByKind.a.small, 32); assert.equal(inputsByKind.b.small, 32);
      assert.equal(resultsByKind.plus.big, 32); assert.equal(resultsByKind.times.big, 32);
    }
    console.log(`Preflight ${group}: matching outputs across all ${libraries.length} implementations`);
  }
  fs.writeFileSync(path.join(directory, "preflight.json"), JSON.stringify({ assertions, settings, representations }, null, 2) + "\n");
} else if (process.argv.includes("--worker")) {
  const round = Number(argument("--worker", "0"));
  const rows = [];
  const startedAt = new Date().toISOString();
  const orderedGroups = round % 2 ? [...groups].reverse() : groups;
  let completed = 0;
  for (const group of orderedGroups) {
    const { cases } = workloads(group);
    const names = round % 2 ? [...operationNames].reverse() : operationNames;
    for (const operation of names) {
      const offset = (round + completed) % libraries.length;
      const order = [...libraries.slice(offset), ...libraries.slice(0, offset)];
      const row = { group, operation, round, measurements: {} };
      for (const library of order) row.measurements[library] = measure(cases[library][operation]);
      rows.push(row);
      completed++;
      if (completed % 8 === 0) console.log(`Round ${round + 1}/${rounds}: ${completed}/${caseCount} cases complete`);
      // Keep completed measurements if a long run is interrupted.
      fs.writeFileSync(path.join(directory, `run-${round + 1}.json`), JSON.stringify({ startedAt, rows }, null, 2) + "\n");
    }
  }
} else {
  const run = args => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args,
      "--minutes", String(minutes), "--rounds", String(rounds), "--groups", groups.join(","),
      ...(baselinePath ? ["--baseline", baselinePath] : []), ...(outputPath ? ["--output", outputPath] : []),
      ...(isSmoke ? ["--smoke"] : [])], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
  };
  const startedAt = new Date().toISOString();
  console.log(`Comparison: ~${minutes} measured minutes/library, ${rounds} independent rounds, ${caseCount} cases, ~${minutes * libraries.length} measured minutes total + setup/warmup`);
  run(["--preflight"]);
  for (let round = 0; round < rounds; round++) run(["--worker", String(round)]);
  const runs = Array.from({ length: rounds }, (_, i) => JSON.parse(fs.readFileSync(path.join(directory, `run-${i + 1}.json`), "utf8")));
  const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
  const rows = groups.flatMap(group => operationNames.map(operation => {
    const measurements = {};
    for (const library of libraries) {
      const samples = runs.map(run => run.rows.find(row => row.group === group && row.operation === operation).measurements[library]);
      const values = samples.map(sample => sample.nsPerOp);
      measurements[library] = { medianNs: median(values), minNs: Math.min(...values), maxNs: Math.max(...values),
        measuredSeconds: samples.reduce((sum, sample) => sum + sample.elapsedNs / 1e9, 0), samples };
    }
    return { group, operation, measurements, fastest: libraries.reduce((a, b) => measurements[a].medianNs < measurements[b].medianNs ? a : b) };
  }));
  const totals = Object.fromEntries(libraries.map(library => [library, rows.reduce((sum, row) => sum + row.measurements[library].measuredSeconds, 0)]));
  const sourceFiles = fs.readdirSync(path.join(root, "src")).filter(name => name.endsWith(".ts")).sort();
  const sourceHash = createHash("sha256");
  for (const name of sourceFiles) sourceHash.update(name).update(fs.readFileSync(path.join(root, "src", name)));
  const benchmarkHash = createHash("sha256");
  for (const name of ["bench-three-way.mjs", "benchmark-workloads.mjs", "source-loader.mjs"]) {
    benchmarkHash.update(name).update(fs.readFileSync(path.join(root, "scripts", name)));
  }
  const packageVersion = library => JSON.parse(fs.readFileSync(path.join(root, "node_modules", library, "package.json"), "utf8")).version;
  const report = { startedAt, completedAt: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    cpu: os.cpus()[0]?.model, os: `${os.platform()} ${os.release()} ${os.arch()}`, sourceSha256: sourceHash.digest("hex"), benchmarkSha256: benchmarkHash.digest("hex"),
    versions: { "big.js": packageVersion("big.js"), "decimal.js": packageVersion("decimal.js") },
    methodology: { rounds, targetMinutesPerLibrary: minutes, actualMeasuredSeconds: totals,
      cases: caseCount, groups, ...(baselinePath ? { baselinePath } : {}), operandPairsPerCase: 32, minMeasurementMsPerRoundAndCase: measurementMs, warmupMsPerCase: 20,
      sampling: "equal time per case/library; median across independent Node processes; alternating group/operation order and rotating library order",
      allocation: "all outputs escape through a 32-slot sink, natural GC included; no forced GC; memory not benchmarked",
      rounding: "HALF_EVEN; division/sqrt final output 20 decimal places; exact +/-/*/cube",
      decimalAdaptation: "operation-specific cloned constructors; exact precision sufficient for all digits; div/sqrt/chain precision sized for integer digits + 20 decimal places + 10 guard digits; toDP(20) included in timing",
      scope: "fixed mixed-sign/scale inputs on Node, no browser or arbitrary-input correctness guarantee from benchmark preflight" },
    preflight: JSON.parse(fs.readFileSync(path.join(directory, "preflight.json"), "utf8")), rows };
  fs.writeFileSync(path.join(directory, "comparison.json"), JSON.stringify(report, null, 2) + "\n");
  const columns = ["group", "operation", ...libraries.map(library => `${library} ns/op`), "fastest"];
  fs.writeFileSync(path.join(directory, "comparison.csv"), columns.join(",") + "\n" + rows.map(row => [row.group, row.operation,
    ...libraries.map(library => row.measurements[library].medianNs), row.fastest].join(",")).join("\n") + "\n");
  console.log(`Measured seconds/library: ${JSON.stringify(totals)}`);
  console.log(`Results: ${directory}/comparison.json`);
}
