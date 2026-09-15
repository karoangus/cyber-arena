// استاب three برای تست headless موتور در Node:
// همه‌چیز واقعی است جز WebGLRenderer که با یک پیاده‌سازی تقلبی جایگزین می‌شود
// (هندسه/ریاضی/صحنه/نور/مواد three واقعی اجرا می‌شوند، فقط رندر GPU حذف شده).
// NOTE: ایمپورت مستقیم فایل است تا با aliasـِ esbuild حلقه نشود.
export * from "../node_modules/three/build/three.module.js";

interface RendererParams {
  canvas?: unknown;
  antialias?: boolean;
  powerPreference?: string;
  stencil?: boolean;
}

interface FakeCanvas {
  width: number;
  height: number;
  parentElement: { clientWidth: number; clientHeight: number } | null;
}

/** جایگزین سبک WebGLRenderer برای اجرا در Node (بدون نیاز به GPU/مرورگر) */
export class WebGLRenderer {
  domElement: FakeCanvas;
  private pixelRatio = 1;
  renderCalls = 0;
  disposed = false;

  constructor(params: RendererParams = {}) {
    this.domElement = (params.canvas ??
      ({
        width: 0,
        height: 0,
        parentElement: null,
      } as FakeCanvas)) as FakeCanvas;
  }

  setPixelRatio(v: number) {
    this.pixelRatio = v;
  }
  setClearColor(_color: number, _alpha?: number) {
    /* noop */
  }
  setSize(w: number, h: number, _updateStyle = true) {
    this.domElement.width = Math.floor(w * this.pixelRatio);
    this.domElement.height = Math.floor(h * this.pixelRatio);
  }
  render(_scene: unknown, _camera: unknown) {
    this.renderCalls++;
  }
  dispose() {
    this.disposed = true;
  }
}
