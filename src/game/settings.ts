export interface Settings {
  sensitivity: number;
  sound: boolean;
  autoFire: boolean;
  haptics: boolean;
}

export const defaultSettings: Settings = {
  sensitivity: 1.1,
  sound: true,
  autoFire: true,
  haptics: true,
};

const KEY = "cyber_arena_settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function bestScore(): number {
  try {
    const n = Number(localStorage.getItem("cyber_best") || 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    // دسترسی به حافظه ممکن است بلاک باشد (حالت خصوصی/آی‌فریم محدود) — بازی نباید بترکد
    return 0;
  }
}

/** ذخیره رکورد (در صورت بلاک بودن حافظه، بی‌صدا نادیده گرفته می‌شود) */
export function saveBest(score: number) {
  try {
    const prev = bestScore();
    if (score > prev) localStorage.setItem("cyber_best", String(Math.round(score)));
  } catch {
    /* ignore */
  }
}
