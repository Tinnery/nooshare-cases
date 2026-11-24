// web/src/client/lib/mode.svelte.ts
// 数据模式 store（Svelte 5 runes）：全局 REAL/FIXTURE + localStorage 持久化 + 按域锁定。
// 单向降级规则：REAL → FIXTURE 直接切换；FIXTURE → REAL 必须显式确认（confirmed=true）。

export type Mode = "real" | "fixture";
export type Domain = "market" | "discovery" | "cases" | "review" | "corpus" | "runs" | "search";

const STORAGE_KEY = "nooshare.mode";

/** 从 localStorage 读初始模式（默认 REAL） */
function loadMode(): Mode {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "fixture") return "fixture";
  } catch {
    /* 隐私模式等场景静默降级 */
  }
  return "real";
}

// runes 全局单例：对象属性可跨模块直接修改
export const mode = $state<{ current: Mode }>({ current: loadMode() });

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode.current);
  } catch {
    /* 持久化失败不影响功能 */
  }
}

/** URL ?mode= 覆盖（Phase 2 §5.1：localStorage + URL 双持久化）；URL 显式指定视为人工确认 */
export function applyModeFromUrl(search: string): void {
  const m = new URLSearchParams(search).get("mode");
  if ((m === "real" || m === "fixture") && m !== mode.current) {
    mode.current = m;
    persist();
  }
}

/** 切换模式。fixture → real 必须 confirmed=true（单向降级防线的唯一出口） */
export function setMode(next: Mode, confirmed = false): boolean {
  if (next === mode.current) return true;
  if (next === "real" && !confirmed) return false; // 返回 REAL 需上层确认
  mode.current = next;
  persist();
  return true;
}

/** 路径 → 域（/cases/:id 归入 cases 域；详情页徽章按 case.is_fixture 单独解析） */
export function domainFromPath(pathname: string): Domain {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/market") return "market";
  if (p === "/discovery") return "discovery";
  if (p.startsWith("/cases")) return "cases";
  if (p === "/review") return "review";
  if (p === "/corpus") return "corpus";
  if (p === "/runs") return "runs";
  if (p === "/search") return "search";
  return "market"; // 未知路径按 Market 处理（App 层重定向兜底）
}

/** 按域解析实际生效模式（Phase 2 §5.1 域锁定；同一页面永不混用） */
export function resolveMode(domain: Domain): Mode {
  if (domain === "market" || domain === "discovery") return "real"; // 恒 REAL
  if (domain === "search") return mode.current; // 搜索页两组并存，跟随全局模式
  return "fixture"; // cases / review / corpus / runs 恒 FIXTURE（P0）
}

/** 模式切换控件被域锁定时的说明文字；null = 可切换 */
export function modeLockReason(domain: Domain): string | null {
  if (domain === "market" || domain === "discovery") return "Market / Discovery 仅提供真实数据";
  if (domain === "search") return null;
  return "Cases 域暂未接入真实数据（P0），固定 FIXTURE";
}
