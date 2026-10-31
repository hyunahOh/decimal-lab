import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Reference from "big.js";
import { loadSource, compilationTarget } from "./source-loader.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const Local = loadSource(path.join(root, "src/big.ts")).default;
const reportDir = path.join(root, "reports");
const samples = 5;
const measurementMs = 75;
const warmupMs = 20;
const groups = ["small", "boundary", "30-digit", "100-digit", "1000-digit"];

function inputs(group) {
  let seed = 20261031;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const digits = length => Array.from({ length }, (_, i) => String(i === 0 ? random() % 9 + 1 : random() % 10)).join("");
  const result = [];
  for (let i = 0; i < 32; i++) {
    const length = group === "small" ? [3, 6, 9, 12][i % 4]
      : group === "boundary" ? [15, 16][i % 2] : parseInt(group, 10);
    const a = group === "boundary" ? ["999999999999999", "1000000000000000", "1000000000000001", "9999999999999999"][i % 4] : digits(length);
    const b = digits(length);
    // Decimal scales differ, both signs occur, denominators are always nonzero.
    result.push([`${i % 3 === 0 ? "-" : ""}${a}e-${[2, 2, 4, 0, 6, 2, 1, 3][i % 8]}`,
      `${i % 5 === 0 ? "-" : ""}${b}e-${[2, 3, 2, 0][i % 4]}`]);
  }
  return result;
}

function cases(Constructor, pairs) {
  const Big = Constructor(); Big.DP = 20; Big.RM = Big.roundHalfEven;
  const a = pairs.map(pair => Big(pair[0])), b = pairs.map(pair => Big(pair[1]));
  const positive = a.map(value => value.abs());
  return {
    construct: i => Big(pairs[i][0]),
    plus: i => a[i].plus(b[i]),
    minus: i => a[i].minus(b[i]),
    times: i => a[i].times(b[i]),
    div: i => a[i].div(b[i]),
    mod: i => a[i].mod(b[i]),
    sqrt: i => positive[i].sqrt(),
    pow3: i => a[i].pow(3),
    round2: i => a[i].round(2),
    prec10: i => a[i].prec(10),
    cmp: i => a[i].cmp(b[i]),
    toString: i => a[i].toString(),
    toFixed2: i => a[i].toFixed(2),
    toPrecision10: i => a[i].toPrecision(10),
    toExponential8: i => a[i].toExponential(8),
    // Same chained work, including construction, intermediate allocations and final output.
    endToEnd: i => Big(pairs[i][0]).plus(pairs[i][1]).times("1.1").div("3").toFixed(2),
  };
}

const sink = new Array(32);
function batch(operation, iterations) {
  for (let i = 0; i < iterations; i++) sink[i & 31] = operation(i & 31);
}
function timeBatch(operation, iterations) {
  const start = process.hrtime.bigint();
  batch(operation, iterations);
  return Number(process.hrtime.bigint() - start);
}
function measure(operation) {
  const warmupEnd = performance.now() + warmupMs;
  do { batch(operation, 32); } while (performance.now() < warmupEnd);
  // Calibrate until a batch lasts at least 2ms, then measure >=75ms total.
  let iterations = 32, elapsed;
  do {
    elapsed = timeBatch(operation, iterations);
    if (elapsed < 2e6) iterations *= 2;
  } while (elapsed < 2e6);
  let nanoseconds = 0, count = 0;
  do {
    nanoseconds += timeBatch(operation, iterations);
    count += iterations;
  } while (nanoseconds < measurementMs * 1e6);
  assert.notEqual(sink[0], undefined);
  return { nsPerOp: nanoseconds / count, operations: count, elapsedNs: nanoseconds };
}

function worker(round) {
  const rows = [];
  for (const group of groups) {
    const pairs = inputs(group), local = cases(Local, pairs), reference = cases(Reference, pairs);
    // Correctness checks and parsing all operands happen before measurement.
    for (const name of Object.keys(local)) {
      for (let i = 0; i < pairs.length; i++) {
        const stringify = value => typeof value === "object" ? value.valueOf() : value;
        assert.equal(stringify(local[name](i)), stringify(reference[name](i)), `${group}/${name}/${i}`);
      }
    }
    const names = Object.keys(local);
    if (round % 2) names.reverse();
    for (const name of names) {
      // Alternate library order between rounds and cases to reduce order bias.
      const order = (round + names.indexOf(name)) % 2 ? ["big.js", "decimal-lab"] : ["decimal-lab", "big.js"];
      const row = { group, operation: name };
      for (const library of order) row[library] = measure(library === "big.js" ? reference[name] : local[name]);
      rows.push(row);
    }
  }
  fs.writeFileSync(path.join(reportDir, `benchmark-run-${round + 1}.json`), JSON.stringify(rows, null, 2) + "\n");
}

fs.mkdirSync(reportDir, { recursive: true });
const workerIndex = process.argv.indexOf("--worker");
if (workerIndex >= 0) {
  worker(Number(process.argv[workerIndex + 1]));
} else {
  console.log(`Node ${process.version}; ${os.cpus()[0]?.model}; ${samples} fresh processes; DP=20, RM=HALF_EVEN`);
  for (let round = 0; round < samples; round++) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", String(round)], { cwd: root, encoding: "utf8" });
    if (result.status !== 0) { process.stderr.write(result.stderr || result.stdout); process.exit(result.status || 1); }
    console.log(`Completed round ${round + 1}/${samples}`);
  }
  const runs = Array.from({ length: samples }, (_, i) => JSON.parse(fs.readFileSync(path.join(reportDir, `benchmark-run-${i + 1}.json`), "utf8")));
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const rows = runs[0].map(first => {
    const samplesForCase = runs.map(run => run.find(row => row.group === first.group && row.operation === first.operation));
    const values = library => samplesForCase.map(row => row[library].nsPerOp);
    const local = values("decimal-lab"), reference = values("big.js");
    return { group: first.group, operation: first.operation,
      localNs: median(local), bigJsNs: median(reference),
      speedup: median(reference) / median(local),
      localMinNs: Math.min(...local), localMaxNs: Math.max(...local),
      bigJsMinNs: Math.min(...reference), bigJsMaxNs: Math.max(...reference),
      localSamplesNs: local, bigJsSamplesNs: reference };
  }).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.operation.localeCompare(b.operation));
  const report = { generatedAt: new Date().toISOString(), compilationTarget, node: process.version, v8: process.versions.v8,
    os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, bigJsVersion: "7.0.1",
    methodology: { independentProcesses: samples, minMeasurementMs: measurementMs, warmupMs,
      operandsPerCase: 32, DP: 20, RM: "HALF_EVEN", statistic: "median ns/op across processes",
      speedup: "big.js time / decimal-lab time; >1 means decimal-lab is faster",
      allocation: "all results written to a 32-slot sink; natural GC included; no forced GC",
      correctness: "each operation checked against big.js for every input before timing",
      scope: "public API on Node; no browser or heap-memory comparison; mixed signs and scales; small labels input coefficients only" }, rows };
  fs.writeFileSync(path.join(reportDir, "benchmark-comparison.json"), JSON.stringify(report, null, 2) + "\n");
  const columns = ["group", "operation", "localNs", "bigJsNs", "speedup", "localMinNs", "localMaxNs", "bigJsMinNs", "bigJsMaxNs"];
  fs.writeFileSync(path.join(reportDir, "benchmark-comparison.csv"), columns.join(",") + "\n" + rows.map(row => columns.map(column => row[column]).join(",")).join("\n") + "\n");
  console.log("group        operation         decimal-lab ns/op  big.js ns/op  speedup (>1 local faster)");
  for (const row of rows) console.log(`${row.group.padEnd(12)} ${row.operation.padEnd(17)} ${row.localNs.toFixed(0).padStart(17)} ${row.bigJsNs.toFixed(0).padStart(13)} ${row.speedup.toFixed(2).padStart(8)}x`);
}
