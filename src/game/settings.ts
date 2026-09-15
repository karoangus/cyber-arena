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
  return Number(localStorage.getItem("cyber_best") || 0);
}
