// اجرای تست‌ها: باندل ورودی‌ها با esbuild (همان وابستگی‌ای که Vite استفاده می‌کند) و اجرا در Node.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const suites = [
  {
    name: "logic",
    entry: join(__dirname, "logic-test.entry.mts"),
    alias: {},
  },
  {
    name: "engine",
    entry: join(__dirname, "engine-test.entry.mts"),
    // در تست موتور، WebGLRenderer با استاب headless جایگزین می‌شود تا بدون GPU اجرا شود
    alias: { three: join(__dirname, "three-headless-stub.mts") },
  },
];

let failed = false;
for (const s of suites) {
  console.log(`\n===== suite: ${s.name} =====`);
  const out = join(mkdtempSync(join(tmpdir(), `cyber-test-${s.name}-`)), `${s.name}-test.mjs`);
  await build({
    entryPoints: [s.entry],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    outfile: out,
    alias: s.alias,
    logLevel: "warning",
  });
  const res = spawnSync(process.execPath, [out], { stdio: "inherit" });
  if ((res.status ?? 1) !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
