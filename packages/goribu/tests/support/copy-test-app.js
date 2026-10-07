import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Copy only application inputs. Never copy a developer's env files, generated
// output, or local databases. Callers own cleanup of the returned directory.
export function copyTestApp(source, prefix, extraPaths = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  try {
    for (const path of ["package.json", "goribu.config.js", "vite.config.js", "src", "public", ...extraPaths]) {
      cpSync(join(source, path), join(root, path), { recursive: true });
    }
    symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
