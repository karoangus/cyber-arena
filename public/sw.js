/* سرویس‌ورکر نبرد سایبری — اجرای ۱۰۰٪ آفلاین
   کل پوسته‌ی بازی (تک‌فایل HTML + آیکون‌ها + منیفست) از قبل کش می‌شود؛
   بعد از اولین بازدید، بازی بدون هیچ اینترنتی بالا می‌آید. */
const VERSION = "cyber-arena-v2-offline";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // بازی هیچ وابستگی خارجی ندارد؛ درخواست‌های خارج از مبدأ را رد کن
  if (url.origin !== self.location.origin) return;

  // آفلاین‌اول (stale-while-revalidate):
  // ۱) جواب فوری از کش (حتی بدون اینترنت)
  // ۲) به‌روزرسانی کش در پس‌زمینه، تا نسخه‌ی جدید در بازدید بعدی اعمال شود
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: req.mode === "navigate" }).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req.mode === "navigate" ? new Request("./") : req, res.clone());
            return res;
          })
          .catch(() => hit || Response.error());
        // اگر در کش بود، همان را فوری برگردان؛ شبکه در پس‌زمینه کش را تازه می‌کند
        return hit || network;
      })
    )
  );
});
