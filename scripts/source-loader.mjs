import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, path.dirname(configPath));
if (converted.errors.length) throw new Error(ts.flattenDiagnosticMessageText(converted.errors[0].messageText, "\n"));
export const compilationTarget = ts.ScriptTarget[converted.options.target];

/** A separate module cache permits same-source comparisons between emit targets. */
export function createSourceLoader(target = converted.options.target) {
  const modules = new Map();
  return function loadSource(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { target,
        useDefineForClassFields: converted.options.useDefineForClassFields, module: ts.ModuleKind.CommonJS },
      fileName: filename,
    });
    const evaluate = vm.runInThisContext(`(function(require, module, exports) {\n${outputText}\n})`, { filename });
    evaluate(specifier => {
      if (!specifier.startsWith(".")) throw new Error(`Unexpected source import: ${specifier}`);
      return loadSource(path.resolve(path.dirname(filename), `${specifier}.ts`));
    }, module, module.exports);
    return module.exports;
  };
}

/** Compile local TypeScript once in memory, outside all benchmark timing. */
export const loadSource = createSourceLoader();
