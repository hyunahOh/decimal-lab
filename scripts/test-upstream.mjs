import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import Reference from "big.js";
import { loadSource, compilationTarget } from "./source-loader.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const upstream = path.join(root, "test/upstream/big.js");

const implementation = process.argv.includes("--reference") ? "big.js 7.0.1" : "decimal-lab";
const Constructor = implementation === "decimal-lab" ? loadSource(path.join(root, "src/big.ts")).default : Reference;
const methods = fs.readdirSync(path.join(upstream, "methods")).filter(name => name.endsWith(".js")).sort();
const results = [];
console.log(`Upstream v7.0.1 tests against ${implementation} (unmodified assertions)`);

for (const method of methods) {
  let output = "";
  const context = vm.createContext({
    // Share host Error so upstream's instanceof Error also recognises source errors.
    Error, TypeError, RangeError, SyntaxError,
    process: { stdout: { write: text => { output += text; } } },
    require: specifier => {
      if (specifier === "../big") return Constructor();
      throw new Error(`Unexpected upstream require: ${specifier}`);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(upstream, "test.js"), "utf8"), context, { filename: "upstream/test.js" });
  // Preserve partial assertion counts even if a suite throws before test.result
  // is assigned (e.g. an assertion directly reads unsupported internal fields).
  let passed = 0, total = 0;
  for (const name of ["areEqual", "isException", "isNegativeZero", "isPositiveZero", "isTrue"]) {
    const original = context.test[name];
    context.test[name] = (...args) => {
      total++;
      const offset = output.length;
      const result = original(...args);
      if (!output.slice(offset).includes("Test number")) passed++;
      return result;
    };
  }
  let error;
  try {
    vm.runInContext(fs.readFileSync(path.join(upstream, "methods", method), "utf8"), context, {
      filename: `upstream/methods/${method}`, timeout: 30_000,
    });
  } catch (caught) { error = caught.stack || String(caught); }
  const failures = [...output.matchAll(/Test number (\d+) failed\n  Expected: ([\s\S]*?)\n  Actual:   ([\s\S]*?)(?=\n  Test number|\n? \d+ of \d+ tests passed|$)/g)]
    .map(match => ({ number: Number(match[1]), expected: match[2], actual: match[3] }));
  const result = { method: method.replace(/\.js$/, ""), passed, total, failed: total - passed, ...(error ? { error } : {}), failures };
  results.push(result);
  console.log(`${result.method.padEnd(15)} ${passed}/${total}${error ? " ABORTED" : passed === total ? " PASS" : " FAIL"}`);
  for (const failure of failures.slice(0, 2)) console.log(`  #${failure.number} expected ${failure.expected.slice(0, 160)}; actual ${failure.actual.slice(0, 160)}`);
  if (error) console.log(`  ${error.split("\n").slice(0, 3).join("\n  ")}`);
}

const summary = {
  implementation,
  compilationTarget: implementation === "decimal-lab" ? compilationTarget : null,
  upstreamCommit: "e19cc83cb965bdef18cb31423d81f60140c9e7be",
  passed: results.reduce((sum, item) => sum + item.passed, 0),
  total: results.reduce((sum, item) => sum + item.total, 0),
  abortedSuites: results.filter(item => item.error).length,
  results,
};
if (implementation === "decimal-lab") {
  const baselinePath = path.join(root, "reports/upstream-reference.json");
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    if (baseline.upstreamCommit === summary.upstreamCommit && baseline.abortedSuites === 0) {
      summary.expectedTotal = baseline.total;
      summary.notExecuted = baseline.total - summary.total;
    }
  }
}
console.log(`Total: ${summary.passed}/${summary.total}; aborted suites: ${summary.abortedSuites}`);
fs.mkdirSync(path.join(root, "reports"), { recursive: true });
fs.writeFileSync(path.join(root, "reports", implementation === "decimal-lab" ? "upstream-tests.json" : "upstream-reference.json"), JSON.stringify(summary, null, 2) + "\n");
if (summary.passed !== summary.total || summary.abortedSuites) process.exitCode = 1;
