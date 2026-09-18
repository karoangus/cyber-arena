/**
 * مدل اول‌شخص بازیکن (ViewModel)
 * ---------------------------------------------------------------------------
 * همه‌ی آنچه بازیکن از بدن خودش می‌بیند: بازوها، دست‌های دستکش سایبری، اسلحه،
 * چاقو و مشت‌ها — به‌همراه تمام انیمیشن‌ها:
 *   • بی‌حرکت (تکان نرم تنفس)
 *   • راه‌رفتن (تکان خوردن دست‌ها و اسلحه با هر قدم)
 *   • دویدن (دامنه‌ی بیشتر، پایین‌آمدن اسلحه به حالت حمل، پمپاژ دست‌ها)
 *   • شلیک (لگد اسلحه، پرش دست‌ها، فلش دهانه)
 *   • پرکردن خشاب (بیرون کشیدن خشاب، خشاب تازه، کشیدن گلنگدن)
 *   • نشانه‌گیری (ADS): اسلحه به مرکز دید می‌آید، مگسک روشن می‌شود و تکان‌ها کم می‌شود
 *   • مشت / برش چاقو (ضربه‌ی دست + افکت برش)
 *   • تعویض اسلات (پایین رفتن سلاح قبلی و بالا آمدن سلاح جدید)
 * همه‌چیز رویه‌ای (procedural) و بدون هیچ فایل خارجی ساخته می‌شود تا بیلد
 * تک‌فایلی و آفلاین بازی دست‌نخورده بماند.
 */
import * as THREE from "three";
import type { SlotKind } from "./types";
import { glowTexture } from "./world";

const DOWN = new THREE.Vector3(0, -1, 0);
const ARM_LEN = 0.62;
const SWITCH_TIME = 0.42;

/** داده‌های یک فریم که موتور به مدل اول‌شخص می‌دهد */
export interface ViewFrame {
  dt: number;
  elapsed: number;
  /** فاز چرخه‌ی گام (رادیان) */
  bob: number;
  /** شدت حرکت 0..1 */
  speed01: number;
  /** دویدن 0..1 */
  sprint01: number;
  /** نشانه‌گیری 0..1 */
  aim01: number;
  reloading: boolean;
  /** پیشرفت پرکردن خشاب 0..1 */
  reloadProgress: number;
  slot: SlotKind;
  /** پیشرفت انیمیشن ضربه‌ی نزدیک 0..1 (صفر = ضربه‌ای در جریان نیست) */
  meleeProgress: number;
  /** 0 = دست راست، 1 = دست چپ */
  meleeHand: number;
  swayX: number;
  swayY: number;
  alive: boolean;
  /** سرعت عمودی (برای انیمیشن پرش/فرود) */
  vy: number;
  /** میزان فرود سخت 0..1 */
  landDip: number;
}

interface Mats {
  metal: THREE.MeshPhongMaterial;
  dark: THREE.MeshPhongMaterial;
  energy: THREE.MeshBasicMaterial;
  glove: THREE.MeshPhongMaterial;
  gloveDark: THREE.MeshPhongMaterial;
  sleeve: THREE.MeshPhongMaterial;
  trim: THREE.MeshBasicMaterial;
  blade: THREE.MeshPhongMaterial;
  edge: THREE.MeshBasicMaterial;
}

interface Arm {
  root: THREE.Group;
  sleeve: THREE.Mesh;
  hand: THREE.Group;
  len: number;
  /** محل شانه در فضای arms */
  shoulder: THREE.Vector3;
  shoulderBase: THREE.Vector3;
}

interface Rig {
  root: THREE.Group;
  arms: THREE.Group;
  weapon: THREE.Group;
  armR: Arm;
  armL: Arm;
  /** هدف دست راست/چپ (فرزند weapon تا با لگد و ریلود جابه‌جا شود) */
  targetR: THREE.Object3D;
  targetL: THREE.Object3D;
  hipPos: THREE.Vector3;
  hipRot: THREE.Vector3;
  aimPos: THREE.Vector3;
  aimRot: THREE.Vector3;
  /** چرخش دست‌ها در فضای rig */
  handQ: THREE.Quaternion;
}

function makeMats(): Mats {
  return {
    metal: new THREE.MeshPhongMaterial({ color: 0x2b3448, shininess: 60, specular: 0x8899bb }),
    dark: new THREE.MeshPhongMaterial({ color: 0x151a26, shininess: 30 }),
    energy: new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    glove: new THREE.MeshPhongMaterial({ color: 0x28313f, shininess: 45, specular: 0x9fb6d6 }),
    gloveDark: new THREE.MeshPhongMaterial({ color: 0x171d29, shininess: 25 }),
    sleeve: new THREE.MeshPhongMaterial({ color: 0x1f2735, shininess: 35, specular: 0x6f86a8 }),
    trim: new THREE.MeshBasicMaterial({ color: 0x35e0ff }),
    blade: new THREE.MeshPhongMaterial({ color: 0xb9c6d8, shininess: 110, specular: 0xffffff }),
    edge: new THREE.MeshBasicMaterial({ color: 0x7ef9ff, transparent: true, opacity: 0.9 }),
  };
}

/** دست دستکش‌دار: کف + انگشت‌ها + بند انگشت + شست + نوار نئونی مچ */
function makeHand(m: Mats): THREE.Group {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.052, 0.125), m.glove);
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.096, 0.044, 0.08), m.gloveDark);
  fingers.position.set(0, -0.006, -0.093);
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.098, 0.032, 0.03), m.glove);
  knuckle.position.set(0, 0.017, -0.055);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.036, 0.072), m.gloveDark);
  thumb.position.set(0.055, 0.004, -0.028);
  thumb.rotation.y = 0.55;
  const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.034, 0.05), m.trim);
  cuff.position.set(0, 0.004, 0.075);
  g.add(palm, fingers, knuckle, thumb, cuff);
  return g;
}

/** بازو: آستین کشسان + دست (با چرخش شانه دقیقاً تا هدف کشیده می‌شود) */
function buildArm(m: Mats): Arm {
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.108, ARM_LEN, 0.108);
  geo.translate(0, -ARM_LEN / 2, 0);
  const sleeve = new THREE.Mesh(geo, m.sleeve);
  const stripeGeo = new THREE.BoxGeometry(0.016, ARM_LEN * 0.82, 0.016);
  stripeGeo.translate(0.056, -ARM_LEN / 2, 0.038);
  sleeve.add(new THREE.Mesh(stripeGeo, m.trim));
  const hand = makeHand(m);
  root.add(sleeve, hand);
  return { root, sleeve, hand, len: ARM_LEN, shoulder: new THREE.Vector3(), shoulderBase: new THREE.Vector3() };
}

const _dir = new THREE.Vector3();
/** شانه را به سمت هدف می‌چرخاند و آستین را تا همان‌جا می‌کشد؛ دست در انتهای آستین */
function aimArm(arm: Arm, target: THREE.Vector3, poseQ: THREE.Quaternion) {
  _dir.copy(target).sub(arm.shoulder);
  const dist = Math.max(0.06, _dir.length());
  arm.root.position.copy(arm.shoulder);
  arm.root.quaternion.setFromUnitVectors(DOWN, _dir.normalize());
  arm.sleeve.scale.y = dist / arm.len;
  arm.hand.position.set(0, -dist, 0);
  // دست جهت ثابتی در فضای rig دارد (چرخش شانه روی مچ اثر نمی‌گذارد)
  arm.hand.quaternion.copy(arm.root.quaternion).invert().multiply(poseQ);
}

/** منحنی ضربه: سریع جلو می‌رود و نرم برمی‌گردد */
function swingCurve(p: number) {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.3) return Math.sin((p / 0.3) * Math.PI * 0.5);
  return Math.pow(Math.max(0, 1 - (p - 0.3) / 0.7), 0.75);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

export class ViewModel {
  root = new THREE.Group();
  private m: Mats;
  private rigs: Record<SlotKind, Rig>;
  private slot: SlotKind = "gun";
  private shown: SlotKind = "gun";

  // انیمیشن تعویض اسلات
  private switchT = 0;
  private switchFrom: SlotKind = "gun";
  private swapped = true;

  // پالس‌ها
  private kick = 0;
  private flash = 0;
  private aim = 0;

  private muzzleFlash: THREE.Sprite;
  private aimDot: THREE.Mesh;
  private magMesh: THREE.Mesh;
  private boltMesh: THREE.Mesh;

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor() {
    this.m = makeMats();
    this.rigs = { gun: this.buildGun(), fists: this.buildFists(), knife: this.buildKnife() };
    this.root.add(this.rigs.gun.root, this.rigs.fists.root, this.rigs.knife.root);
    for (const k of Object.keys(this.rigs) as SlotKind[]) this.rigs[k].root.visible = k === "gun";

    const ud = this.rigs.gun.weapon.userData as Record<string, THREE.Object3D>;
    this.muzzleFlash = ud.flash as THREE.Sprite;
    this.aimDot = ud.aimDot as THREE.Mesh;
    this.magMesh = ud.mag as THREE.Mesh;
    this.boltMesh = ud.bolt as THREE.Mesh;

    this.calibrate();
  }

  /** شانه‌ها طوری تنظیم می‌شوند که در حالت پیش‌فرض آستین نه کشیده باشد نه فشرده */
  private calibrate() {
    for (const k of Object.keys(this.rigs) as SlotKind[]) {
      const rig = this.rigs[k];
      rig.root.position.copy(rig.hipPos);
      rig.root.rotation.set(rig.hipRot.x, rig.hipRot.y, rig.hipRot.z);
      rig.weapon.position.set(0, 0, 0);
      rig.weapon.rotation.set(0, 0, 0);
      rig.arms.position.set(0, 0, 0);
      rig.root.visible = true;
      this.root.updateMatrixWorld(true);
      for (const arm of [rig.armR, rig.armL]) {
        const t = arm === rig.armR ? rig.targetR : rig.targetL;
        t.getWorldPosition(this.tmp);
        rig.arms.worldToLocal(this.tmp);
        const side = arm === rig.armR ? 1 : -1;
        _dir.set(0.2 * side, -0.6, 0.74).normalize().multiplyScalar(ARM_LEN);
        arm.shoulderBase.copy(this.tmp).add(_dir);
        arm.shoulder.copy(arm.shoulderBase);
      }
      rig.root.visible = k === this.shown;
    }
  }

  get activeSlot() {
    return this.slot;
  }

  /** نقطه‌ی خروج گلوله (برای رگه‌ی نور و فلش دهانه) */
  get muzzle(): THREE.Object3D {
    return (this.rigs.gun.weapon.userData as Record<string, THREE.Object3D>).muzzle;
  }

  /** محل نور دهانه در فضای دوربین (برای چراغ شلیک) */
  muzzleLightPos(out: THREE.Vector3, slot: SlotKind) {
    if (slot === "gun") {
      this.muzzle.getWorldPosition(out);
      const cam = this.root.parent;
      if (cam) cam.worldToLocal(out);
      return out;
    }
    return out.set(slot === "knife" ? 0.2 : 0.06, -0.26, -0.9);
  }

  /** تعویض اسلات با انیمیشن */
  setSlot(slot: SlotKind) {
    if (slot === this.slot) return;
    this.switchFrom = this.shown;
    this.slot = slot;
    this.switchT = SWITCH_TIME;
    this.swapped = false;
  }

  /** لگد شلیک + فلش دهانه */
  recoil(amount = 1) {
    this.kick = Math.min(1.5, this.kick + amount);
    this.flash = 1;
  }

  dispose() {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const v of Object.values(this.m)) v.dispose();
  }

  /* --------------------------------------------------------------------- */
  /*                             ساخت مدل‌ها                                */
  /* --------------------------------------------------------------------- */

  private buildGun(): Rig {
    const m = this.m;
    const root = new THREE.Group();
    const arms = new THREE.Group();
    const weapon = new THREE.Group();
    root.add(arms, weapon);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.62), m.metal);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 10), m.dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, -0.5);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.115, 0.3), m.dark);
    shroud.position.set(0, 0.02, -0.36);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.22, 0.14), m.dark);
    grip.position.set(0, -0.16, 0.16);
    grip.rotation.x = -0.22;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.24), m.metal);
    stock.position.set(0, -0.03, 0.4);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.1), m.metal);
    mag.position.set(0, -0.19, -0.02);
    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.3), m.energy);
    cell.position.set(0.09, 0.02, -0.02);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.05), m.dark);
    sight.position.set(0, 0.13, -0.05);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.4), m.dark);
    rail.position.set(0, 0.095, -0.1);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), m.energy);
    tip.position.set(0, 0.03, -0.73);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), m.metal);
    bolt.position.set(0.075, 0.07, 0.02);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, -0.8);

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xcdf3ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    flash.scale.setScalar(0.5);
    flash.position.copy(muzzle.position);

    // نقطه‌ی نشانه (فقط هنگام نشانه‌گیری دیده می‌شود)
    const aimDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.017, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0 }),
    );
    aimDot.position.set(0, 0.175, -0.05);
    aimDot.visible = false;

    const targetR = new THREE.Object3D();
    targetR.position.set(0, -0.2, 0.17);
    const targetL = new THREE.Object3D();
    targetL.position.set(0, -0.1, -0.32);

    weapon.add(body, barrel, shroud, grip, stock, mag, cell, sight, rail, tip, bolt, muzzle, flash, aimDot, targetR, targetL);
    weapon.scale.setScalar(1.15);
    weapon.userData = { muzzle, flash, aimDot, mag, bolt };

    const armR = buildArm(m);
    const armL = buildArm(m);
    arms.add(armR.root, armL.root);

    return {
      root,
      arms,
      weapon,
      armR,
      armL,
      targetR,
      targetL,
      hipPos: new THREE.Vector3(0.3, -0.3, -0.55),
      hipRot: new THREE.Vector3(0, 0.05, -0.04),
      // در نشانه‌گیری مگسک دقیقاً وسط دید می‌نشیند (ارتفاع مگسک × مقیاس اسلحه)
      aimPos: new THREE.Vector3(0, -0.15, -0.4),
      aimRot: new THREE.Vector3(0, 0, 0),
      handQ: q(-0.35, 0, 0.12),
    };
  }

  private buildFists(): Rig {
    const m = this.m;
    const root = new THREE.Group();
    const arms = new THREE.Group();
    const weapon = new THREE.Group();
    root.add(arms, weapon);

    // افکت هلالیِ مشت
    const slash = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.52, 12, 1, -0.9, 1.8),
      new THREE.MeshBasicMaterial({
        color: 0xffe6a8,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    slash.position.set(0, -0.05, -0.9);
    slash.visible = false;

    // هدف دست‌ها (پیش‌فرض: گارد بوکس)
    const targetR = new THREE.Object3D();
    targetR.position.set(0.19, -0.16, -0.34);
    const targetL = new THREE.Object3D();
    targetL.position.set(-0.19, -0.19, -0.34);
    weapon.add(slash, targetR, targetL);
    weapon.userData = { slash };

    const armR = buildArm(m);
    const armL = buildArm(m);
    arms.add(armR.root, armL.root);

    return {
      root,
      arms,
      weapon,
      armR,
      armL,
      targetR,
      targetL,
      hipPos: new THREE.Vector3(0, -0.3, -0.42),
      hipRot: new THREE.Vector3(0, 0, 0),
      aimPos: new THREE.Vector3(0, -0.26, -0.4),
      aimRot: new THREE.Vector3(0, 0, 0),
      handQ: q(-0.5, 0.1, 0.06),
    };
  }

  private buildKnife(): Rig {
    const m = this.m;
    const root = new THREE.Group();
    const arms = new THREE.Group();
    const weapon = new THREE.Group();
    root.add(arms, weapon);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.058, 0.2), m.dark);
    handle.position.set(0, 0, 0.09);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.095, 0.026), m.metal);
    guard.position.set(0, 0.005, -0.012);
    const bladeGeo = new THREE.BoxGeometry(0.017, 0.078, 0.46);
    bladeGeo.translate(0, 0.005, -0.24);
    const blade = new THREE.Mesh(bladeGeo, m.blade);
    const edgeGeo = new THREE.BoxGeometry(0.007, 0.014, 0.44);
    edgeGeo.translate(0, -0.034, -0.24);
    const edge = new THREE.Mesh(edgeGeo, m.edge);
    const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.052, 0.04), m.trim);
    pommel.position.set(0, 0, 0.19);
    const targetR = new THREE.Object3D();
    targetR.position.set(0, -0.01, 0.11);
    weapon.add(handle, guard, blade, edge, pommel, targetR);
    weapon.scale.setScalar(1.1);

    // افکت برش
    const slash = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.88, 18, 1, -1.1, 2.2),
      new THREE.MeshBasicMaterial({
        color: 0xb7fbff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    slash.position.set(0, -0.05, -0.95);
    slash.visible = false;
    weapon.add(slash);
    weapon.userData = { slash };

    // دست چپ: گارد کنار بدن
    const targetL = new THREE.Object3D();
    targetL.position.set(-0.2, -0.18, -0.3);
    root.add(targetL);

    const armR = buildArm(m);
    const armL = buildArm(m);
    arms.add(armR.root, armL.root);

    return {
      root,
      arms,
      weapon,
      armR,
      armL,
      targetR,
      targetL,
      hipPos: new THREE.Vector3(0.26, -0.34, -0.5),
      hipRot: new THREE.Vector3(0.1, -0.18, 0.24),
      aimPos: new THREE.Vector3(0.1, -0.24, -0.44),
      aimRot: new THREE.Vector3(0.05, -0.06, 0.12),
      handQ: q(-0.2, 0.35, 0.15),
    };
  }

  /* --------------------------------------------------------------------- */
  /*                               انیمیشن                                  */
  /* --------------------------------------------------------------------- */

  update(f: ViewFrame) {
    const dt = Math.min(0.05, Math.max(0, f.dt));
    this.kick = Math.max(0, this.kick - dt * 7.5);
    this.flash = Math.max(0, this.flash - dt * 13);
    this.aim += (f.aim01 - this.aim) * (1 - Math.exp(-16 * dt));

    // تعویض اسلات: نیمه‌ی اول سلاح قبلی پایین می‌رود، نیمه‌ی دوم سلاح جدید بالا می‌آید
    let drop = 0;
    if (this.switchT > 0) {
      this.switchT = Math.max(0, this.switchT - dt);
      const p = 1 - this.switchT / SWITCH_TIME;
      if (!this.swapped && p >= 0.5) {
        this.swapped = true;
        this.rigs[this.switchFrom].root.visible = false;
        this.rigs[this.slot].root.visible = true;
        this.shown = this.slot;
      }
      drop = Math.sin(Math.min(1, p) * Math.PI) * 0.9;
    }

    const rig = this.rigs[this.shown];
    const slot = this.shown;
    const aim = slot === "gun" ? this.aim : this.aim * 0.5;

    // ---------- حالت پایه (هیپ ← نشانه) ----------
    const px = lerp(rig.hipPos.x, rig.aimPos.x, aim);
    const py = lerp(rig.hipPos.y, rig.aimPos.y, aim);
    const pz = lerp(rig.hipPos.z, rig.aimPos.z, aim);
    let rx = lerp(rig.hipRot.x, rig.aimRot.x, aim);
    let ry = lerp(rig.hipRot.y, rig.aimRot.y, aim);
    let rz = lerp(rig.hipRot.z, rig.aimRot.z, aim);

    // ---------- گام: راه‌رفتن و دویدن ----------
    const gait = f.speed01 * (1 - aim * 0.72);
    const amp = 0.55 + f.sprint01 * 1.2;
    const bobX = Math.sin(f.bob) * 0.03 * gait * amp;
    const bobY = -Math.abs(Math.cos(f.bob)) * 0.034 * gait * amp;
    const bobR = Math.sin(f.bob) * 0.05 * gait * amp;
    const idle = Math.sin(f.elapsed * 1.5) * 0.006 * (1 - gait);
    // دویدن: اسلحه به حالت حمل پایین و کج می‌شود
    const carry = f.sprint01 * (1 - aim);
    const air = THREE.MathUtils.clamp(-f.vy * 0.012, -0.06, 0.09);
    const land = f.landDip * 0.16;

    rig.root.position.set(
      px + bobX + f.swayX * (1 - aim * 0.65) + carry * 0.05,
      py + bobY + idle + f.swayY * (1 - aim * 0.6) - carry * 0.09 + air - land - drop,
      pz + this.kick * 0.13 + carry * 0.05,
    );
    rx += -this.kick * 0.24 + carry * 0.3 + land * 1.1 + drop * 1.25 + bobR * 0.3;
    ry += bobX * 1.4 - carry * 0.25 + f.swayX * 0.8;
    rz += -bobR * 0.75 + carry * 0.3 - drop * 0.55 - f.swayX * 1.0;
    rig.root.rotation.set(rx, ry, rz);

    // شانه‌ها کمی با حرکت جابه‌جا می‌شوند (حس بدن)
    rig.arms.position.set(-f.swayX * 0.22 * (1 - aim), -carry * 0.05 - land * 0.4, 0);

    const swing = swingCurve(f.meleeProgress);
    const w = rig.weapon;

    // ---------- اسلحه ----------
    if (slot === "gun") {
      const rp = f.reloading ? f.reloadProgress : -1;
      let magDrop = 0;
      let magTilt = 0;
      let boltBack = 0;
      let tilt = 0;
      if (rp >= 0) {
        tilt = Math.sin(Math.min(1, rp) * Math.PI) * 0.8;
        if (rp < 0.34) magDrop = THREE.MathUtils.smoothstep(rp, 0.08, 0.34) * 0.42;
        else if (rp < 0.54) magDrop = 0.42;
        else if (rp < 0.8) magDrop = (1 - THREE.MathUtils.smoothstep(rp, 0.54, 0.78)) * 0.42;
        magTilt = rp > 0.5 && rp < 0.82 ? Math.sin((rp - 0.5) * 9) * 0.18 : 0;
        boltBack = rp > 0.84 && rp < 0.97 ? Math.sin((rp - 0.84) * 24) * 0.07 : 0;
      }
      this.magMesh.position.set(0, -0.19 - magDrop, -0.02 - magDrop * 0.12);
      this.magMesh.rotation.set(magTilt, 0, magTilt * 0.6);
      this.magMesh.visible = magDrop < 0.41;
      this.boltMesh.position.set(0.075, 0.07, 0.02 + boltBack);
      w.rotation.set(this.kick * 0.3 + tilt, this.kick * 0.05 + magTilt * 0.2, -tilt * 0.42);
      w.position.set(0, -this.kick * 0.035 - tilt * 0.06, this.kick * 0.1 + tilt * 0.05);

      const dotMat = this.aimDot.material as THREE.MeshBasicMaterial;
      dotMat.opacity = aim * 0.95;
      this.aimDot.visible = aim > 0.03;

      const fm = this.muzzleFlash.material as THREE.SpriteMaterial;
      fm.opacity = this.flash * 0.9;
      fm.rotation = f.elapsed * 9;
      this.muzzleFlash.visible = this.flash > 0.02;
      const s = 0.3 + this.flash * 0.55;
      this.muzzleFlash.scale.set(s, s, s);
    } else if (slot === "knife") {
      // برش مورب: چرخش مچ + حرکت کمانی
      w.rotation.set(0.25 - swing * 1.2, -swing * 0.95, 0.5 - swing * 2.2);
      w.position.set(-swing * 0.24, swing * 0.1, -swing * 0.36);
      const fx = (this.rigs.knife.weapon.userData as Record<string, THREE.Mesh>).slash;
      const fxm = fx.material as THREE.MeshBasicMaterial;
      fxm.opacity = swing * 0.7;
      fx.visible = swing > 0.02;
      fx.rotation.z = 1.2 - swing * 2.6;
      fx.position.z = -0.95 - swing * 0.15;
    } else {
      w.position.set(0, 0, 0);
      w.rotation.set(0, 0, 0);
    }

    // ---------- هدف دست‌ها ----------
    this.root.updateMatrixWorld(true);
    const handR = this.localTarget(rig, rig.targetR, this.tmp);
    const handL = this.localTarget(rig, rig.targetL, this.tmp2);
    rig.armR.shoulder.copy(rig.armR.shoulderBase);
    rig.armL.shoulder.copy(rig.armL.shoulderBase);

    if (slot === "fists") {
      // گارد + پمپاژ گام + مشت
      const pump = Math.sin(f.bob) * (0.05 + f.sprint01 * 0.12) * gait;
      const pumpY = Math.abs(Math.cos(f.bob)) * (0.035 + f.sprint01 * 0.07) * gait;
      handR.set(
        0.19 - aim * 0.07 + pump,
        -0.16 + aim * 0.05 - pumpY - carry * 0.06 + air * 0.6,
        -0.34 - aim * 0.06 - pump * 0.6,
      );
      handL.set(
        -0.19 + aim * 0.07 - pump,
        -0.19 + aim * 0.06 - pumpY * 0.8 - carry * 0.05 + air * 0.6,
        -0.34 - aim * 0.06 + pump * 0.6,
      );
      if (swing > 0.001) {
        const punching = f.meleeHand === 0 ? handR : handL;
        const other = f.meleeHand === 0 ? handL : handR;
        const side = f.meleeHand === 0 ? 1 : -1;
        punching.set(0.06 * side, -0.1 - swing * 0.02, -0.34 - swing * 0.85);
        other.z += swing * 0.1;
        other.y -= swing * 0.03;
        const arm = f.meleeHand === 0 ? rig.armR : rig.armL;
        arm.shoulder.z -= swing * 0.24;
        arm.shoulder.y -= swing * 0.06;
        const fx = (rig.weapon.userData as Record<string, THREE.Mesh>).slash;
        (fx.material as THREE.MeshBasicMaterial).opacity = swing * 0.4;
        fx.visible = swing > 0.02;
        fx.rotation.z = swing * 1.4 - 0.7;
        fx.position.z = -0.9 - swing * 0.2;
      } else {
        const fx = (rig.weapon.userData as Record<string, THREE.Mesh>).slash;
        fx.visible = false;
      }
    } else {
      const lift = this.kick * 0.06;
      handR.y += lift;
      handL.y += lift * 0.6;
      handR.z += this.kick * 0.05;
      handL.z += this.kick * 0.03;
      if (slot === "gun" && f.reloading) {
        // دست چپ برای تعویض خشاب پایین می‌رود و برمی‌گردد
        const rp = f.reloadProgress;
        const reach = rp < 0.5 ? THREE.MathUtils.smoothstep(rp, 0.05, 0.42) : 1 - THREE.MathUtils.smoothstep(rp, 0.62, 0.92);
        handL.set(handL.x - 0.02 * reach, handL.y - 0.22 * reach, handL.z + 0.18 * reach);
      }
      if (slot === "knife") {
        handL.set(-0.2 + swing * 0.08, -0.18 - swing * 0.06, -0.3 - swing * 0.14);
        rig.armR.shoulder.z -= swing * 0.22;
      }
      if (carry > 0.01 && slot === "gun") {
        // هنگام دویدن دست چپ آزادتر تکان می‌خورد
        handL.y += Math.sin(f.bob + 1.2) * 0.05 * carry;
        handL.x += Math.cos(f.bob) * 0.03 * carry;
      }
    }

    aimArm(rig.armR, handR, rig.handQ);
    aimArm(rig.armL, handL, rig.handQ);

    // مرگ: دست‌ها پایین می‌افتند
    if (!f.alive) {
      rig.root.position.y -= 0.45;
      rig.root.rotation.x += 0.65;
    }
  }

  /** هدف دست (فرزند weapon/root) را به فضای arms تبدیل می‌کند */
  private localTarget(rig: Rig, obj: THREE.Object3D, out: THREE.Vector3) {
    obj.getWorldPosition(out);
    return rig.arms.worldToLocal(out);
  }
}
