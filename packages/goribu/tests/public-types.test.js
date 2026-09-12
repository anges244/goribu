import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const packageRoot = new URL("../", import.meta.url);

it("type-checks real public imports and rejects invalid application contracts", () => {
  for (const module of ["ESNext", "NodeNext"]) {
    const result = spawnSync(process.execPath, [
      fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
      "-p", fileURLToPath(new URL("./types/tsconfig.json", import.meta.url)),
      "--module", module, "--moduleResolution", module === "NodeNext" ? "NodeNext" : "Bundler",
    ], { encoding: "utf8", timeout: 30000 });
    expect(result.error).toBeUndefined();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }
}, 65000);

it("keeps declarations at all public entries synchronized with JavaScript value exports", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
  const files = Object.values(pkg.exports).flatMap((entry) => [entry.default, entry.types]);
  const program = ts.createProgram(files.map((path) => fileURLToPath(new URL(path, packageRoot))), {
    // This guard compares entry exports only. The fixture above checks resolved
    // signatures; loading every runtime dependency here adds no further proof.
    allowJs: true, noEmit: true, noResolve: true, noLib: true, module: ts.ModuleKind.ESNext,
  });
  const checker = program.getTypeChecker();
  function values(path) {
    const source = program.getSourceFile(fileURLToPath(new URL(path, packageRoot)));
    const symbol = checker.getSymbolAtLocation(source);
    return checker.getExportsOfModule(symbol).filter((item) => {
      if (!path.endsWith(".d.ts")) return true;
      const resolved = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
      return resolved.flags & ts.SymbolFlags.Value;
    }).map((item) => item.name).sort();
  }
  for (const entry of Object.values(pkg.exports)) {
    expect(values(entry.types), entry.default).toEqual(values(entry.default));
  }
}, 15000);
