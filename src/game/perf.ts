/**
 * مقیاس‌دهنده‌ی کیفیت خودکار (dynamic resolution)
 * ---------------------------------------------------------------------------
 * هدف: بازی روی دستگاه‌های ضعیف هم نرم بماند. به‌جای اینکه بازیکن دست بزند،
 * موتور زمان هر فریم را اندازه می‌گیرد؛ اگر میانگین فریم کند باشد (زیر ~۴۷ فریم
 * بر ثانیه) کیفیت رندر را کم می‌کند (pixel ratio پایین‌تر) و اگر دستگاه جا
 * داشت، کیفیت را به‌تدریج برمی‌گرداند. همه‌چیز تدریجی و با هسته‌ی آرامش
 * (hysteresis) است تا کیفیت «نوسان» نکند.
 *
 * این کلاس کاملاً خالص (بدون سه/رندرر) است تا بدون GPU قابل تست باشد.
 */
export class PerfScaler {
  /** پایین‌ترین نسبت کیفیت (۵۵٪ از رزولوشن پایه) */
  readonly minRatio = 0.55;
  /** بالاترین نسبت کیفیت (۱۰۰٪ — همان رزولوشن انتخاب‌شده‌ی دستگاه) */
  readonly maxRatio = 1;

  /** نسبت کیفیت فعلی (۱ = کامل، ۰.۵۵ = حداقل) */
  ratio = 1;

  private emaMs = 16.7;
  private accTime = 0;
  private accFrames = 0;
  /** هر ۱.۵ ثانیه یک‌بار تصمیم گرفته می‌شود */
  private readonly windowMs = 1500;
  /** بعد از هر تغییر، حداقل ۹۰۰ میلی‌ثانیه صبر می‌کنیم (جلوگیری از نوسان) */
  private readonly hysteresisMs = 900;
  private lastChangeAt = -1e9;
  /** ۲ ثانیه اول (لود/گرم‌شدن) تصمیمی گرفته نمی‌شود */
  private readonly warmupMs = 2000;

  /**
   * نمونه‌برداری از یک فریم.
   * @param frameMs فاصله‌ی واقعی (میلی‌ثانیه) بین این فریم و فریم قبل
   * @param nowMs زمان فعلی (timestamp فریم، میلی‌ثانیه)
   */
  sample(frameMs: number, nowMs: number) {
    // فریم‌های خیلی طولانی معمولاً به‌خاطر پس‌زمینه رفتن تب/کارتابل/کشتن‌شدن
    // اسکرپت است، نه ضعف دستگاه — از محاسبه بیرونشان می‌گذاریم
    if (!(frameMs > 0) || frameMs > 250) return;
    this.accTime += frameMs;
    this.accFrames++;
    this.emaMs += (frameMs - this.emaMs) * 0.05;
    void nowMs;
  }

  /**
   * بررسی دوره‌ای کیفیت. حتماً بعد از sample هر فریم صدا زده شود.
   * @returns true اگر نسبت کیفیت تغییر کرد (موتور باید رندرر را به‌روز کند)
   */
  update(nowMs: number): boolean {
    if (this.accFrames === 0 || this.accTime < this.windowMs) return false;
    const avg = this.accTime / this.accFrames;
    this.accTime = 0;
    this.accFrames = 0;
    if (nowMs < this.warmupMs) return false;
    if (nowMs - this.lastChangeAt < this.hysteresisMs) return false;

    let changed = false;
    if (avg > 21 && this.ratio > this.minRatio + 1e-6) {
      // کند است → کیفیت را یک پله پایین بیاور
      this.ratio = Math.max(this.minRatio, this.ratio * 0.85);
      changed = true;
    } else if (avg < 12.5 && this.ratio < this.maxRatio - 1e-6) {
      // دستگاه جا دارد → کیفیت را آهسته برگردان
      this.ratio = Math.min(this.maxRatio, this.ratio * 1.12);
      changed = true;
    }
    if (changed) this.lastChangeAt = nowMs;
    return changed;
  }

  /** میانگین متحرک زمان فریم (برای دیباگ/HUD) */
  get frameMs() {
    return this.emaMs;
  }

  /** برگرداندن به کیفیت کامل (مثلاً بعد از restart) */
  reset() {
    this.ratio = 1;
    this.emaMs = 16.7;
    this.accTime = 0;
    this.accFrames = 0;
    this.lastChangeAt = -1e9;
  }
}
