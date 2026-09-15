import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "../game/engine";

interface Props {
  getGame: () => Game | null;
  visible: boolean;
}

interface Track {
  type: "move" | "look";
  sx: number;
  sy: number;
  lx: number;
  ly: number;
}

const R = 64; // شعاع جوی‌استیک (پیکسل)

/* ---------------------------------- دکمه ساده ---------------------------------- */
function ActionButton({
  label,
  hint,
  onDown,
  onUp,
  size,
  tone = "cyan",
  cooldown,
}: {
  label: string;
  hint?: string;
  onDown: () => void;
  onUp?: () => void;
  size: number;
  tone?: "cyan" | "amber" | "violet";
  cooldown?: number; // 0 = آماده
}) {
  const [active, setActive] = useState(false);
  const tones: Record<string, string> = {
    cyan: "from-cyan-500/85 to-sky-700/80 border-cyan-200/55 shadow-cyan-500/40",
    amber: "from-amber-400/75 to-orange-600/75 border-amber-200/55 shadow-amber-500/30",
    violet: "from-violet-500/80 to-fuchsia-700/80 border-violet-200/55 shadow-violet-500/35",
  };
  return (
    <button
      data-ui="1"
      className={`touch-btn pointer-events-auto relative flex shrink-0 flex-col items-center justify-center rounded-full border bg-gradient-to-b text-white shadow-lg ${tones[tone]} ${
        active ? "scale-90 brightness-125" : "opacity-95"
      }`}
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        e.preventDefault();
        setActive(true);
        onDown();
      }}
      onPointerUp={() => {
        setActive(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setActive(false);
        onUp?.();
      }}
      onPointerLeave={() => setActive(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="px-1 text-[10px] font-extrabold leading-tight drop-shadow">{label}</span>
      {hint ? <span className="mt-0.5 text-[8px] leading-none opacity-75">{hint}</span> : null}
      {cooldown !== undefined && cooldown < 0.995 ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-full border border-white/10 bg-slate-950/70"
          style={{ clipPath: `inset(0 0 ${Math.round(cooldown * 100)}% 0)` }}
        />
      ) : null}
    </button>
  );
}

/* ---------------- دکمه شلیک: نگه‌داشتن + کشیدن انگشت = چرخش دید ---------------- */
function FireButton({ getGame }: { getGame: () => Game | null }) {
  const [active, setActive] = useState(false);
  const state = useRef({ id: -1, lx: 0, ly: 0, sx: 0, sy: 0, jumped: false, moved: false });

  const end = useCallback(() => {
    getGame()?.setFiring(false);
    setActive(false);
    state.current.id = -1;
  }, [getGame]);

  return (
    <button
      data-ui="1"
      className={`touch-btn pointer-events-auto relative flex h-[6.4rem] w-[6.4rem] shrink-0 select-none flex-col items-center justify-center rounded-full border-2 border-rose-100/70 bg-gradient-to-b from-rose-500/90 to-red-700/90 text-white shadow-[0_0_28px_rgba(244,63,94,0.45)] ${
        active ? "scale-95 brightness-125" : ""
      }`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const s = state.current;
        s.id = e.pointerId;
        s.lx = s.sx = e.clientX;
        s.ly = s.sy = e.clientY;
        s.jumped = false;
        s.moved = false;
        setActive(true);
        getGame()?.setFiring(true);
      }}
      onPointerMove={(e) => {
        const s = state.current;
        if (s.id !== e.pointerId) return;
        const dx = e.clientX - s.lx;
        const dy = e.clientY - s.ly;
        s.lx = e.clientX;
        s.ly = e.clientY;
        if (Math.abs(dx) + Math.abs(dy) > 1) s.moved = true;
        // انگشت را روی دکمه بکش → دید می‌چرخد و همزمان شلیک ادامه دارد
        getGame()?.applyLook(dx, dy);
        // کشیدن سریع به بالا = پرش
        if (!s.jumped && s.sy - e.clientY > 46) {
          s.jumped = true;
          getGame()?.jump();
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="text-sm font-extrabold leading-none drop-shadow">شلیک</span>
      <span className="mt-1 text-[8px] leading-none opacity-85">بکش = چرخش دید</span>
      <span className="text-[8px] leading-none opacity-60">بالا کشیدن = پرش</span>
    </button>
  );
}

/* ---------------------------------- کنترل‌ها ---------------------------------- */
export default function TouchControls({ getGame, visible }: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const sprintRef = useRef<HTMLDivElement | null>(null);
  const tracks = useRef<Map<number, Track>>(new Map());
  const moveId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const [blast, setBlast] = useState(1);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const halfW = () => window.innerWidth * 0.5;

    const setSprintUi = (on: boolean) => {
      const s = sprintRef.current;
      if (s) s.style.opacity = on ? "1" : "0";
    };

    const onStart = (e: TouchEvent) => {
      const game = getGame();
      if (!game) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const target = t.target as HTMLElement | null;
        if (target?.closest?.("[data-ui]")) continue; // روی دکمه‌ها نادیده بگیر
        if (t.clientX < halfW()) {
          if (moveId.current !== null) continue; // فقط یک جوی‌استیک
          moveId.current = t.identifier;
          if (baseRef.current && knobRef.current) {
            baseRef.current.style.opacity = "1";
            baseRef.current.style.transform = `translate(${t.clientX - R}px, ${t.clientY - R}px)`;
            baseRef.current.style.left = "0px";
            baseRef.current.style.top = "0px";
            knobRef.current.style.transform = "translate(0px, 0px)";
          }
          setSprintUi(false);
        } else {
          if (lookId.current !== null) continue; // فقط یک انگشت برای چرخش دید
          lookId.current = t.identifier;
        }
        tracks.current.set(t.identifier, {
          type: t.clientX < halfW() ? "move" : "look",
          sx: t.clientX,
          sy: t.clientY,
          lx: t.clientX,
          ly: t.clientY,
        });
      }
    };

    const onMove = (e: TouchEvent) => {
      const game = getGame();
      if (!game) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const tr = tracks.current.get(t.identifier);
        if (!tr) continue;
        if (tr.type === "move") {
          let dx = t.clientX - tr.sx;
          let dy = t.clientY - tr.sy;
          const len = Math.hypot(dx, dy);
          if (len > R) {
            dx = (dx / len) * R;
            dy = (dy / len) * R;
          }
          if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
          const norm = Math.min(1, Math.max(0, (Math.min(len, R) - 4) / (R - 4)));
          const nx = len > 0.001 ? (dx / len) * norm : 0; // راست مثبت
          const ny = len > 0.001 ? (dy / len) * norm : 0; // پایین مثبت
          game.setMove(nx, -ny);
          // نشانگر دویدن فقط در جهت رو به جلو
          setSprintUi(norm > 0.8 && ny < -0.6);
        } else {
          game.applyLook(t.clientX - tr.lx, t.clientY - tr.ly);
          tr.lx = t.clientX;
          tr.ly = t.clientY;
        }
      }
      e.preventDefault();
    };

    const onEnd = (e: TouchEvent) => {
      const game = getGame();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const tr = tracks.current.get(t.identifier);
        if (!tr) continue;
        tracks.current.delete(t.identifier);
        if (t.identifier === moveId.current) {
          moveId.current = null;
          game?.setMove(0, 0);
          if (baseRef.current) baseRef.current.style.opacity = "0";
          setSprintUi(false);
        }
        if (t.identifier === lookId.current) lookId.current = null;
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [getGame]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const g = getGame();
      if (g) setBlast(Math.min(1, 1 - g.blastCdRatio));
    }, 250);
    return () => window.clearInterval(id);
  }, [getGame]);

  const doJump = useCallback(() => getGame()?.jump(), [getGame]);
  const doReload = useCallback(() => getGame()?.reload(), [getGame]);
  const doBlast = useCallback(() => getGame()?.blast(), [getGame]);

  const safeB = "calc(1rem + env(safe-area-inset-bottom))";
  const safeR = "calc(1rem + env(safe-area-inset-right))";

  return (
    <div
      ref={layerRef}
      className={`ui-layer absolute inset-0 z-20 ${visible ? "" : "pointer-events-none opacity-0"}`}
      style={{ touchAction: "none" }}
    >
      {/* جوی‌استیک پویا */}
      <div ref={baseRef} className="pointer-events-none absolute left-0 top-0 opacity-0" style={{ width: R * 2, height: R * 2 }}>
        <div className="relative h-full w-full rounded-full border-2 border-cyan-300/40 bg-slate-900/25 backdrop-blur-[2px]">
          <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tracking-widest text-cyan-200/45">
            حرکت
          </div>
          <div
            ref={knobRef}
            className="absolute left-1/2 top-1/2 -ml-[31px] -mt-[31px] h-[62px] w-[62px] rounded-full border border-cyan-100/60 bg-gradient-to-br from-cyan-400/70 to-sky-700/70 shadow-lg shadow-cyan-500/40"
          />
          <div
            ref={sprintRef}
            className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-amber-400/90 px-2 py-0.5 text-[9px] font-extrabold text-slate-900 opacity-0 transition-opacity"
          >
            دویدن ⚡
          </div>
        </div>
      </div>

      {/* پشته دکمه‌ها با فاصله مناسب */}
      <div className="pointer-events-none absolute flex items-end gap-5" style={{ right: safeR, bottom: safeB }}>
        <div className="pointer-events-none flex flex-col items-center gap-5">
          <ActionButton label="موج انفجاری" hint="Q" size={62} tone="violet" onDown={doBlast} cooldown={blast} />
          <ActionButton label="خشاب" hint="R" size={60} tone="amber" onDown={doReload} />
        </div>
        <div className="pointer-events-none flex flex-col items-center gap-5">
          <ActionButton label="پرش ⬆" size={66} tone="cyan" onDown={doJump} />
          <FireButton getGame={getGame} />
        </div>
      </div>
    </div>
  );
}
