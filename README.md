# نبرد سایبری — Cyber Arena 3D

شوتر اول‌شخص سه‌بعدی تحت وب (WebGL با Three.js + React + Vite) که هم روی **موبایل** (جوی‌استیک لمسی) و هم روی **دسکتاپ** (WASD + ماوس با Pointer Lock) اجرا می‌شود. پروژه به‌صورت یک **وب‌اپ پیشرونده (PWA)** آماده شده: قابل نصب روی صفحهٔ خانهٔ گوشی و دارای manifest، آیکون‌ها و Service Worker برای اجرای آفلاین پوستهٔ اپ.

نسخهٔ اصلی بازی که این مخزن از روی آن ساخته شده در `archive/original-game-source.zip` نگهداری می‌شود.

## شروع سریع

```bash
npm install
npm run dev        # سرور توسعه روی http://localhost:5173 (باز از بیرون هم قابل دسترسی است)
```

پیش‌نمایش زندهٔ همان سرور توسعه در محیط Arena به‌صورت خودکار نمایش داده می‌شود.

## بیلد تولید (وب‌اپ)

```bash
npm run build      # typecheck + باندل تک‌فایلی در dist/
npm run preview    # سرو بیلد تولید روی http://localhost:4173
```

خروجی `dist/` شامل `index.html` تک‌فایلی (کل بازی داخل یک فایل) به‌همراه `manifest.webmanifest`، `sw.js` و `icons/` است. همین پوشه را روی هر هاست استاتیک (Netlify، Vercel، GitHub Pages یا حتی یک فایل‌سرور ساده) بگذارید و بازی به‌عنوان وب‌اپ قابل نصب خواهد بود؛ در بیلد تولید Service Worker ثبت می‌شود و دکمهٔ «نصب روی گوشی / دسکتاپ» در منوی شروع ظاهر می‌شود (در صورت پشتیبانی مرورگر).

## دیپلوی (GitHub Pages)

بیلد تولیدی به‌صورت خودکار با GitHub Actions روی GitHub Pages منتشر می‌شود (`.github/workflows/deploy-pages.yml`): هر push به `main` → typecheck + build → انتشار `dist/` روی Pages.

> نکته: Pages باید روی حالت **GitHub Actions** باشد (Settings → Pages → Source: GitHub Actions)، نه «Deploy from branch». اگر روی branch باشد، سورس خام (TSX) سرو می‌شود که در مرورگر اجرا نمی‌شود و پیام «بازی لود نشد» می‌بیند — این دقیقاً باگ قبلی بود.

## آفلاین

بازی ۱۰۰٪ آفلاین اجرا می‌شود و **هیچ درخواستی به اینترنت ندارد**:

- فونت وزیرمتن به‌صورت لوکال در `src/assets/fonts` باندل می‌شود (بدون CDN گوگل).
- بیلد تولید تک‌فایلی است (کل بازی در `dist/index.html`).
- Service Worker کل پوسته را از پیش کش می‌کند (offline-first): بعد از اولین بازدید، بازی بدون اینترنت بالا می‌آید و نسخه‌های جدید در پس‌زمینه کش می‌شوند و در بازدید بعدی اعمال می‌شوند.
- نگهبان بوت (`index.html`) اگر مشکلی پیش بیاید وضعیت واقعی را نشان می‌دهد (آفلاین بودن دستگاه / کش خراب) و دکمه‌ی «پاک کردن کش و شروع دوباره» دارد.

## تست و بررسی

```bash
npm run typecheck  # tsc --noEmit
npm test           # دو سوئیت: logic + engine (اجرای کد واقعی shipped در Node)
```

- سوئیت `logic`: برخورد دایره، محدودسازی میدان، دید مستقیم و ذخیرهٔ تنظیمات.
- سوئیت `engine`: اجرای headless خودِ موتور (`src/game/engine.ts`) با WebGLRenderer تقلبی — حلقهٔ update، موج‌ها، هوش دشمن، شلیک، آیتم‌ها، مرگ/restart، ورودی کیبورد/ماوس و سناریوی localStorage بلاک‌شده.

> نکته: در این محیط sandbox مرورگر و GPU در دسترس نبود؛ بنابراین رفتار رندر/WebGL در مرورگر واقعی با کلیک روی پیش‌نمایش زنده بررسی شود. `npm test` مسیرهای منطقی و رفتاری موتور را با اجرای خودِ کد shipped تأیید می‌کند.

## عیب‌یابی لود نشدن بازی

اگر به‌جای بازی پیام خطا دیدی:

1. **«دستگاه آفلاین است»** یعنی اینترنت وصل نیست و هنوز اولین بارگذاری انجام نشده. برای بار اول یک‌بار اینترنت را وصل کن و بازی را باز کن؛ از آن به بعد بازی کامل آفلاین اجرا می‌شود.
2. **«بازی لود نشد» / «لود بازی طول کشید»** (وقتی اینترنت وصل است) یعنی کش قدیمیِ نسخه‌ی قبلی سایت خراب مانده — دکمه‌ی «پاک کردن کش و شروع دوباره» را بزن تا سرویس‌ورکر و کش پاک و صفحه تازه لود شود.
3. **«گرافیک بازی لود نشد»** یعنی WebGL در دسترس نیست — شتاب سخت‌افزاری (Hardware Acceleration) را در تنظیمات مرورگر فعال کن، از Chrome/Safari به‌روز استفاده کن و مطمئن شو JavaScript فعال است.
4. اگر از نسخهٔ نصب‌شده (PWA) استفاده می‌کنی و بعد از آپدیت مشکل داری، یک‌بار اپ را حذف و دوباره نصب کن تا Service Worker قدیمی پاک شود.

## بازتولید آیکون‌ها

آیکون‌ها بدون هیچ وابستگی خارجی، به‌صورت رویه‌ای (SDF + رمزنگاری PNG دستی) تولید می‌شوند:

```bash
node scripts/make-icons.mjs
```

## کنترل‌ها

| ورودی | عملکرد |
| --- | --- |
| نیمهٔ چپ صفحه / WASD | حرکت (جوی‌استیک پویا) |
| کشیدن کامل جوی‌استیک رو به جلو / Shift | دویدن |
| نیمهٔ راست صفحه / ماوس | چرخش دید |
| دکمهٔ شلیک / کلیک چپ | شلیک (نگه‌داشتن + کشیدن = شلیک و چرخش) |
| دکمهٔ پرش / کشیدن انگشت به بالا روی شلیک / Space | پرش |
| دکمهٔ انفجار موج / Q | انفجار موج (آسیب گسترده) |
| R | پر کردن خشاب |

## ساختار مخزن

```
├── index.html            # پوستهٔ اپ + متاهای PWA + اسپلش بارگذاری + نگهبان بوت
├── public/               # manifest، sw.js و آیکون‌ها
├── scripts/              # تست منطقی + تست headless موتور + تولیدکنندهٔ آیکون
├── src/
│   ├── App.tsx           # چرخهٔ بازی (منو/بازی/توقف/مرگ) و HUD
│   ├── components/       # Hud، TouchControls، Overlays (منوها/تنظیمات)، ErrorBoundary
│   ├── game/             # موتور Three.js: engine، world، effects، audio، settings
│   └── pwa.ts            # ثبت SW و رویداد نصب
└── archive/              # zip اصلی بازی
```

---

# Cyber Arena 3D (English)

A 3D first-person wave shooter that runs fully in the browser (Three.js + React + Vite), playable on mobile (touch joysticks) and desktop (WASD + pointer-lock mouse). Packaged as an installable PWA with manifest, icons and an offline-capable service worker.

- Dev: `npm install && npm run dev`
- Production build (single-file app + PWA assets in `dist/`): `npm run build && npm run preview`
- Checks: `npm run typecheck`, `npm test`
- The original source zip is kept at `archive/original-game-source.zip`.
