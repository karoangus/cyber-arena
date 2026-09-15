// ابزارهای وب‌اپ پیشرونده (PWA): ثبت سرویس‌ورکر و رویداد نصب

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();
let standalone = false;

function detectStandalone() {
  standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

if (typeof window !== "undefined") {
  detectStandalone();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l(true));
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l(false));
  });
}

/** آیا مرورگر اجازه‌ی نصب می‌دهد؟ */
export function onInstallable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(!!deferred && !standalone);
  return () => {
    listeners.delete(cb);
  };
}

/** نمایش دیالوگ نصب بومی مرورگر */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  try {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") deferred = null;
    return choice.outcome === "accepted";
  } catch {
    return false;
  }
}

/** ثبت سرویس‌ورکر فقط در بیلد تولید (تا HMR توسعه به هم نریزد) */
export function registerSW(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* نصب‌پذیری اختیاری است؛ بازی بدون آن هم کامل کار می‌کند */
    });
  });
}
