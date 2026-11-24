// web/src/server/api/discovery.ts
// Discovery API：REAL 热点队列（research 只读聚合）+ 人类校准动作写 cases schema。
// 路由：GET /api/discovery/queue · GET /api/discovery/theme/:topicId ·
//       POST /api/discovery/:topicId/skip · POST /api/discovery/:topicId/prepare
import { sql, latestSnapshotId, num } from "../db";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// 队列行主题标识：标准化主题 = "t:<theme_id>"；未映射原始片段 = "f:<normalized_fragment>"
function parseTopicId(topicId: string): { type: "theme" | "fragment"; key: string } {
  if (topicId.startsWith("t:")) return { type: "theme", key: topicId.slice(2) };
  if (topicId.startsWith("f:")) return { type: "fragment", key: topicId.slice(2) };
  // 兼容不带前缀的裸 theme_id
  return { type: "theme", key: topicId };
}

// ---------- Agent 状态推导（cases 表 + discovery_action） ----------

type AgentStatus = "unhandled" | "researching" | "prepared" | "researched" | "skipped" | "rejected";

// Case 生命周期 → Agent 状态与优先级（同一热点多 Case 时取最高进度）
const caseStatusMap: Record<string, { rank: number; agent: AgentStatus }> = {
  candidate: { rank: 1, agent: "prepared" },
  researching: { rank: 2, agent: "researching" },
  reviewing: { rank: 3, agent: "researched" },
  frozen: { rank: 4, agent: "researched" },
  observing: { rank: 4, agent: "researched" },
  completed: { rank: 5, agent: "researched" },
  rejected: { rank: 0, agent: "rejected" },
  blocked: { rank: -1, agent: "rejected" },
};

interface CaseRef {
  caseId: string;
  title: string;
  status: string;
  refKeys: string[]; // trigger_discovery_ref 中的可匹配键
}

async function loadCaseRefs(): Promise<CaseRef[]> {
  const rows = await sql<{
    case_id: string;
    title: string;
    status: string;
    trigger_discovery_ref: Record<string, unknown> | null;
  }[]>`
    SELECT case_id, title, status, trigger_discovery_ref
    FROM cases."case"
    ORDER BY created_at
  `;
  return rows.map((r) => {
    const ref = r.trigger_discovery_ref ?? {};
    const keys = [ref.subjectKey, ref.themeName, ref.normalized_fragment]
      .filter((v): v is string => typeof v === "string" && v !== "");
    return { caseId: r.case_id, title: r.title, status: r.status, refKeys: keys };
  });
}

/** 热点 → Agent 状态 + 候选 Case */
function deriveAgentStatus(
  topicKeys: string[],
  cases: CaseRef[],
  skipped: boolean
): { agentStatus: AgentStatus; candidateCase: { caseId: string; title: string; status: string } | null } {
  let best: { rank: number; agent: AgentStatus; c: CaseRef } | null = null;
  for (const c of cases) {
    if (!c.refKeys.some((k) => topicKeys.includes(k))) continue;
    const m = caseStatusMap[c.status] ?? { rank: -1, agent: "rejected" as AgentStatus };
    if (m.rank < 0) continue; // blocked 不参与
    if (!best || m.rank > best.rank) best = { rank: m.rank, agent: m.agent, c };
  }
  if (best) {
    return {
      agentStatus: best.agent,
      candidateCase: { caseId: best.c.caseId, title: best.c.title, status: best.c.status },
    };
  }
  return { agentStatus: skipped ? "skipped" : "unhandled", candidateCase: null };
}

async function loadSkipKeys(): Promise<Set<string>> {
  // 最近一次动作为 skip 的主题视为已跳过（restore 可撤销）
  const rows = await sql<{ subject_key: string; action: string }[]>`
    SELECT DISTINCT ON (subject_type, subject_key) subject_key, action
    FROM cases.discovery_action
    ORDER BY subject_type, subject_key, created_at DESC
  `;
  return new Set(rows.filter((r) => r.action === "skip").map((r) => r.subject_key));
}

// ---------- GET /api/discovery/queue ----------

async function discoveryQueue(): Promise<Response> {
  const snap = await latestSnapshotId();
  if (!snap) return json({ error: "无可用数据快照" }, 503);

  // 1) 标准化片段聚合 = 热点队列主行
  const aggRows = await sql<{
    normalized_fragment: string;
    first_seen: string;
    last_seen: string;
    stock_count: string;
    fragment_count: string;
  }[]>`
    SELECT rf.normalized_fragment,
           min(rf.trade_date)::text AS first_seen,
           max(rf.trade_date)::text AS last_seen,
           count(DISTINCT rf.stock_code)::text AS stock_count,
           count(*)::text AS fragment_count
    FROM research.reason_fragment rf
    WHERE rf.source_snapshot_id = ${snap}
    GROUP BY rf.normalized_fragment
    ORDER BY max(rf.trade_date) DESC, count(DISTINCT rf.stock_code) DESC
    LIMIT 300
  `;
  const topics = aggRows.map((r) => r.normalized_fragment);

  // 队列为空直接返回（IN () 非法 SQL，需短路）
  if (topics.length === 0) {
    return json({ queue: [], footer: { total: 0, unhandled: 0 }, snapshotId: snap });
  }

  // 2) 每个热点取 3 条最近原始片段样本
  const sampleRows = await sql<{
    normalized_fragment: string;
    raw_fragment: string;
    trade_date: string;
    stock_code: string;
  }[]>`
    SELECT normalized_fragment, raw_fragment, trade_date::text, stock_code
    FROM (
      SELECT rf.normalized_fragment, rf.raw_fragment, rf.trade_date, rf.stock_code,
             row_number() OVER (PARTITION BY rf.normalized_fragment ORDER BY rf.trade_date DESC, rf.fragment_ordinal) AS rn
      FROM research.reason_fragment rf
      WHERE rf.source_snapshot_id = ${snap}
        AND rf.normalized_fragment = ANY(${topics})
    ) t
    WHERE rn <= 3
    ORDER BY normalized_fragment, rn
  `;

  // 3) 原始片段 → 标准化主题投票（经观察-主题关联）
  const voteRows = await sql<{
    normalized_fragment: string;
    theme_id: string;
    theme_name: string;
    theme_type: string | null;
    stock_votes: string;
    has_confirmed: boolean;
  }[]>`
    SELECT f.normalized_fragment, ot.theme_id, t.theme_name, t.theme_type,
           count(DISTINCT f.stock_code)::text AS stock_votes,
           bool_or(ot.mapping_status = 'confirmed') AS has_confirmed
    FROM research.reason_fragment f
    JOIN research.observation_theme ot
      ON ot.source_snapshot_id = f.source_snapshot_id
     AND ot.trade_date = f.trade_date
     AND ot.stock_code = f.stock_code
    JOIN research.theme t ON t.theme_id = ot.theme_id
    WHERE f.source_snapshot_id = ${snap} AND f.normalized_fragment = ANY(${topics})
    GROUP BY f.normalized_fragment, ot.theme_id, t.theme_name, t.theme_type
  `;
  const themeVotes = new Map<string, (typeof voteRows)[number][]>();
  for (const v of voteRows) {
    const list = themeVotes.get(v.normalized_fragment) ?? [];
    list.push(v);
    themeVotes.set(v.normalized_fragment, list);
  }

  // 4) 关联主题的全部 Episode（按 last_seen 匹配活跃期，未覆盖则取最近一期）
  const themeIds = [...new Set(voteRows.map((v) => v.theme_id))];
  let epRows: {
    episode_id: string;
    theme_id: string;
    status: string;
    start_date: string;
    end_date: string;
    peak_obs_count: number | null;
    total_stock_count: number | null;
  }[] = [];
  if (themeIds.length > 0) {
    epRows = await sql<{
      episode_id: string;
      theme_id: string;
      status: string;
      start_date: string;
      end_date: string;
      peak_obs_count: number | null;
      total_stock_count: number | null;
    }[]>`
      SELECT e.episode_id::text, e.theme_id::text, e.status::text,
             e.start_date::text, e.end_date::text, e.peak_obs_count, e.total_stock_count
      FROM research.theme_episode e
      WHERE e.theme_id = ANY(${themeIds})
      ORDER BY e.start_date DESC
    `;
  }

  // 5) Agent 状态推导（cases + discovery_action）
  const [caseRefs, skipKeys] = await Promise.all([loadCaseRefs(), loadSkipKeys()]);

  // 先按 fragment 构建中间行，再按 topicId 聚合（多个 fragment 可能映射到同一 theme）
  const fragmentRows = aggRows.map((r) => {
    const fragment = r.normalized_fragment;
    const votes = themeVotes.get(fragment) ?? [];
    // 取股票数最多的主题作为标准化映射
    const best = votes.reduce<typeof votes[number] | null>(
      (acc, v) => (!acc || Number(v.stock_votes) > Number(acc.stock_votes) ? v : acc),
      null
    );
    const topicKeys = best ? [fragment, best.theme_name] : [fragment];
    const { agentStatus, candidateCase } = deriveAgentStatus(
      topicKeys,
      caseRefs,
      skipKeys.has(fragment) || (best ? skipKeys.has(best.theme_name) : false)
    );

    // Episode：优先取覆盖 last_seen 的活跃期，否则取该主题最近一期
    let episodeRow: (typeof epRows)[number] | null = null;
    if (best) {
      const list = epRows.filter((e) => e.theme_id === best.theme_id);
      episodeRow =
        list.find((e) => e.start_date <= r.last_seen && e.end_date >= r.last_seen) ?? list[0] ?? null;
    }

    return {
      fragment,
      topicId: best ? `t:${best.theme_id}` : `f:${fragment}`,
      rawTopic: fragment,
      theme: best
        ? {
            themeId: best.theme_id,
            themeName: best.theme_name,
            themeType: best.theme_type,
            mapping: best.has_confirmed ? "confirmed" : "candidate",
          }
        : null,
      rawSamples: sampleRows
        .filter((s) => s.normalized_fragment === fragment)
        .slice(0, 3)
        .map((s) => ({ rawFragment: s.raw_fragment, date: s.trade_date, stockCode: s.stock_code })),
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      stockCount: num(r.stock_count) ?? 0,
      fragmentCount: num(r.fragment_count) ?? 0,
      episode: episodeRow
        ? {
            episodeId: episodeRow.episode_id,
            status: episodeRow.status,
            startDate: episodeRow.start_date,
            endDate: episodeRow.end_date,
            peakObsCount: episodeRow.peak_obs_count,
            totalStockCount: episodeRow.total_stock_count,
          }
        : null,
      agentStatus,
      candidateCase,
    };
  });

  // 按 topicId 聚合（多个 normalized_fragment 可能映射到同一 theme_id）
  const topicMap = new Map<string, typeof fragmentRows[number]>();
  for (const row of fragmentRows) {
    const existing = topicMap.get(row.topicId);
    if (!existing) {
      topicMap.set(row.topicId, row);
    } else {
      // 合并：取更早的 firstSeen、更晚的 lastSeen、更大的 stockCount、累加 fragmentCount
      existing.firstSeen = existing.firstSeen < row.firstSeen ? existing.firstSeen : row.firstSeen;
      existing.lastSeen = existing.lastSeen > row.lastSeen ? existing.lastSeen : row.lastSeen;
      existing.stockCount = Math.max(existing.stockCount, row.stockCount);
      existing.fragmentCount += row.fragmentCount;
      // 合并 rawSamples（去重，最多保留 3 个不同的 rawFragment）
      const sampleSet = new Set(existing.rawSamples.map((s) => s.rawFragment));
      for (const s of row.rawSamples) {
        if (!sampleSet.has(s.rawFragment) && existing.rawSamples.length < 3) {
          existing.rawSamples.push(s);
          sampleSet.add(s.rawFragment);
        }
      }
      // Episode：保留覆盖 lastSeen 的那个
      if (row.episode && existing.lastSeen >= row.episode.startDate && existing.lastSeen <= row.episode.endDate) {
        existing.episode = row.episode;
      }
    }
  }
  const queue = Array.from(topicMap.values());

  return json({
    queue,
    footer: {
      total: queue.length,
      unhandled: queue.filter((q) => q.agentStatus === "unhandled").length,
    },
    snapshotId: snap,
  });
}

// ---------- GET /api/discovery/theme/:topicId ----------

async function themeDetail(topicId: string): Promise<Response> {
  const snap = await latestSnapshotId();
  if (!snap) return json({ error: "无可用数据快照" }, 503);
  const { type, key } = parseTopicId(topicId);

  // 标准化主题详情
  if (type === "theme") {
    const themeRows = await sql<{
      theme_id: string;
      theme_name: string;
      theme_type: string | null;
      parent_theme_id: string | null;
      definition: string | null;
      status: string | null;
      taxonomy_version: string | null;
    }[]>`
      SELECT theme_id, theme_name, theme_type, parent_theme_id, definition, status, taxonomy_version
      FROM research.theme
      WHERE theme_id = ${key}
    `;
    const theme = themeRows[0];
    if (!theme) return json({ error: `主题不存在：${key}` }, 404);

    // 别名映射链：原始片段 → theme_alias.alias_text → 标准化主题（含 mapping_method 注记）
    const aliasRows = await sql<{
      alias_text: string;
      mapping_method: string | null;
      review_status: string | null;
    }[]>`
      SELECT alias_text, mapping_method, review_status
      FROM research.theme_alias
      WHERE theme_id = ${key}
      ORDER BY review_status NULLS LAST, alias_text
      LIMIT 20
    `;

    const epRows = await sql<{
      episode_id: string;
      status: string;
      start_date: string;
      end_date: string;
      duration_days: number | null;
      peak_date: string | null;
      peak_obs_count: number | null;
      total_obs_count: number | null;
      total_stock_count: number | null;
      active_days: number | null;
      intermittent_days: number | null;
    }[]>`
      SELECT e.episode_id::text, e.status::text, e.start_date::text, e.end_date::text,
             e.duration_days, e.peak_date::text, e.peak_obs_count,
             e.total_obs_count, e.total_stock_count, e.active_days, e.intermittent_days
      FROM research.theme_episode e
      WHERE e.theme_id = ${key}
      ORDER BY e.start_date DESC
    `;

    // 相关股票（最新 snapshot 内该主题观察聚合）
    const stockRows = await sql<{
      stock_code: string;
      display_name: string | null;
      obs_count: string;
      first_seen: string;
      last_seen: string;
    }[]>`
      SELECT ot.stock_code, s.display_name,
             count(*)::text AS obs_count,
             min(ot.trade_date)::text AS first_seen,
             max(ot.trade_date)::text AS last_seen
      FROM research.observation_theme ot
      LEFT JOIN LATERAL (
        SELECT display_name FROM ju.stocks js
        WHERE js.stock_code = ot.stock_code
          AND js.start_date <= ot.trade_date
          AND (js.end_date IS NULL OR js.end_date >= ot.trade_date)
        LIMIT 1
      ) s ON true
      WHERE ot.theme_id = ${key} AND ot.source_snapshot_id = ${snap}
      GROUP BY ot.stock_code, s.display_name
      ORDER BY max(ot.trade_date) DESC, count(*) DESC
      LIMIT 50
    `;

    // 原始片段样本（该主题观察对应的 reason_fragment，最近 10 条）
    const fragRows = await sql<{
      raw_fragment: string;
      normalized_fragment: string;
      trade_date: string;
      stock_code: string;
      display_name: string | null;
    }[]>`
      SELECT rf.raw_fragment, rf.normalized_fragment, rf.trade_date::text, rf.stock_code, s.display_name
      FROM research.observation_theme ot
      JOIN research.reason_fragment rf
        ON rf.source_snapshot_id = ot.source_snapshot_id
       AND rf.trade_date = ot.trade_date
       AND rf.stock_code = ot.stock_code
      LEFT JOIN LATERAL (
        SELECT display_name FROM ju.stocks js
        WHERE js.stock_code = ot.stock_code
          AND js.start_date <= ot.trade_date
          AND (js.end_date IS NULL OR js.end_date >= ot.trade_date)
        LIMIT 1
      ) s ON true
      WHERE ot.theme_id = ${key} AND ot.source_snapshot_id = ${snap}
      ORDER BY rf.trade_date DESC, rf.fragment_ordinal
      LIMIT 10
    `;

    // 人类校准记录
    const actions = await sql<{ action: string; reason: string | null; note: string | null; created_at: string }[]>`
      SELECT action, reason, note, created_at::text
      FROM cases.discovery_action
      WHERE subject_type = 'theme' AND subject_key = ${key}
      ORDER BY created_at DESC
      LIMIT 5
    `;

    return json({
      topicId: `t:${key}`,
      theme: {
        themeId: theme.theme_id,
        themeName: theme.theme_name,
        themeType: theme.theme_type,
        parentThemeId: theme.parent_theme_id,
        definition: theme.definition,
        status: theme.status,
        taxonomyVersion: theme.taxonomy_version,
      },
      episodes: epRows.map((e) => ({
        episodeId: e.episode_id,
        status: e.status,
        startDate: e.start_date,
        endDate: e.end_date,
        durationDays: e.duration_days,
        peakDate: e.peak_date,
        peakObsCount: e.peak_obs_count,
        totalObsCount: e.total_obs_count,
        totalStockCount: e.total_stock_count,
        activeDays: e.active_days,
        intermittentDays: e.intermittent_days,
      })),
      stocks: stockRows.map((s) => ({
        stockCode: s.stock_code,
        name: s.display_name,
        obsCount: num(s.obs_count) ?? 0,
        firstSeen: s.first_seen,
        lastSeen: s.last_seen,
      })),
      aliases: aliasRows.map((a) => ({
        aliasText: a.alias_text,
        mappingMethod: a.mapping_method,
        reviewStatus: a.review_status,
      })),
      fragmentSamples: fragRows.map((f) => ({
        rawFragment: f.raw_fragment,
        normalizedFragment: f.normalized_fragment,
        date: f.trade_date,
        stockCode: f.stock_code,
        name: f.display_name,
      })),
      actions: actions.map((a) => ({ action: a.action, reason: a.reason, note: a.note, createdAt: a.created_at })),
    });
  }

  // 未映射原始片段详情（fragment 分支）
  const aggRows = await sql<{ first_seen: string; last_seen: string; stock_count: string; fragment_count: string }[]>`
    SELECT min(trade_date)::text AS first_seen, max(trade_date)::text AS last_seen,
           count(DISTINCT stock_code)::text AS stock_count, count(*)::text AS fragment_count
    FROM research.reason_fragment
    WHERE source_snapshot_id = ${snap} AND normalized_fragment = ${key}
  `;
  const agg = aggRows[0];
  if (!agg) return json({ error: `热点片段不存在：${key}` }, 404);

  const fragRows = await sql<{
    raw_fragment: string;
    trade_date: string;
    stock_code: string;
    display_name: string | null;
  }[]>`
    SELECT rf.raw_fragment, rf.trade_date::text, rf.stock_code, s.display_name
    FROM research.reason_fragment rf
    LEFT JOIN LATERAL (
      SELECT display_name FROM ju.stocks js
      WHERE js.stock_code = rf.stock_code
        AND js.start_date <= rf.trade_date
        AND (js.end_date IS NULL OR js.end_date >= rf.trade_date)
      LIMIT 1
    ) s ON true
    WHERE rf.source_snapshot_id = ${snap} AND rf.normalized_fragment = ${key}
    ORDER BY rf.trade_date DESC, rf.fragment_ordinal
    LIMIT 10
  `;

  const actions = await sql<{ action: string; reason: string | null; note: string | null; created_at: string }[]>`
    SELECT action, reason, note, created_at::text
    FROM cases.discovery_action
    WHERE subject_type = 'fragment' AND subject_key = ${key}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  return json({
    topicId: `f:${key}`,
    theme: null,
    fragment: key,
    stats: {
      firstSeen: agg.first_seen,
      lastSeen: agg.last_seen,
      stockCount: num(agg.stock_count) ?? 0,
      fragmentCount: num(agg.fragment_count) ?? 0,
    },
    fragmentSamples: fragRows.map((f) => ({
      rawFragment: f.raw_fragment,
      normalizedFragment: key,
      date: f.trade_date,
      stockCode: f.stock_code,
      name: f.display_name,
    })),
    actions: actions.map((a) => ({ action: a.action, reason: a.reason, note: a.note, createdAt: a.created_at })),
  });
}

// ---------- POST /api/discovery/:topicId/skip ----------

async function skipTopic(topicId: string, req: Request): Promise<Response> {
  const { type, key } = parseTopicId(topicId);
  let body: { reason?: string; note?: string; undo?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  if (body.undo) {
    // 撤销：删除该主题最近一次 skip 记录
    await sql`
      DELETE FROM cases.discovery_action
      WHERE action_id IN (
        SELECT action_id FROM cases.discovery_action
        WHERE subject_type = ${type} AND subject_key = ${key} AND action = 'skip'
        ORDER BY created_at DESC LIMIT 1
      )
    `;
    // 补一条 restore 记录（审计）
    await sql`
      INSERT INTO cases.discovery_action (action_id, subject_type, subject_key, action, reason, note)
      VALUES (${"DA-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)},
              ${type}, ${key}, 'restore', null, ${body.note ?? null})
    `;
    return json({ topicId, agentStatus: "unhandled" });
  }

  const reason = (body.reason ?? "").trim();
  if (!reason) return json({ error: "标记不研究必须填写原因" }, 400);
  const allowed = ["热度不足", "已研究过", "超出能力范围", "其他"];
  if (!allowed.includes(reason)) return json({ error: `原因必须是：${allowed.join(" / ")}` }, 400);

  const actionId = "DA-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  await sql`
    INSERT INTO cases.discovery_action (action_id, subject_type, subject_key, action, reason, note)
    VALUES (${actionId}, ${type}, ${key}, 'skip', ${reason}, ${body.note ?? null})
  `;
  return json({ topicId, actionId, agentStatus: "skipped" }, 201);
}

// ---------- POST /api/discovery/:topicId/prepare ----------

async function prepareCase(topicId: string, req: Request): Promise<Response> {
  const { type, key } = parseTopicId(topicId);
  let body: { researchQuestion?: string; researchTimeT?: string; infoCutoff?: string; note?: string; episodeRef?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  // 必填校验
  const question = (body.researchQuestion ?? "").trim();
  if (!question) return json({ error: "研究问题为必填项" }, 400);
  if (!body.researchTimeT || !body.infoCutoff) {
    return json({ error: "T 时点与信息截止均为必填项" }, 400);
  }
  const t = new Date(body.researchTimeT);
  const cutoff = new Date(body.infoCutoff);
  if (Number.isNaN(t.getTime())) return json({ error: "T 时点格式无效" }, 400);
  if (Number.isNaN(cutoff.getTime())) return json({ error: "信息截止格式无效" }, 400);
  if (cutoff.getTime() > t.getTime()) {
    return json({ error: "信息截止必须早于或等于 T 时点" }, 400);
  }
  // 校验后提取为 const：postgres 模板参数不接受 string | undefined
  const researchTimeT: string = body.researchTimeT;
  const infoCutoff: string = body.infoCutoff;

  // 主题名（用于 trigger 引用与 case.themes）
  let themeName: string | null = null;
  let themeId: string | null = null;
  if (type === "theme") {
    themeId = key;
    const rows = await sql<{ theme_name: string }[]>`
      SELECT theme_name FROM research.theme WHERE theme_id = ${key}
    `;
    themeName = rows[0]?.theme_name ?? null;
  }

  // 防重复：同一热点（主题/片段键）已有非终态候选即拒绝
  const dup = await sql<{ case_id: string }[]>`
    SELECT case_id FROM cases."case"
    WHERE status NOT IN ('rejected', 'blocked')
      AND trigger_discovery_ref->>'subjectKey' = ${key}
    LIMIT 1
  `;
  if (dup.length > 0) {
    return json(
      { error: `该热点已存在候选 Case ${dup[0].case_id}`, existingCaseId: dup[0].case_id },
      409
    );
  }

  // 生成 C- 序号（fixture 的 C-F 前缀不参与数字序列）
  const seq = await sql<{ n: string }[]>`
    SELECT coalesce(max(nullif(regexp_replace(case_id, '[^0-9]', '', 'g'), '')::bigint), 1000) + 1 AS n
    FROM cases."case"
    WHERE case_id ~ '^C-[0-9]+$'
  `;
  const caseId = `C-${seq[0].n}`;

  const refJson = sql.json({
    source: "discovery",
    subjectType: type,
    subjectKey: key,
    themeId: themeId,
    themeName: themeName,
    episodeRef: typeof body.episodeRef === "string" && body.episodeRef !== "" ? body.episodeRef : null,
  });

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO cases."case"
        (case_id, title, research_question, research_time_t, info_cutoff, status,
         trigger_discovery_ref, episode_refs, themes, is_fixture)
      VALUES (${caseId}, ${question.slice(0, 60)}, ${question},
              ${researchTimeT}, ${infoCutoff}, 'candidate',
              ${refJson}, ${[] as string[]},
              ${themeName ? [themeName] : []}, false)
    `;
    await tx`
      INSERT INTO cases.case_revision
        (revision_id, case_id, revision_no, input_manifest, judgment, status, created_by)
      VALUES (${`${caseId}-R1`}, ${caseId}, 1,
              ${sql.json({ source: "discovery", subjectKey: key, note: body.note ?? null })},
              ${sql.json({ hypotheses: [], conclusion: null, counterarguments: [], counter_evidence: [], open_questions: [], applicability: "" })},
              'draft', 'agent')
    `;
  });

  return json(
    {
      caseId,
      status: "candidate",
      topicId,
      warning: question.length < 15 ? "研究问题少于 15 字，建议补充具体化" : null,
    },
    201
  );
}

// ---------- 路由分发 ----------

export async function routeDiscovery(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/api/discovery/queue" && req.method === "GET") return discoveryQueue();
  const theme = /^\/api\/discovery\/theme\/(.+)$/.exec(path);
  if (theme && req.method === "GET") return themeDetail(decodeURIComponent(theme[1]));
  const skip = /^\/api\/discovery\/(.+)\/skip$/.exec(path);
  if (skip && req.method === "POST") return skipTopic(decodeURIComponent(skip[1]), req);
  const prep = /^\/api\/discovery\/(.+)\/prepare$/.exec(path);
  if (prep && req.method === "POST") return prepareCase(decodeURIComponent(prep[1]), req);
  return undefined;
}
