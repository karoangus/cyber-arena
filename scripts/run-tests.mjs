// اجرای تست‌های منطقی: باندل ورودی با esbuild (همان وابستگی‌ای که Vite استفاده می‌کند) و اجرا در Node.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, "logic-test.entry.mts");
const out = join(mkdtempSync(join(tmpdir(), "cyber-test-")), "logic-test.mjs");

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: out,
  logLevel: "warning",
});

const res = spawnSync(process.execPath, [out], { stdio: "inherit" });
process.exit(res.status ?? 1);
