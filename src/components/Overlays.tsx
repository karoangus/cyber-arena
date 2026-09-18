import { useEffect, useState } from "react";
import type { Game } from "../game/engine";
import type { HudState } from "../game/types";
import type { Settings } from "../game/settings";
import { onInstallable, promptInstall } from "../pwa";

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button
      data-ui="1"
      onClick={() => onChange(!value)}
      className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-slate-900/60 px-3 py-2 text-right"
    >
      <span className="flex-1">
        <span className="block text-xs font-bold text-cyan-100">{label}</span>
        {hint ? <span className="block text-[10px] text-cyan-200/50">{hint}</span> : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          value ? "border-cyan-300/50 bg-cyan-500/70" : "border-slate-500/40 bg-slate-700/60"
        }`}
      >
        <span
          className={`absolute rounded-full bg-white transition-all ${value ? "left-0.5" : "left-[1.4rem]"}`}
          style={{ height: 18, width: 18, top: 2 }}
        />
      </span>
    </button>
  );
}

export function SettingsPanel({ settings, setSettings }: { settings: Settings; setSettings: (s: Settings) => void }) {
  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-cyan-400/20 bg-slate-900/60 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-xs font-bold text-cyan-100">
          <span>حساسیت چرخش دید</span>
          <span className="text-cyan-300">{settings.sensitivity.toFixed(1)}×</span>
        </div>
        <input
          data-ui="1"
          type="range"
          min={0.4}
          max={2.4}
          step={0.1}
          value={settings.sensitivity}
          onChange={(e) => setSettings({ ...settings, sensitivity: Number(e.target.value) })}
          className="pointer-events-auto h-6 w-full accent-cyan-400"
        />
      </div>
      <Toggle
        label="شلیک خودکار روی هدف"
        hint="وقتی نشانه روی دشمن باشد خودکار شلیک می‌شود"
        value={settings.autoFire}
        onChange={(v) => setSettings({ ...settings, autoFire: v })}
      />
      <Toggle label="صدا" value={settings.sound} onChange={(v) => setSettings({ ...settings, sound: v })} />
      <Toggle label="لرزش گوشی" value={settings.haptics} onChange={(v) => setSettings({ ...settings, haptics: v })} />
    </div>
  );
}

export function FullscreenButton({ wide = false }: { wide?: boolean }) {
  const [on, setOn] = useState(typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggle = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
        setOn(true);
        const orient = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
        await orient?.lock?.("landscape");
      } else {
        await document.exitFullscreen?.();
        setOn(false);
      }
    } catch {
      /* برخی مرورگرها اجازه نمی‌دهند */
    }
  };
  if (wide) {
    return (
      <button
        data-ui="1"
        onClick={toggle}
        className="touch-btn pointer-events-auto flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-slate-900/60 px-4 py-2 text-xs font-bold text-cyan-100"
      >
        {on ? "⤡ خروج از تمام‌صفحه" : "⛶ رفتن به حالت تمام‌صفحه"}
      </button>
    );
  }
  return (
    <button
      data-ui="1"
      onClick={toggle}
      title="تمام‌صفحه"
      className="touch-btn pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-slate-950/70 text-lg text-cyan-200"
    >
      {on ? "⤡" : "⛶"}
    </button>
  );
}

export function OrientationHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 z-40 -translate-y-1/2 px-6 sm:hidden portrait:block landscape:hidden">
      <div className="glass mx-auto max-w-xs rounded-2xl p-4 text-center">
        <div className="animate-[float-slow_2s_ease-in-out_infinite] text-3xl">📱↻</div>
        <div className="mt-2 text-sm font-bold text-cyan-100">گوشی را افقی بگیر</div>
        <div className="mt-1 text-[11px] text-cyan-200/60">برای تجربه بهتر و دید وسیع‌تر، دستگاه را در حالت افقی نگه دار.</div>
      </div>
    </div>
  );
}

export function StartScreen({
  onStart,
  settings,
  setSettings,
  best,
}: {
  onStart: () => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
  best: number;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => onInstallable(setInstallable), []);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return (
    <div className="scan-lines allow-scroll absolute inset-0 z-40 overflow-y-auto bg-gradient-to-b from-slate-950/92 via-slate-950/95 to-black/95 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-4">
        <div className="text-center">
          <div className="mb-1 text-[11px] tracking-[0.35em] text-cyan-300/70">CYBER ARENA 3D</div>
          <h1 className="text-4xl font-extrabold text-cyan-100 neon-text">نبرد سایبری</h1>
          <p className="mt-2 text-xs text-cyan-200/70">
            شوتر اول‌شخص سه‌بعدی مخصوص موبایل — در میدان نئونی زنده بمان و موج‌های ربات‌ها را نابود کن.
          </p>
          <div
            className={`mx-auto mt-3 flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold ${
              online ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300" : "border-amber-400/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-amber-400"}`} />
            {online ? "این بازی بدون اینترنت هم اجرا می‌شود ✅" : "آفلاینی — بازی کامل و بدون مشکل اجرا می‌شود ✅"}
          </div>
        </div>

        {best > 0 && (
          <div className="glass mx-auto rounded-2xl px-4 py-1.5 text-xs text-cyan-100">
            رکورد شما: <b className="text-amber-300">{best.toLocaleString("en-US")}</b>
          </div>
        )}

        <button
          data-ui="1"
          onClick={onStart}
          className="touch-btn pointer-events-auto relative mx-auto w-full max-w-xs rounded-2xl border border-cyan-200/50 bg-gradient-to-b from-cyan-400/90 to-sky-700/90 py-4 text-lg font-extrabold text-white shadow-[0_0_35px_rgba(34,211,238,0.45)]"
        >
          شروع بازی
        </button>

        <div className="glass rounded-2xl p-3">
          <div className="mb-2 text-xs font-bold text-cyan-100">راهنمای کنترل‌ها</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-cyan-100/85">
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-cyan-300">نیمه چپ صفحه</b>
              <div className="text-cyan-200/60">جوی‌استیک پویا — بیشتر بکشی سریع‌تر می‌روی</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-amber-300">دویدن ⚡</b>
              <div className="text-cyan-200/60">فقط جوی‌استیک را کامل <b className="text-cyan-100">رو به جلو</b> بکش</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-rose-300">دکمه شلیک</b>
              <div className="text-cyan-200/60">نگه‌دار و انگشتت را بکش تا دید هم بچرخد</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-sky-300">نشانه‌گیری 🎯</b>
              <div className="text-cyan-200/60">دکمه «نشانه» را نگه دار (دسکتاپ: کلیک راست یا G) — زوم، دقت بالا، سرعت کمتر</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-orange-300">اسلات‌ها 🔁</b>
              <div className="text-cyan-200/60">دکمه تعویض یا کلیدهای ۱/۲/۳ (چرخ ماوس هم کار می‌کند)</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-emerald-300">دست خالی / چاقو ✊</b>
              <div className="text-cyan-200/60">مهمات نمی‌خواهد ولی باید به دشمن بچسبی — پرریسک!</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-cyan-300">پرش</b>
              <div className="text-cyan-200/60">دکمه پرش یا کشیدن انگشت به بالا روی دکمه شلیک</div>
            </div>
            <div className="rounded-lg bg-slate-900/50 p-2">
              <b className="text-violet-300">انفجار موج</b>
              <div className="text-cyan-200/60">آسیب گسترده به دشمن‌های نزدیک</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded-lg bg-rose-500/10 p-2 text-rose-200">🔴 پهپاد: از دور شلیک می‌کند</div>
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-200">🟢 انتحاری: سریع، انفجاری</div>
            <div className="rounded-lg bg-violet-500/10 p-2 text-violet-200">🟣 سنگین: جان زیاد، رگبار</div>
          </div>
          <div className="mt-2 space-y-1 rounded-xl border border-amber-300/25 bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-100/90">
            <div>💵 هر کیل <b>۱ دلار</b> و هر باس <b>۱۰ دلار</b> — پول برای شاپ است.</div>
            <div>👹 هر <b>۱۰ موج</b> یک نبرد باس است؛ بعد از شکست باس، <b>شاپ ۱۰۰ ثانیه</b> باز می‌شود (آپگرید آسیب، خشاب، چاقو).</div>
            <div>🔋 خشاب دیگر خودکار پر نمی‌شود: برای موج بعد خودت <b>R</b> یا دکمه‌ی «خشاب» را بزن.</div>
          </div>
        </div>

        <div className="space-y-2">
          {installable && (
            <button
              data-ui="1"
              onClick={() => void promptInstall()}
              className="touch-btn pointer-events-auto flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-200"
            >
              ⬇ نصب روی گوشی / دسکتاپ (وب‌اپ)
            </button>
          )}
          <FullscreenButton wide />
          <button
            data-ui="1"
            onClick={() => setShowSettings((v) => !v)}
            className="pointer-events-auto w-full rounded-xl border border-cyan-400/25 bg-slate-900/60 px-4 py-2 text-xs font-bold text-cyan-100"
          >
            ⚙ تنظیمات {showSettings ? "▲" : "▼"}
          </button>
          {showSettings && <SettingsPanel settings={settings} setSettings={setSettings} />}
        </div>

        <p className="text-center text-[10px] text-cyan-200/40">
          نکته: با هدفون بازی کن و صفحه را افقی نگه دار. در دسکتاپ: WASD حرکت، Shift دویدن، ماوس نگاه، کلیک چپ شلیک،
          <b className="text-cyan-200/70"> کلیک راست یا G نشانه‌گیری</b>، R پرکردن خشاب، Q انفجار موج، ۱/۲/۳ یا چرخ ماوس تعویض اسلات.
        </p>
      </div>
    </div>
  );
}

export function PauseOverlay({
  onResume,
  onRestart,
  onMenu,
  settings,
  setSettings,
}: {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  return (
    <div className="allow-scroll absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-950/80 px-4 backdrop-blur-md">
      <div className="glass w-full max-w-sm rounded-3xl p-5">
        <div className="text-center text-2xl font-extrabold text-cyan-100 neon-text">توقف موقت</div>
        <div className="mt-4 space-y-2">
          <button
            data-ui="1"
            onClick={onResume}
            className="touch-btn pointer-events-auto w-full rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-400/85 to-sky-700/85 py-3 font-extrabold text-white"
          >
            ادامه بازی
          </button>
          <button
            data-ui="1"
            onClick={onRestart}
            className="touch-btn pointer-events-auto w-full rounded-2xl border border-slate-400/25 bg-slate-800/70 py-2.5 text-sm font-bold text-cyan-100"
          >
            شروع دوباره
          </button>
          <button
            data-ui="1"
            onClick={onMenu}
            className="touch-btn pointer-events-auto w-full rounded-2xl border border-slate-400/25 bg-slate-800/70 py-2.5 text-sm font-bold text-cyan-100"
          >
            منوی اصلی
          </button>
        </div>
        <div className="mt-3">
          <FullscreenButton wide />
        </div>
        <div className="mt-4">
          <div className="mb-2 text-xs font-bold text-cyan-100">تنظیمات</div>
          <SettingsPanel settings={settings} setSettings={setSettings} />
        </div>
      </div>
    </div>
  );
}

/** تایمر mm:ss برای وقفه‌ی شاپ */
function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** کارت یک آیتم شاپ */
function ShopItem({
  icon,
  title,
  desc,
  price,
  disabled,
  owned,
  affordable,
  onBuy,
}: {
  icon: string;
  title: string;
  desc: string;
  price: number;
  disabled?: boolean;
  owned?: boolean;
  affordable: boolean;
  onBuy: () => void;
}) {
  const blocked = disabled || owned || !affordable;
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border p-3 text-right transition-colors ${
        owned
          ? "border-emerald-300/40 bg-emerald-500/10"
          : blocked
            ? "border-slate-500/25 bg-slate-900/40 opacity-70"
            : "border-cyan-400/30 bg-slate-900/60"
      }`}
    >
      <div className="text-2xl">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-extrabold text-cyan-50">{title}</div>
        <div className="mt-0.5 text-[10px] leading-relaxed text-cyan-200/60">{desc}</div>
      </div>
      <button
        data-ui="1"
        onClick={onBuy}
        disabled={blocked}
        className={`touch-btn pointer-events-auto shrink-0 rounded-xl border px-3 py-2 text-[11px] font-extrabold ${
          owned
            ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-200"
            : blocked
              ? "cursor-not-allowed border-slate-500/25 bg-slate-800/60 text-slate-400"
              : "border-amber-200/50 bg-gradient-to-b from-amber-400/85 to-orange-600/85 text-white"
        }`}
      >
        {owned ? "خریده شد ✓" : `$${price}`}
      </button>
    </div>
  );
}

/**
 * شاپ: فقط بعد از هر نبرد باس باز می‌شود و تا شروع موج بعد (۱۰۰ ثانیه) فعال است.
 * هنگام باز بودن، بازی متوقف می‌شود تا تایمر هم بایستد.
 */
export function ShopOverlay({ hud, game, onClose }: { hud: HudState; game: Game; onClose: () => void }) {
  const s = hud.shop;
  const [, force] = useState(0);
  const buy = (item: "damage" | "ammo" | "knife") => {
    game.buy(item);
    force((v) => v + 1);
  };
  const damageMaxed = s.damageLevel >= s.damageMax;
  const ammoFull = s.reserve >= s.reserveCap;
  return (
    <div className="allow-scroll absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-950/85 px-4 backdrop-blur-md">
      <div className="glass w-full max-w-sm rounded-3xl p-5">
        <div className="text-center">
          <div className="text-2xl font-extrabold text-amber-200 neon-text">🛒 شاپ میدان</div>
          <div className="mt-1 text-[11px] text-cyan-200/70">بعد از هر باس باز می‌شود — تا شروع موج بعد فرصت داری</div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-2 text-center">
            <div className="text-[10px] text-emerald-200/70">پول تو</div>
            <div className="text-lg font-extrabold text-emerald-200">${hud.money}</div>
          </div>
          <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 p-2 text-center">
            <div className="text-[10px] text-cyan-200/70">شروع موج بعد</div>
            <div className="text-lg font-extrabold text-cyan-100 tabular-nums">{clock(hud.breakTime)}</div>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <ShopItem
            icon="🔫"
            title={`آپگرید آسیب اسلحه — سطح ${s.damageLevel}/${s.damageMax}`}
            desc={
              damageMaxed
                ? "حداکثر قدرت را داری"
                : `آسیب هر گلوله ۳۰٪ بیشتر می‌شود (الان ${hud.weaponDamage} → ${(hud.weaponDamage * 1.3).toFixed(1)})`
            }
            price={s.damageCost}
            owned={damageMaxed}
            affordable={hud.money >= s.damageCost}
            onBuy={() => buy("damage")}
          />
          <ShopItem
            icon="🧰"
            title={`خشاب — ${s.ammoAmount} تیر`}
            desc={ammoFull ? `جای مهمات نداری (حداکثر ${s.reserveCap})` : `مهمات ذخیره: ${s.reserve} → ${Math.min(s.reserveCap, s.reserve + s.ammoAmount)}`}
            price={s.ammoCost}
            disabled={ammoFull}
            affordable={hud.money >= s.ammoCost}
            onBuy={() => buy("ammo")}
          />
          <ShopItem
            icon="🔪"
            title="چاقو — اسلات سوم"
            desc={
              s.hasKnife
                ? "با کلید ۳ یا دکمه تعویض اسلات بیارش بیرون"
                : "آسیبش کمی از دست خالی بیشتر است، ولی سریع‌تر و دوربردتر می‌زند"
            }
            price={s.knifeCost}
            owned={s.hasKnife}
            affordable={hud.money >= s.knifeCost}
            onBuy={() => buy("knife")}
          />
        </div>

        <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-500/10 p-2 text-[10px] leading-relaxed text-rose-100/80">
          ⚠ دست خالی و چاقو رایگان‌اند ولی باید به دشمن بچسبی — پرریسک! پول از هر کیل ۱ دلار و از باس ۱۰ دلار می‌آید.
        </div>

        <button
          data-ui="1"
          onClick={onClose}
          className="touch-btn pointer-events-auto mt-4 w-full rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-400/85 to-sky-700/85 py-3 font-extrabold text-white"
        >
          بستن و ادامه ({clock(hud.breakTime)})
        </button>
      </div>
    </div>
  );
}

export function GameOverOverlay({
  hud,
  best,
  onRestart,
  onMenu,
}: {
  hud: HudState;
  best: number;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const isRecord = hud.score >= best && hud.score > 0;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/85 px-4 backdrop-blur-md">
      <div className="glass w-full max-w-sm rounded-3xl p-5 text-center">
        <div className="text-3xl font-extrabold text-rose-300 pink-text">پایان نبرد</div>
        {isRecord && <div className="mt-1 text-xs font-bold text-amber-300">🏆 رکورد جدید!</div>}
        <div className="mt-4 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-slate-900/60 p-2">
            <div className="text-[10px] text-cyan-200/60">امتیاز</div>
            <div className="text-lg font-extrabold text-cyan-100">{hud.score.toLocaleString("en-US")}</div>
          </div>
          <div className="rounded-xl bg-slate-900/60 p-2">
            <div className="text-[10px] text-cyan-200/60">موج</div>
            <div className="text-lg font-extrabold text-cyan-100">{hud.wave}</div>
          </div>
          <div className="rounded-xl bg-slate-900/60 p-2">
            <div className="text-[10px] text-cyan-200/60">کشته</div>
            <div className="text-lg font-extrabold text-cyan-100">{hud.kills}</div>
          </div>
          <div className="rounded-xl bg-slate-900/60 p-2">
            <div className="text-[10px] text-emerald-200/60">پول</div>
            <div className="text-lg font-extrabold text-emerald-200">${hud.money}</div>
          </div>
        </div>
        <div className="mt-1 text-[11px] text-cyan-200/60">
          بهترین رکورد: {Math.max(best, hud.score).toLocaleString("en-US")}
        </div>
        <div className="mt-4 space-y-2">
          <button
            data-ui="1"
            onClick={onRestart}
            className="touch-btn pointer-events-auto w-full rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-400/85 to-sky-700/85 py-3 font-extrabold text-white"
          >
            تلاش دوباره
          </button>
          <button
            data-ui="1"
            onClick={onMenu}
            className="touch-btn pointer-events-auto w-full rounded-2xl border border-slate-400/25 bg-slate-800/70 py-2.5 text-sm font-bold text-cyan-100"
          >
            منوی اصلی
          </button>
        </div>
      </div>
    </div>
  );
}
