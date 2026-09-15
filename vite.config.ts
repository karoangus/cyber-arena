import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  // مسیر نسبی تا بازی در هر زیرپوشه‌ای (مثل GitHub Pages /cyber-arena/) درست کار کند
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // روی همه‌ی اینترفیس‌ها گوش بده تا از بیرون (پیش‌نمایش/موبایل) قابل دسترسی باشد
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: "es2020",
    // خروجی در app/ ساخته و در مخزن کامیت می‌شود تا GitHub Pages حالت legacy
    // (سرو ریشه‌ی مخزن) هم بازیِ ساخته‌شده را سرو کند — index.html ریشه به ./app/ پرش می‌کند.
    outDir: "app",
    assetsInlineLimit: 100000000,
    reportCompressedSize: false,
  },
});
