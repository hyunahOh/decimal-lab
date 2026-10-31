import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map();

/** Compile local TypeScript once in memory, outside all benchmark timing. */
export function loadSource(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  });
  const evaluate = vm.runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, { filename });
  evaluate(specifier => {
    if (!specifier.startsWith(".")) throw new Error(`Unexpected source import: ${specifier}`);
    return loadSource(path.resolve(path.dirname(filename), `${specifier}.ts`));
  }, module, module.exports);
  return module.exports;
}
