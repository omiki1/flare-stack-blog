#!/usr/bin/env node
/**
 * Portable TypeScript 7 type checker.
 *
 * Why this file exists
 * --------------------
 * The repository's `typecheck` / `check` scripts invoke the compiler as
 * `./node_modules/typescript/bin/tsc`. That path is a POSIX shell script with a
 * `#!/usr/bin/env node` shebang. It is executed by the shell on Linux/macOS and
 * by Bun's shell emulation in the repository's own CI, so upstream never needed
 * an alternative.
 *
 * On Windows neither the native `cmd`/PowerShell shell nor Bun's shell
 * emulation can execute that extensionless file, so `bun run check` fails with:
 *
 *   bun: command not found: ./node_modules/typescript/bin/tsc
 *
 * TypeScript 7 is a native compiler: the real binary is shipped in a
 * platform-specific optional dependency
 * (`@typescript/typescript-<platform>-<arch>` -> `lib/tsc.exe` on Windows,
 * `lib/tsc` elsewhere) and `node_modules/typescript/lib/getExePath.js` resolves
 * it. This wrapper calls Node's own resolution for that binary and forwards all
 * arguments, so the exact same compiler version runs on every platform.
 *
 * This is a fork-local, additive file. It does not modify any upstream file and
 * therefore cannot conflict when syncing with upstream. See
 * docs/PERSONALIZATION.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function resolveTscBinary() {
  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
  const binaryName = process.platform === "win32" ? "tsc.exe" : "tsc";

  let packageRoot;
  try {
    // The package only exports ./package.json, so resolve that and walk up.
    packageRoot = dirname(require.resolve(`${platformPackage}/package.json`));
  } catch {
    return null;
  }

  const candidate = join(packageRoot, "lib", binaryName);
  return existsSync(candidate) ? realpathSync(candidate) : null;
}

function fail(message) {
  console.error(`[typecheck] ${message}`);
  process.exit(1);
}

const binary = resolveTscBinary();

if (!binary) {
  fail(
    "Could not resolve the native TypeScript compiler from " +
      `@typescript/typescript-${process.platform}-${process.arch}. ` +
      "Run `bun install` first.",
  );
}

const result = spawnSync(binary, process.argv.slice(2), {
  stdio: "inherit",
});

if (result.error) {
  fail(`Failed to run ${binary}: ${result.error.message}`);
}

process.exit(result.status ?? 1);
