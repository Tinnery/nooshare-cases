// web/src/client/lib/format.ts
// 展示格式化工具（Phase 1 §3 等宽/数字规则 + episode hex 展示规则）。

/** Episode ID（16 位 hex hash）：截断前 8 位展示（如 "EP 88119d49"），全值由调用方配 hover tooltip */
export function episodeShort(id: string): string {
  return `EP ${id.slice(0, 8)}`;
}

/** 涨跌幅：固定符号 + 两位小数（禁止省略正号，Phase 1 §3.3） */
export function signedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** 涨跌幅样式类（红涨绿跌，仅数字语境） */
export function pctClass(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "up" : "down";
}

/** 价格：两位小数 */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

/** 金额（元）：≥1 亿显示 X.XX亿，≥1 万显示 X.X万，否则原值 */
export function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(Math.round(v));
}

/** 比率（%）：两位小数 */
export function fmtRatio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

/** 当天日期 YYYY-MM-DD（本地时区） */
export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
