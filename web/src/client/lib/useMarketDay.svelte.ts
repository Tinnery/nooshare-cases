// web/src/client/lib/useMarketDay.svelte.ts
// Market 数据层钩子（Phase 2 附·提示 6）：一个钩子供概况条 / 主题表 / 主表 / Drawer 四处消费。
// 原子刷新：单一 day 数据源；<400ms 不出骨架屏（防闪烁）。

import { get } from "./api";

export interface MarketEpisodeBrief {
  episodeId: string;
  status: string;
  startDate: string;
  endDate: string;
  peakDate: string | null;
  peakObsCount: number | null;
}

export interface MarketThemeRow {
  themeId: string;
  themeName: string;
  mappingStatus: string; // confirmed = 已标准化 / candidate = 候选映射
  stockCount: number;
  fragmentCount: number;
  episodes: MarketEpisodeBrief[];
}

export interface MarketObservation {
  stockCode: string;
  name: string | null;
  latestPrice: number | null;
  changePct: number | null; // 已是百分数（server 已转换）
  limitUpStatus: string | null;
  continuousDays: number | null;
  firstLimitUpTime: string | null;
  finalLimitUpTime: string | null;
  sealAmount: number | null;
  sealVolume: number | null;
  openCount: number | null;
  daysBoards: string | null;
  circulatingMarketCap: number | null;
  sealVolRatio: number | null;
  sealCapRatio: number | null;
  limitUpDetail: string | null;
  limitUpReason: string | null;
  refreshedAt: string | null;
  themes: { themeId: string; themeName: string; mappingStatus: string }[];
}

export interface MarketDayData {
  date: string;
  snapshot: {
    snapshotId: string;
    snapshotAt: string | null;
    importedAt: string | null;
    dateRange: [string | null, string | null];
    sourceRowCount: number | null;
    importStatus: string;
  } | null;
  summary: {
    total: number;
    continuousBoards: number;
    firstBoards: number;
    maxContinuousDays: number;
    themesCovered: number;
    themesTotal: number;
  };
  themes: MarketThemeRow[];
  observations: MarketObservation[];
}

export interface MarketDatesData {
  dates: string[];
  latestComplete: string | null;
  completeness: string;
  completenessSource: string;
  note: string;
  snapshotId: string;
}

export function useMarketDay() {
  // 交易日元信息
  let datesInfo = $state<MarketDatesData | null>(null);
  let datesLoading = $state(true);
  let datesError = $state<string | null>(null);

  // 当前交易日（原子刷新的单一数据源）
  let date = $state<string | null>(null);
  let day = $state<MarketDayData | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  // 骨架屏延迟：<400ms 加载完成则不显示（Phase 2 §3.4 防闪烁）
  let showSkeleton = $state(false);
  let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

  /** 拉取交易日列表并选中默认日（referDate 优先：URL ?date=） */
  async function loadDates(referDate?: string | null): Promise<void> {
    datesLoading = true;
    datesError = null;
    try {
      datesInfo = await get<MarketDatesData>("/api/market/dates");
      const target = referDate ?? datesInfo.latestComplete ?? null;
      if (target) await loadDay(target);
    } catch (e) {
      datesError = e instanceof Error ? e.message : "加载交易日列表失败";
    } finally {
      datesLoading = false;
    }
  }

  /** 拉取某交易日数据（三区块原子消费同一结果） */
  async function loadDay(d: string): Promise<void> {
    loading = true;
    error = null;
    showSkeleton = false;
    if (skeletonTimer) clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (loading) showSkeleton = true;
    }, 400);
    try {
      day = await get<MarketDayData>(`/api/market/day/${d}`);
      date = d;
    } catch (e) {
      error = e instanceof Error ? e.message : "加载当日数据失败";
    } finally {
      loading = false;
      if (skeletonTimer) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
      showSkeleton = false;
    }
  }

  // getter 形式返回：直接引用 $state 变量只会捕获初始值（svelte state_referenced_locally），响应性会丢失
  return {
    get datesInfo() {
      return datesInfo;
    },
    get datesLoading() {
      return datesLoading;
    },
    get datesError() {
      return datesError;
    },
    loadDates,
    get date() {
      return date;
    },
    get day() {
      return day;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    get showSkeleton() {
      return showSkeleton;
    },
    loadDay,
  };
}
