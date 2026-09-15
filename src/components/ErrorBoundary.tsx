import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * مرز خطای سراسری: اگر رندر یا افکت‌های بازی (مثلاً ساخت WebGL) بترکد،
 * به‌جای صفحه‌ی سیاه/اسپینر بی‌پایان، پیام فارسی + دکمه‌ی تلاش دوباره نشان می‌دهد.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error) {
    console.error("[cyber-arena] خطای مهارنشده:", error);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#05060f] px-4">
        <div className="glass w-full max-w-sm rounded-3xl p-6 text-center">
          <div className="text-4xl">🛠️</div>
          <div className="mt-2 text-xl font-extrabold text-rose-200">بازی لود نشد</div>
          <p className="mt-2 text-xs leading-relaxed text-cyan-100/70">
            مشکلی در راه‌اندازی بازی پیش آمد. معمولاً با تلاش دوباره یا رفرش صفحه حل می‌شود.
            اگر مرورگرت قدیمی است، از Chrome یا Safari به‌روز استفاده کن و مطمئن شو WebGL فعال است.
          </p>
          <div className="mt-4 space-y-2">
            <button
              onClick={this.retry}
              className="touch-btn w-full rounded-2xl border border-cyan-200/40 bg-gradient-to-b from-cyan-400/85 to-sky-700/85 py-3 font-extrabold text-white"
            >
              تلاش دوباره
            </button>
            <button
              onClick={() => window.location.reload()}
              className="touch-btn w-full rounded-2xl border border-slate-400/25 bg-slate-800/70 py-2.5 text-sm font-bold text-cyan-100"
            >
              رفرش صفحه
            </button>
          </div>
        </div>
      </div>
    );
  }
}
