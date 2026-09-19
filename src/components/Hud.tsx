import { useEffect, useRef } from "react";
import type { Game } from "../game/engine";
import type { HudState } from "../game/types";

interface Props {
  hud: HudState;
  game: Game | null;
  hitId: number;
  dmgId: number;
  floats: { id: number; text: string; tone?: "score" | "cash" }[];
  banner: { id: number; text: string } | null;
  toast: { id: number; text: string } | null;
  onPause: () => void;
  onShop: () => void;
}

const SLOT_ICON: Record<HudState["slot"], string> = { fists: "✊", gun: "🔫", knife: "🔪" };
const SLOT_NAME: Record<HudState["slot"], string> = { fists: "دست", gun: "اسلحه", knife: "چاقو" };

/** تایمر شمارش معکوس تا شروع موج بعد */
function clock(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** رادار: دشمن‌ها، گلوله‌ها و آیتم‌ها را نسبت به بازیکن نشان می‌دهد */
function Radar({ game }: { game: Game | null }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const size = 108;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const id = window.setInterval(() => {
      const g = game;
      if (!g) return;
      const info = g.info;
      const half = size / 2;
      const rad = half - 6;
      const range = 40;
      const scale = rad / range;
      ctx.clearRect(0, 0, size, size);
      // پس‌زمینه
      ctx.beginPath();
      ctx.arc(half, half, rad, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(4,10,22,0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(34,211,238,0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(half, half, rad * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(34,211,238,0.18)";
      ctx.stroke();
      // خطوط جهت
      ctx.beginPath();
      ctx.moveTo(half, 6);
      ctx.lineTo(half, size - 6);
      ctx.moveTo(6, half);
      ctx.lineTo(size - 6, half);
      ctx.strokeStyle = "rgba(34,211,238,0.13)";
      ctx.stroke();

      const cos = Math.cos(info.yaw);
      const sin = Math.sin(info.yaw);
      const project = (x: number, z: number) => {
        const dx = x - info.px;
        const dz = z - info.pz;
        let sx = (dx * cos - dz * sin) * scale;
        let sy = (dx * sin + dz * cos) * scale;
        const d = Math.hypot(sx, sy);
        if (d > rad - 3) {
          sx = (sx / d) * (rad - 3);
          sy = (sy / d) * (rad - 3);
        }
        return [half + sx, half + sy] as const;
      };

      // آیتم‌ها
      for (const p of info.pickups) {
        const [x, y] = project(p.x, p.z);
        ctx.fillStyle = p.kind === "hp" ? "#34d399" : "#38bdf8";
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      // گلوله‌های دشمن
      for (const o of info.orbs) {
        const [x, y] = project(o.x, o.z);
        ctx.fillStyle = "rgba(255,120,120,0.85)";
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // دشمن‌ها
      for (const e of info.enemies) {
        const [x, y] = project(e.x, e.z);
        if (e.kind === "boss") {
          // باس: لوزی بزرگ چشمک‌زن
          ctx.beginPath();
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x + 6, y);
          ctx.lineTo(x, y + 7);
          ctx.lineTo(x - 6, y);
          ctx.closePath();
          ctx.fillStyle = "rgba(255,46,99,0.95)";
          ctx.fill();
          ctx.strokeStyle = "#ffd166";
          ctx.lineWidth = 1.4;
          ctx.stroke();
          continue;
        }
        ctx.beginPath();
        ctx.arc(x, y, e.kind === "heavy" ? 4.2 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = e.kind === "heavy" ? "#c084fc" : e.kind === "rusher" ? "#86efac" : "#fb7185";
        ctx.fill();
      }
      // بازیکن
      ctx.beginPath();
      ctx.moveTo(half, half - 6);
      ctx.lineTo(half - 4.5, half + 5);
      ctx.lineTo(half + 4.5, half + 5);
      ctx.closePath();
      ctx.fillStyle = "#e2f7ff";
      ctx.fill();
    }, 90);
    return () => window.clearInterval(id);
  }, [game]);
  return <canvas ref={ref} style={{ width: 108, height: 108 }} className="drop-shadow-[0_0_10px_rgba(34,211,238,0.35)]" />;
}

function Crosshair({ hud, locked }: { hud: HudState; locked: boolean }) {
  const melee = hud.slot !== "gun";
  // نشانه‌گیری: نشانک جمع می‌شود و دقیق‌تر است
  const spread = melee ? 7 : hud.aiming ? 4 : hud.sprinting ? 15 : hud.ammo > 0 ? 9 : 13;
  const color = melee
    ? "#ffd166"
    : hud.aiming
      ? "#ff4d6d"
      : locked
        ? "#f43f5e"
        : hud.reloading
          ? "#fbbf24"
          : "rgba(226,247,255,0.9)";
  if (melee) {
    // برای ضربه‌ی نزدیک: دایره‌ی برد + آمادگی ضربه
    const ready = Math.max(0, Math.min(1, hud.meleeReady));
    return (
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <svg width="54" height="54" viewBox="0 0 54 54" className="opacity-80">
          <circle cx="27" cy="27" r="18" fill="none" stroke="rgba(226,247,255,0.18)" strokeWidth="2" />
          <circle
            cx="27"
            cy="27"
            r="18"
            fill="none"
            stroke={ready >= 1 ? "#ffd166" : "#f59e0b"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${ready * 113} 113`}
            transform="rotate(-90 27 27)"
          />
        </svg>
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color }} />
      </div>
    );
  }
  if (hud.aiming) {
    // حالت ADS: نقطه‌ی مرکزی + چهار خط کوتاه + حلقه‌ی ظریف
    return (
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 46, height: 46, border: "1px solid rgba(255,77,109,0.35)", boxShadow: "0 0 18px rgba(255,77,109,0.25) inset" }}
        />
        <span className="absolute left-1/2 top-0 -translate-x-1/2" style={{ width: 1.5, height: 7, marginTop: -11, background: color }} />
        <span className="absolute left-1/2 bottom-0 -translate-x-1/2" style={{ width: 1.5, height: 7, marginBottom: -11, background: color }} />
        <span className="absolute top-1/2 left-0 -translate-y-1/2" style={{ height: 1.5, width: 7, marginLeft: -11, background: color }} />
        <span className="absolute top-1/2 right-0 -translate-y-1/2" style={{ height: 1.5, width: 7, marginRight: -11, background: color }} />
        <span
          className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: color, boxShadow: "0 0 8px rgba(255,77,109,0.9)" }}
        />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150"
        style={{
          width: 34,
          height: 34,
          border: `1.5px ${locked ? "solid" : "dashed"} ${color}`,
          opacity: locked ? 0.95 : 0.45,
          boxShadow: locked ? "0 0 14px rgba(244,63,94,0.6)" : "none",
        }}
      />
      <span className="absolute left-1/2 top-0 -translate-x-1/2 bg-slate-950/80" style={{ width: 2, height: spread, marginTop: -spread - 2, background: color }} />
      <span className="absolute left-1/2 bottom-0 -translate-x-1/2" style={{ width: 2, height: spread, marginBottom: -spread - 2, background: color }} />
      <span className="absolute top-1/2 left-0 -translate-y-1/2" style={{ height: 2, width: spread, marginLeft: -spread - 2, background: color }} />
      <span className="absolute top-1/2 right-0 -translate-y-1/2" style={{ height: 2, width: spread, marginRight: -spread - 2, background: color }} />
      <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color }} />
    </div>
  );
}

/** نوار جان باس بالای صفحه */
function BossBar({ hud }: { hud: HudState }) {
  const b = hud.boss;
  if (!b) return null;
  const pct = Math.max(0, Math.min(100, (b.hp / b.maxHp) * 100));
  return (
    <div className="pointer-events-none absolute left-1/2 top-[4.6rem] w-[min(92vw,34rem)] -translate-x-1/2">
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold">
        <span className={b.enraged ? "text-amber-300" : "text-rose-300"}>
          👹 {b.enraged ? "باس خشمگین" : "باس نگهبان هسته"}
        </span>
        <span className="tabular-nums text-rose-100/80">
          {Math.round(b.hp)} / {Math.round(b.maxHp)}
        </span>
      </div>
      <div className={`h-3 overflow-hidden rounded-full border ${b.enraged ? "border-amber-300/50" : "border-rose-400/40"} bg-slate-950/75`}>
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{
            width: `${pct}%`,
            background: b.enraged ? "linear-gradient(90deg,#fbbf24,#f97316,#ef4444)" : "linear-gradient(90deg,#fb7185,#f43f5e,#be123c)",
            boxShadow: "0 0 16px rgba(244,63,94,0.6)",
          }}
        />
      </div>
    </div>
  );
}

/** اسلات‌های فعال: با کلیک/لمس قابل تعویض (کلیدهای ۱/۲/۳ هم کار می‌کند) */
function SlotPicker({ hud, game }: { hud: HudState; game: Game | null }) {
  const slots: HudState["slot"][] = hud.hasKnife ? ["fists", "gun", "knife"] : ["fists", "gun"];
  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      {slots.map((s, i) => {
        const active = hud.slot === s;
        return (
          <button
            key={s}
            data-ui="1"
            onClick={() => game?.setSlot(s)}
            className={`touch-btn flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
              active
                ? "border-amber-200/60 bg-amber-400/25 text-amber-100"
                : "border-cyan-400/20 bg-slate-950/55 text-cyan-100/70"
            }`}
          >
            <span>{SLOT_ICON[s]}</span>
            <span>{SLOT_NAME[s]}</span>
            <span className="hidden text-[8px] opacity-60 sm:inline">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Hud({ hud, game, hitId, dmgId, floats, banner, toast, onPause, onShop }: Props) {
  const hpPct = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  // getter سبک: ساختن کل game.info (با آرایه‌ی دشمن‌ها و...) فقط برای این بولین نبیند
  const locked = hud.enemiesLeft > 0 && game ? game.onTarget : false;
  const melee = hud.slot !== "gun";

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {/* فلاش آسیب */}
      {dmgId > 0 && (
        <div
          key={dmgId}
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(220,20,60,${0.3 + Math.min(0.45, (100 - hpPct) / 260)}) 100%)`,
            animation: "damage-flash 0.55s ease-out forwards",
          }}
        />
      )}

      {/* تیرگی لبه‌ها هنگام نشانه‌گیری (حس دوربین) */}
      {hud.aiming && (
        <div
          className="absolute inset-0 transition-opacity duration-150"
          style={{ background: "radial-gradient(circle at center, rgba(0,0,0,0) 32%, rgba(2,6,20,0.72) 88%)" }}
        />
      )}

      {/* رادار */}
      <div className="absolute left-3 top-3 rounded-2xl border border-cyan-400/20 bg-slate-950/45 p-1.5 backdrop-blur-sm">
        <Radar game={game} />
      </div>

      {/* پنل امتیاز */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          {/* شاپ: فقط بعد از شکست باس فعال می‌شود */}
          <button
            data-ui="1"
            onClick={onShop}
            disabled={!hud.shopAvailable}
            title={hud.shopAvailable ? "شاپ باز است!" : `شاپ بعد از باس موج ${hud.nextBossWave} باز می‌شود`}
            className={`touch-btn pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl border text-lg ${
              hud.shopAvailable
                ? "shop-pulse border-amber-200/60 bg-amber-400/25 text-amber-100"
                : "border-slate-500/25 bg-slate-950/60 text-slate-500"
            }`}
          >
            🛒
          </button>
          <button
            data-ui="1"
            onClick={onPause}
            className="touch-btn pointer-events-auto flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-slate-950/70 text-lg text-cyan-200"
          >
            ⏸
          </button>
          <div className="glass rounded-2xl px-3 py-1.5 text-right">
            <div className="text-[10px] leading-none text-cyan-200/70">امتیاز</div>
            <div className="text-xl font-extrabold leading-tight text-cyan-50 neon-text">{hud.score.toLocaleString("en-US")}</div>
          </div>
        </div>
        <div className="glass flex items-center gap-2 rounded-xl px-3 py-1 text-[11px] text-cyan-100/90">
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-extrabold text-emerald-200">${hud.money}</span>
          <span className="text-cyan-400/40">|</span>
          <span>
            موج <b className="text-cyan-300">{hud.wave}</b>
          </span>
          <span className="text-cyan-400/40">|</span>
          <span>
            دشمن <b className="text-rose-300">{hud.enemiesLeft}</b>
          </span>
          <span className="text-cyan-400/40">|</span>
          <span>
            کشته <b className="text-amber-300">{hud.kills}</b>
          </span>
        </div>
        {/* تایمر وقفه: کی موج‌ها شروع می‌شوند */}
        {hud.breakTime > 0 && !hud.boss && (
          <div
            className={`glass flex items-center gap-2 rounded-xl px-3 py-1 text-[11px] font-bold ${
              hud.shopAvailable ? "text-amber-200" : "text-cyan-100/90"
            }`}
          >
            <span>شروع موج بعد</span>
            <span className="tabular-nums text-base">{clock(hud.breakTime)}</span>
            {hud.shopAvailable && <span className="text-amber-300">🛒 شاپ باز است</span>}
          </div>
        )}
        {hud.combo > 1 && (
          <div className="rounded-xl border border-amber-300/40 bg-amber-500/15 px-3 py-1 text-[11px] font-extrabold text-amber-200 pink-text">
            کمبو ×{Math.min(3, 1 + (hud.combo - 1) * 0.15).toFixed(1)}
          </div>
        )}
      </div>

      {/* نوار جان باس */}
      <BossBar hud={hud} />

      {/* بنر موج */}
      {banner && !hud.boss && (
        <div key={banner.id} className="absolute left-1/2 top-14 -translate-x-1/2 animate-banner">
          <div className="glass rounded-2xl px-6 py-2 text-center">
            <div className="text-lg font-extrabold text-cyan-100 neon-text">{banner.text}</div>
          </div>
        </div>
      )}
      {banner && hud.boss && (
        <div key={banner.id} className="absolute left-1/2 top-[7.6rem] -translate-x-1/2 animate-banner">
          <div className="glass rounded-2xl px-5 py-1.5 text-center">
            <div className="text-base font-extrabold text-rose-200 pink-text">{banner.text}</div>
          </div>
        </div>
      )}

      {/* پیام آیتم */}
      {toast && (
        <div key={toast.id} className="absolute left-1/2 top-1/3 -translate-x-1/2 animate-banner">
          <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-100">
            {toast.text}
          </div>
        </div>
      )}

      {/* نشانگر برخورد */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {hitId > 0 && (
          <svg key={hitId} className="hitmarker" width="46" height="46" viewBox="0 0 46 46">
            <g stroke="#fca5a5" strokeWidth="2.6" strokeLinecap="round">
              <line x1="10" y1="10" x2="18" y2="18" />
              <line x1="36" y1="10" x2="28" y2="18" />
              <line x1="10" y1="36" x2="18" y2="28" />
              <line x1="36" y1="36" x2="28" y2="28" />
            </g>
          </svg>
        )}
      </div>

      {/* متن امتیاز/پول شناور */}
      {floats.map((f) => (
        <div
          key={f.id}
          className={`absolute left-1/2 -translate-x-1/2 text-sm font-extrabold ${
            f.tone === "cash" ? "top-[44%] text-emerald-300" : "top-[38%] text-amber-200 pink-text"
          }`}
          style={{ animation: "banner-in 0.9s ease forwards", marginLeft: (f.id % 5) * 12 - 24 }}
        >
          {f.text}
        </div>
      ))}

      <Crosshair hud={hud} locked={locked} />

      {/* نوارهای پایین */}
      <div className="absolute bottom-0 left-1/2 flex w-full max-w-3xl -translate-x-1/2 items-end justify-between gap-3 px-3 pb-[calc(0.9rem+env(safe-area-inset-bottom))]">
        {/* جان */}
        <div className={`w-32 sm:w-56 ${hpPct < 30 ? "low-hp rounded-xl" : ""}`}>
          <div className="mb-1 flex items-center justify-between text-[10px] text-cyan-100/80">
            <span>سلامت</span>
            <span className={`font-bold ${hpPct < 30 ? "text-rose-300" : "text-cyan-200"}`}>{hud.hp}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border border-cyan-400/25 bg-slate-950/70">
            <div
              className="h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${hpPct}%`,
                background: hpPct < 30 ? "linear-gradient(90deg,#fb7185,#f43f5e)" : "linear-gradient(90deg,#22d3ee,#34d399)",
                boxShadow: "0 0 12px rgba(34,211,238,0.5)",
              }}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] text-violet-200">
              انفجار موج: {Math.round(hud.blastReady * 100)}%
            </span>
            {hud.sprinting && (
              <span className="rounded bg-amber-400/25 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">⚡ دویدن</span>
            )}
            {hud.aiming && (
              <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-[9px] font-bold text-rose-100">🎯 نشانه‌گیری</span>
            )}
          </div>
        </div>

        {/* فشنگ / اسلات فعال */}
        <div className="flex flex-col items-center">
          <div className="mb-1">
            <SlotPicker hud={hud} game={game} />
          </div>
          {melee ? (
            <>
              <div className="glass flex items-baseline gap-2 rounded-2xl px-4 py-1.5">
                <span className="text-xl font-extrabold leading-none text-amber-200">
                  {SLOT_ICON[hud.slot]} {SLOT_NAME[hud.slot]}
                </span>
                <span className="text-[10px] text-amber-100/70">آسیب {hud.meleeDamage} • برد {hud.meleeRange}m</span>
              </div>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-950/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-300"
                  style={{ width: `${Math.max(0, Math.min(1, hud.meleeReady)) * 100}%` }}
                />
              </div>
              <div className="mt-1 h-4 text-[10px] font-bold text-amber-300">
                {hud.reloading
                  ? "خشاب در حال پر شدن…"
                  : hud.meleeReady >= 1
                    ? "آماده‌ی ضربه — بچسب به دشمن!"
                    : "…"}
              </div>
            </>
          ) : (
            <>
              <div className="glass flex items-baseline gap-2 rounded-2xl px-4 py-1.5">
                <span className="text-2xl font-extrabold leading-none text-cyan-50">{hud.ammo}</span>
                <span className="text-xs text-cyan-200/70">/ {hud.reserve}</span>
                {hud.weaponLevel > 0 && (
                  <span className="rounded bg-rose-500/25 px-1 text-[9px] font-extrabold text-rose-200">
                    +{hud.weaponLevel} آسیب
                  </span>
                )}
              </div>
              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-950/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-200"
                  style={{ width: `${(hud.ammo / hud.magSize) * 100}%` }}
                />
              </div>
              <div className="mt-1 h-4 text-[10px] font-bold text-amber-300">
                {hud.reloading
                  ? "در حال پر کردن…"
                  : hud.ammo === 0
                    ? hud.reserve > 0
                      ? "خشاب خالی! R را بزن"
                      : "مهمات نداری! شاپ یا اسلات دست"
                    : ""}
              </div>
            </>
          )}
        </div>

        {/* فضای خالی برای کنترل‌های سمت راست */}
        <div className="hidden w-32 sm:block sm:w-56" />
      </div>
    </div>
  );
}
