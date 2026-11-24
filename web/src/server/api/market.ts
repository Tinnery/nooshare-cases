// web/src/server/api/market.ts
// Market API：全部为 REAL 只读数据（research / ju schema 只读）。
// 路由：GET /api/market/dates · GET /api/market/day/:date · GET /api/market/observation/:snapshot/:date/:code
import { sql, latestSnapshotId, trimTime, num } from "../db";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// ---------- 共享查询 ----------

interface SnapshotMeta {
  snapshotId: string;
  snapshotAt: string | null;
  importedAt: string | null;
  dateRange: [string | null, string | null];
  sourceRowCount: number | null;
  importStatus: string;
}

/** snapshot 注册表元信息 */
async function snapshotMeta(snapshotId: string): Promise<SnapshotMeta | null> {
  const rows = await sql<{
    source_snapshot_id: string;
    snapshot_at: string | null;
    imported_at: string | null;
    min_trade_date: string | null;
    max_trade_date: string | null;
    source_row_count: string | null;
    import_status: string;
  }[]>`
    SELECT source_snapshot_id, snapshot_at::text, imported_at::text,
           min_trade_date::text, max_trade_date::text,
           source_row_count::text, import_status
    FROM research.source_snapshot
    WHERE source_snapshot_id = ${snapshotId}
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    snapshotId: r.source_snapshot_id,
    snapshotAt: r.snapshot_at,
    importedAt: r.imported_at,
    dateRange: [r.min_trade_date, r.max_trade_date],
    sourceRowCount: num(r.source_row_count),
    importStatus: r.import_status,
  };
}

// ---------- GET /api/market/dates ----------

async function marketDates(): Promise<Response> {
  const snap = await latestSnapshotId();
  if (!snap) return json({ error: "无可用数据快照" }, 503);

  const rows = await sql<{ trade_date: string }[]>`
    SELECT DISTINCT trade_date::text AS trade_date
    FROM research.market_limit_up_observation
    WHERE source_snapshot_id = ${snap}
    ORDER BY trade_date DESC
  `;
  const dates = rows.map((r) => r.trade_date);
  const latestComplete = dates[0] ?? null;

  // 完整性判定（data-facts §2.9）：public.trading_calendar 语义接入前，
  // 退化为按 observation 覆盖日期判断——整 snapshot 导入，覆盖范围内视为完整。
  return json({
    dates,
    latestComplete,
    completeness: "full",
    completenessSource: "observation_coverage",
    note: "完整性按 observation 覆盖日期判断；public.trading_calendar 接入后升级为日历比对",
    snapshotId: snap,
  });
}

// ---------- GET /api/market/day/:date ----------

/** 观察行（JOIN 股票身份；LATERAL 防止身份区间重叠导致的重复行） */
async function fetchDayObservations(snap: string, date: string) {
  const rows = await sql<{
    stock_code: string;
    display_name: string | null;
    latest_price: string | null;
    change_pct: string | null;
    limit_up_status: string | null;
    continuous_days: number | null;
    first_limit_up_time: string | null;
    final_limit_up_time: string | null;
    limit_up_seal_amount: string | null;
    limit_up_seal_volume: string | null;
    limit_up_open_count: number | null;
    days_boards: string | null;
    circulating_market_cap: string | null;
    seal_vol_ratio: string | null;
    seal_cap_ratio: string | null;
    limit_up_detail: string | null;
    limit_up_reason: string | null;
    refreshed_at: string | null;
  }[]>`
    SELECT o.stock_code, s.display_name,
           o.latest_price::text, o.change_pct::text, o.limit_up_status,
           o.continuous_days, o.first_limit_up_time, o.final_limit_up_time,
           o.limit_up_seal_amount::text, o.limit_up_seal_volume::text,
           o.limit_up_open_count, o.days_boards, o.circulating_market_cap::text,
           o.seal_vol_ratio::text, o.seal_cap_ratio::text,
           o.limit_up_detail, o.limit_up_reason, o.refreshed_at::text
    FROM research.market_limit_up_observation o
    LEFT JOIN LATERAL (
      SELECT display_name FROM ju.stocks s
      WHERE s.stock_code = o.stock_code
        AND s.start_date <= o.trade_date
        AND (s.end_date IS NULL OR s.end_date >= o.trade_date)
      LIMIT 1
    ) s ON true
    WHERE o.source_snapshot_id = ${snap} AND o.trade_date = ${date}::date
    ORDER BY o.limit_up_seal_amount DESC NULLS LAST, o.stock_code
  `;
  return rows.map((r) => ({
    stockCode: r.stock_code,
    name: r.display_name,
    latestPrice: num(r.latest_price),
    // change_pct 为小数（0.0998），转换为百分比数值（9.98）
    changePct: num(r.change_pct),
    limitUpStatus: r.limit_up_status,
    continuousDays: r.continuous_days,
    firstLimitUpTime: trimTime(r.first_limit_up_time),
    finalLimitUpTime: trimTime(r.final_limit_up_time),
    sealAmount: num(r.limit_up_seal_amount),
    sealVolume: num(r.limit_up_seal_volume),
    openCount: r.limit_up_open_count,
    daysBoards: r.days_boards,
    circulatingMarketCap: num(r.circulating_market_cap),
    sealVolRatio: num(r.seal_vol_ratio),
    sealCapRatio: num(r.seal_cap_ratio),
    limitUpDetail: r.limit_up_detail, // 原始 JSON 字符串，前端解析展示
    limitUpReason: r.limit_up_reason,
    refreshedAt: r.refreshed_at,
    themes: [] as { themeId: string; themeName: string; mappingStatus: string }[],
  }));
}

async function marketDay(date: string): Promise<Response> {
  const snap = await latestSnapshotId();
  if (!snap) return json({ error: "无可用数据快照" }, 503);
  const snapMeta = await snapshotMeta(snap);

  const observations = await fetchDayObservations(snap, date);

  // 该日观察 → 主题映射（含 mapping_status，供"已标准化 / 候选映射"区分）
  const obsThemeRows = await sql<{
    stock_code: string;
    theme_id: string;
    theme_name: string;
    mapping_status: string;
  }[]>`
    SELECT ot.stock_code, ot.theme_id, t.theme_name, ot.mapping_status
    FROM research.observation_theme ot
    JOIN research.theme t ON t.theme_id = ot.theme_id
    WHERE ot.source_snapshot_id = ${snap} AND ot.trade_date = ${date}::date
    ORDER BY ot.created_at, ot.theme_id
  `;
  const themeMap = new Map<string, { themeId: string; themeName: string; mappingStatus: string }[]>();
  for (const r of obsThemeRows) {
    const list = themeMap.get(r.stock_code) ?? [];
    list.push({ themeId: r.theme_id, themeName: r.theme_name, mappingStatus: r.mapping_status });
    themeMap.set(r.stock_code, list);
  }
  for (const o of observations) o.themes = themeMap.get(o.stockCode) ?? [];

  // 主题分布（按 mapping_status 分组，与 Phase 2 ③ 表"归属"列对应）
  const themeRows = await sql<{
    theme_id: string;
    theme_name: string;
    mapping_status: string;
    stock_count: string;
    fragment_count: string;
  }[]>`
    SELECT ot.theme_id, t.theme_name, ot.mapping_status,
           count(DISTINCT ot.stock_code)::text AS stock_count,
           count(DISTINCT rf.fragment_id)::text AS fragment_count
    FROM research.observation_theme ot
    JOIN research.theme t ON t.theme_id = ot.theme_id
    LEFT JOIN research.reason_fragment rf
      ON rf.source_snapshot_id = ot.source_snapshot_id
     AND rf.trade_date = ot.trade_date
     AND rf.stock_code = ot.stock_code
    WHERE ot.source_snapshot_id = ${snap} AND ot.trade_date = ${date}::date
    GROUP BY ot.theme_id, t.theme_name, ot.mapping_status
    ORDER BY count(DISTINCT ot.stock_code) DESC, ot.theme_id
  `;

  // 当日活跃的 Episode（覆盖该交易日的主题活跃期）
  const epRows = await sql<{
    episode_id: string;
    theme_id: string;
    status: string;
    start_date: string;
    end_date: string;
    peak_date: string | null;
    peak_obs_count: number | null;
  }[]>`
    SELECT e.episode_id::text, e.theme_id::text, e.status::text,
           e.start_date::text, e.end_date::text, e.peak_date::text, e.peak_obs_count
    FROM research.theme_episode e
    WHERE e.start_date <= ${date}::date AND e.end_date >= ${date}::date
    ORDER BY e.theme_id, e.start_date
  `;

  const themes = themeRows.map((r) => ({
    themeId: r.theme_id,
    themeName: r.theme_name,
    mappingStatus: r.mapping_status, // confirmed = 已标准化 / candidate = 候选映射
    stockCount: num(r.stock_count) ?? 0,
    fragmentCount: num(r.fragment_count) ?? 0,
    episodes: epRows.filter((e) => e.theme_id === r.theme_id).map((e) => ({
      episodeId: e.episode_id,
      status: e.status,
      startDate: e.start_date,
      endDate: e.end_date,
      peakDate: e.peak_date,
      peakObsCount: e.peak_obs_count,
    })),
  }));

  // 概况条（Phase 2 ② 单行内联统计）
  const continuousBoards = observations.filter((o) => (o.continuousDays ?? 0) >= 2).length;
  const firstBoards = observations.filter((o) => o.continuousDays === 1).length;
  const maxContinuousDays = observations.reduce((mx, o) => Math.max(mx, o.continuousDays ?? 0), 0);
  const themesCovered = new Set(obsThemeRows.map((r) => r.theme_id)).size;
  // 分母 = 标准化主题总数（如"覆盖主题 7/8"）
  const themeTotalRows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM research.theme
  `;

  return json({
    date,
    snapshot: snapMeta,
    summary: {
      total: observations.length,
      continuousBoards,
      firstBoards,
      maxContinuousDays,
      themesCovered,
      themesTotal: num(themeTotalRows[0]?.n) ?? 0,
    },
    themes,
    observations,
  });
}

// ---------- GET /api/market/observation/:snapshot/:date/:code ----------

async function observationDetail(snapshotId: string, date: string, code: string): Promise<Response> {
  const rows = await sql<{
    stock_code: string;
    display_name: string | null;
    trade_date: string;
    latest_price: string | null;
    change_pct: string | null;
    limit_up_status: string | null;
    continuous_days: number | null;
    first_limit_up_time: string | null;
    final_limit_up_time: string | null;
    limit_up_seal_amount: string | null;
    limit_up_seal_volume: string | null;
    limit_up_open_count: number | null;
    days_boards: string | null;
    circulating_market_cap: string | null;
    seal_vol_ratio: string | null;
    seal_cap_ratio: string | null;
    limit_up_detail: string | null;
    limit_up_reason: string | null;
    refreshed_at: string | null;
  }[]>`
    SELECT o.stock_code, s.display_name, o.trade_date::text,
           o.latest_price::text, o.change_pct::text, o.limit_up_status,
           o.continuous_days, o.first_limit_up_time, o.final_limit_up_time,
           o.limit_up_seal_amount::text, o.limit_up_seal_volume::text,
           o.limit_up_open_count, o.days_boards, o.circulating_market_cap::text,
           o.seal_vol_ratio::text, o.seal_cap_ratio::text,
           o.limit_up_detail, o.limit_up_reason, o.refreshed_at::text
    FROM research.market_limit_up_observation o
    LEFT JOIN LATERAL (
      SELECT display_name FROM ju.stocks s
      WHERE s.stock_code = o.stock_code
        AND s.start_date <= o.trade_date
        AND (s.end_date IS NULL OR s.end_date >= o.trade_date)
      LIMIT 1
    ) s ON true
    WHERE o.source_snapshot_id = ${snapshotId}
      AND o.trade_date = ${date}::date
      AND o.stock_code = ${code}
  `;
  const r = rows[0];
  if (!r) return json({ error: `观察记录不存在：${snapshotId} / ${date} / ${code}` }, 404);

  // 原始原因片段（raw_reason 分段）
  const fragmentRows = await sql<{
    fragment_id: string;
    fragment_ordinal: number;
    raw_fragment: string;
    normalized_fragment: string;
    match_status: string | null;
    parser_version: string;
  }[]>`
    SELECT fragment_id, fragment_ordinal, raw_fragment, normalized_fragment,
           match_status, parser_version
    FROM research.reason_fragment
    WHERE source_snapshot_id = ${snapshotId} AND trade_date = ${date}::date AND stock_code = ${code}
    ORDER BY fragment_ordinal
  `;

  // 主题映射明细（candidate / confirmed 为原始 vs 标准化的关键字段）
  const mappingRows = await sql<{
    theme_id: string;
    theme_name: string;
    theme_type: string | null;
    alias_id: string | null;
    match_method: string;
    mapping_status: string;
  }[]>`
    SELECT ot.theme_id, t.theme_name, t.theme_type, ot.alias_id,
           ot.match_method, ot.mapping_status
    FROM research.observation_theme ot
    JOIN research.theme t ON t.theme_id = ot.theme_id
    WHERE ot.source_snapshot_id = ${snapshotId}
      AND ot.trade_date = ${date}::date
      AND ot.stock_code = ${code}
    ORDER BY ot.created_at
  `;

  // 映射主题关联的 Episode（覆盖该交易日）
  const themeIds = mappingRows.map((m) => m.theme_id);
  let episodes: unknown[] = [];
  if (themeIds.length > 0) {
    const epRows = await sql<{
      episode_id: string;
      theme_id: string;
      status: string;
      start_date: string;
      end_date: string;
      peak_date: string | null;
      peak_obs_count: number | null;
      total_obs_count: number | null;
      total_stock_count: number | null;
    }[]>`
      SELECT e.episode_id::text, e.theme_id::text, e.status::text,
             e.start_date::text, e.end_date::text, e.peak_date::text,
             e.peak_obs_count, e.total_obs_count, e.total_stock_count
      FROM research.theme_episode e
      WHERE e.theme_id = ANY(${themeIds})
        AND e.start_date <= ${date}::date AND e.end_date >= ${date}::date
      ORDER BY e.theme_id, e.start_date
    `;
    episodes = epRows;
  }

  const meta = await snapshotMeta(snapshotId);

  return json({
    snapshot: meta,
    observation: {
      stockCode: r.stock_code,
      name: r.display_name,
      date: r.trade_date,
      latestPrice: num(r.latest_price),
      changePct: num(r.change_pct),
      limitUpStatus: r.limit_up_status,
      continuousDays: r.continuous_days,
      firstLimitUpTime: trimTime(r.first_limit_up_time),
      finalLimitUpTime: trimTime(r.final_limit_up_time),
      sealAmount: num(r.limit_up_seal_amount),
      sealVolume: num(r.limit_up_seal_volume),
      openCount: r.limit_up_open_count,
      daysBoards: r.days_boards,
      circulatingMarketCap: num(r.circulating_market_cap),
      sealVolRatio: num(r.seal_vol_ratio),
      sealCapRatio: num(r.seal_cap_ratio),
      limitUpDetail: r.limit_up_detail,
      rawReason: r.limit_up_reason,
      refreshedAt: r.refreshed_at,
    },
    fragments: fragmentRows,
    themeMappings: mappingRows.map((m) => ({
      themeId: m.theme_id,
      themeName: m.theme_name,
      themeType: m.theme_type,
      aliasId: m.alias_id,
      matchMethod: m.match_method,
      mappingStatus: m.mapping_status,
    })),
    episodes,
  });
}

// ---------- 路由分发 ----------

export async function routeMarket(req: Request, path: string): Promise<Response | undefined> {
  if (req.method !== "GET") return undefined;
  if (path === "/api/market/dates") return marketDates();
  const day = /^\/api\/market\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (day) return marketDay(day[1]);
  const obs = /^\/api\/market\/observation\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/([^/]+)$/.exec(path);
  if (obs) return observationDetail(decodeURIComponent(obs[1]), obs[2], decodeURIComponent(obs[3]));
  return undefined;
}
