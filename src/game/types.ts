/** اسلات‌های دست بازیکن: دست خالی، اسلحه، چاقو */
export type SlotKind = "fists" | "gun" | "knife";

/** نوار جان باس (فقط در موج‌های باس پر می‌شود) */
export interface BossHud {
  hp: number;
  maxHp: number;
  enraged: boolean;
}

/** اطلاعات شاپ برای HUD (قیمت‌ها زنده از موتور خوانده می‌شوند) */
export interface ShopHud {
  damageCost: number;
  damageLevel: number;
  damageMax: number;
  ammoCost: number;
  ammoAmount: number;
  knifeCost: number;
  hasKnife: boolean;
  reserve: number;
  reserveCap: number;
}

export interface HudState {
  hp: number;
  maxHp: number;
  ammo: number;
  magSize: number;
  reserve: number;
  score: number;
  wave: number;
  kills: number;
  enemiesLeft: number;
  combo: number;
  reloading: boolean;
  blastReady: number; // 0..1
  sprinting: boolean;
  alive: boolean;
  running: boolean;
  /** پول بازیکن (هر کیل ۱ دلار، باس ۱۰ دلار) */
  money: number;
  /** سطح ارتقای آسیب اسلحه (۰ تا ۳) */
  weaponLevel: number;
  /** آسیب هر گلوله در سطح فعلی */
  weaponDamage: number;
  /** چاقو خریداری شده و اسلات ۳ باز است */
  hasKnife: boolean;
  /** اسلات فعال */
  slot: SlotKind;
  /** در حال نشانه‌گیری (ADS) */
  aiming: boolean;
  /** آمادگی ضربه‌ی نزدیک 0..1 */
  meleeReady: number;
  /** آسیب ضربه‌ی نزدیک اسلات فعلی */
  meleeDamage: number;
  /** برد ضربه‌ی نزدیک (متر) */
  meleeRange: number;
  /** باس زنده (یا null) */
  boss: BossHud | null;
  /** موج باس‌دار بعدی */
  nextBossWave: number;
  /** ثانیه‌های باقی‌مانده تا شروع موج بعد (۰ = موج در جریان است) */
  breakTime: number;
  /** شاپ باز است (فقط بعد از شکست باس، تا شروع موج بعد) */
  shopAvailable: boolean;
  shop: ShopHud;
}

export type GameEventName =
  | "hit"
  | "kill"
  | "damage"
  | "pickup"
  | "wave"
  | "reload"
  | "empty"
  | "death"
  | "blast"
  | "noammo"
  | "cash"
  | "melee"
  | "boss"
  | "shop"
  | "deny"
  | "slot";

export interface GameEvent {
  type: GameEventName;
  amount?: number;
  wave?: number;
  text?: string;
  combo?: number;
  money?: number;
  slot?: SlotKind;
}

export interface GameOptions {
  onState: (s: HudState) => void;
  onEvent: (e: GameEvent) => void;
}
