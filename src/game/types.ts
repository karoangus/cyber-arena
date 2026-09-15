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
  | "noammo";

export interface GameEvent {
  type: GameEventName;
  amount?: number;
  wave?: number;
  text?: string;
  combo?: number;
}

export interface GameOptions {
  onState: (s: HudState) => void;
  onEvent: (e: GameEvent) => void;
}
