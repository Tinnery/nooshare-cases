// web/src/server/api/cases.ts
// Cases / Review / Runs / Search API（FIXTURE 域为主；列表按 is_fixture 支持双子视图）。
// 路由：GET /api/cases · GET /api/cases/:id · POST /api/cases/:id/review ·
//       POST /api/cases/:id/observations · GET /api/runs · GET /api/runs/:id · GET /api/search?q=
import { sql, num } from "../db";

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// 动态 WHERE 片段类型（sql 模板返回值）
type Frag = ReturnType<typeof sql>;

const OUTCOMES = ["support", "oppose", "mixed", "no_change", "indeterminate"] as const;
const DECISIONS = ["approve", "request_changes", "reject"] as const;

// 企业七类角色固定展示顺序
const ROLE_ORDER = [
  "seed",
  "directly_related",
  "similar",
  "potential_beneficiary",
  "non_responder",
  "counterexample",
  "excluded",
] as const;

const now = () => new Date().toISOString();
const genId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------- GET /api/cases?status=&theme=&q=&view= ----------

async function caseList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status"); // 逗号分隔多选
  const theme = url.searchParams.get("theme"); // 标准化主题名
  const q = url.searchParams.get("q"); // 标题 / 研究问题 / Case ID
  const view = url.searchParams.get("view"); // real | fixture（Cases 页双子视图）

  const conds: Frag[] = [];
  if (status) {
    const list = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) conds.push(sql`c.status = ANY(${list})`);
  }
  if (theme) conds.push(sql`${theme} = ANY(c.themes)`);
  if (q) {
    const like = `%${q}%`;
    conds.push(sql`(c.case_id ILIKE ${like} OR c.title ILIKE ${like} OR c.research_question ILIKE ${like})`);
  }
  if (view === "real") conds.push(sql`c.is_fixture = false`);
  if (view === "fixture") conds.push(sql`c.is_fixture = true`);
  const where = conds.length > 0
    ? sql` WHERE ${conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`))}`
    : sql``;

  const rows = await sql<{
    case_id: string;
    title: string;
    status: string;
    research_question: string;
    research_time_t: string;
    info_cutoff: string;
    themes: string[];
    episode_refs: string[];
    is_fixture: boolean;
    updated_at: string;
    created_at: string;
    revision_count: string;
    current_revision_no: string | null;
    reviewing_revision_id: string | null;
  }[]>`
    SELECT c.case_id, c.title, c.status, c.research_question,
           c.research_time_t::text, c.info_cutoff::text,
           c.themes, c.episode_refs, c.is_fixture,
           c.updated_at::text, c.created_at::text,
           (SELECT count(*) FROM cases.case_revision r WHERE r.case_id = c.case_id)::text AS revision_count,
           (SELECT max(r.revision_no) FROM cases.case_revision r WHERE r.case_id = c.case_id)::text AS current_revision_no,
           (SELECT r.revision_id FROM cases.case_revision r
             WHERE r.case_id = c.case_id AND r.status = 'reviewing' LIMIT 1) AS reviewing_revision_id
    FROM cases."case" c${where}
    ORDER BY c.updated_at DESC
  `;

  return json({
    cases: rows.map((r) => ({
      caseId: r.case_id,
      title: r.title,
      status: r.status,
      researchQuestion: r.research_question,
      researchTimeT: r.research_time_t,
      infoCutoff: r.info_cutoff,
      themes: r.themes,
      episodeRefs: r.episode_refs,
      isFixture: r.is_fixture,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
      revisionCount: num(r.revision_count) ?? 0,
      currentRevisionNo: r.current_revision_no == null ? null : num(r.current_revision_no),
      reviewingRevisionId: r.reviewing_revision_id,
    })),
    footer: {
      total: rows.length,
      reviewing: rows.filter((r) => r.status === "reviewing").length,
    },
  });
}

// ---------- GET /api/cases/:id ----------

async function caseDetail(caseId: string): Promise<Response> {
  const caseRows = await sql<{
    case_id: string;
    title: string;
    research_question: string;
    research_time_t: string;
    info_cutoff: string;
    status: string;
    trigger_discovery_ref: Record<string, unknown> | null;
    episode_refs: string[];
    themes: string[];
    is_fixture: boolean;
    created_at: string;
    updated_at: string;
  }[]>`
    SELECT case_id, title, research_question, research_time_t::text, info_cutoff::text,
           status, trigger_discovery_ref, episode_refs, themes, is_fixture,
           created_at::text, updated_at::text
    FROM cases."case"
    WHERE case_id = ${caseId}
  `;
  const c = caseRows[0];
  if (!c) return json({ error: `Case 不存在：${caseId}` }, 404);

  const revisions = await sql<{
    revision_id: string;
    revision_no: number;
    input_manifest: Record<string, unknown>;
    judgment: Record<string, unknown>;
    status: string;
    frozen_at: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
  }[]>`
    SELECT revision_id, revision_no, input_manifest, judgment, status,
           frozen_at::text, created_by, created_at::text, updated_at::text
    FROM cases.case_revision
    WHERE case_id = ${caseId}
    ORDER BY revision_no
  `;

  const companies = await sql<{
    stock_code: string;
    company_name: string;
    role: string;
    rationale: string;
    evidence_refs: string[];
    market_response_status: string | null;
  }[]>`
    SELECT stock_code, company_name, role, rationale, evidence_refs, market_response_status
    FROM cases.company_participation
    WHERE case_id = ${caseId}
  `;
  // 按七类角色固定顺序输出
  companies.sort((a, b) => ROLE_ORDER.indexOf(a.role as typeof ROLE_ORDER[number]) - ROLE_ORDER.indexOf(b.role as typeof ROLE_ORDER[number]));

  const evidence = await sql<{
    evidence_id: string;
    revision_id: string | null;
    upstream_type: string;
    upstream_id: string;
    version_ref: string | null;
    locator: string;
    summary: string;
    published_at: string | null;
    availability_at: string | null;
    pit_status: string;
    pit_note: string | null;
  }[]>`
    SELECT evidence_id, revision_id, upstream_type, upstream_id, version_ref,
           locator, summary, published_at::text, availability_at::text,
           pit_status, pit_note
    FROM cases.evidence_reference
    WHERE case_id = ${caseId}
    ORDER BY created_at
  `;

  const reviews = await sql<{
    review_id: string;
    revision_id: string;
    decision: string;
    reason: string;
    categories: string[];
    reviewer: string;
    reviewed_at: string;
  }[]>`
    SELECT review_id, revision_id, decision, reason, categories, reviewer, reviewed_at::text
    FROM cases.review_record
    WHERE case_id = ${caseId}
    ORDER BY reviewed_at DESC
  `;

  const observations = await sql<{
    observation_id: string;
    revision_id: string | null;
    window_start: string;
    window_end: string;
    outcome: string;
    content: string;
    refs: unknown[];
    created_at: string;
  }[]>`
    SELECT observation_id, revision_id, window_start::text, window_end::text,
           outcome, content, refs, created_at::text
    FROM cases.observation
    WHERE case_id = ${caseId}
    ORDER BY window_start DESC
  `;

  return json({
    case: {
      caseId: c.case_id,
      title: c.title,
      researchQuestion: c.research_question,
      researchTimeT: c.research_time_t,
      infoCutoff: c.info_cutoff,
      status: c.status,
      triggerDiscoveryRef: c.trigger_discovery_ref,
      episodeRefs: c.episode_refs,
      themes: c.themes,
      isFixture: c.is_fixture,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    },
    revisions: revisions.map((r) => ({
      revisionId: r.revision_id,
      revisionNo: r.revision_no,
      inputManifest: r.input_manifest,
      judgment: r.judgment,
      status: r.status,
      frozenAt: r.frozen_at,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    companies: companies.map((p) => ({
      stockCode: p.stock_code,
      companyName: p.company_name,
      role: p.role,
      rationale: p.rationale,
      evidenceRefs: p.evidence_refs,
      marketResponseStatus: p.market_response_status,
    })),
    evidence: evidence.map((e) => ({
      evidenceId: e.evidence_id,
      revisionId: e.revision_id,
      upstreamType: e.upstream_type,
      upstreamId: e.upstream_id,
      versionRef: e.version_ref,
      locator: e.locator,
      summary: e.summary,
      publishedAt: e.published_at,
      availabilityAt: e.availability_at,
      pitStatus: e.pit_status,
      pitNote: e.pit_note,
    })),
    reviews: reviews.map((r) => ({
      reviewId: r.review_id,
      revisionId: r.revision_id,
      decision: r.decision,
      reason: r.reason,
      categories: r.categories,
      reviewer: r.reviewer,
      reviewedAt: r.reviewed_at,
    })),
    observations: observations.map((o) => ({
      observationId: o.observation_id,
      revisionId: o.revision_id,
      windowStart: o.window_start,
      windowEnd: o.window_end,
      outcome: o.outcome,
      content: o.content,
      refs: o.refs,
      createdAt: o.created_at,
    })),
  });
}

// ---------- POST /api/cases/:id/review ----------
// approve → 冻结 revision（此后 UPDATE 被 API 与 DB trigger 双重拒绝）+ case 置 frozen
// request_changes → revision 回 draft + case 回 researching
// reject → case 置 rejected（终态）

async function postReview(caseId: string, req: Request): Promise<Response> {
  let body: { decision?: string; reason?: string; categories?: string[]; revisionId?: string; reviewer?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  const decision = body.decision ?? "";
  if (!DECISIONS.includes(decision as typeof DECISIONS[number])) {
    return json({ error: "decision 必须是 approve / request_changes / reject" }, 400);
  }
  const reason = (body.reason ?? "").trim();
  // approve 允许无备注（模态中的可选备注）；request_changes / reject 必填
  if (decision !== "approve" && !reason) {
    return json({ error: decision === "reject" ? "拒绝原因为必填项" : "修改意见为必填项" }, 400);
  }

  const caseRows = await sql<{ status: string }[]>`
    SELECT status FROM cases."case" WHERE case_id = ${caseId}
  `;
  const c = caseRows[0];
  if (!c) return json({ error: `Case 不存在：${caseId}` }, 404);
  if (c.status !== "reviewing") {
    return json({ error: `Case 当前状态为 ${c.status}，仅 Reviewing 状态可执行审核操作` }, 409);
  }

  // 目标 revision：显式指定或当前 reviewing 的最新版
  const revId = body.revisionId;
  const revRows = revId
    ? await sql<{ revision_id: string; frozen_at: string | null; status: string }[]>`
        SELECT revision_id, frozen_at::text, status FROM cases.case_revision
        WHERE case_id = ${caseId} AND revision_id = ${revId}
      `
    : await sql<{ revision_id: string; frozen_at: string | null; status: string }[]>`
        SELECT revision_id, frozen_at::text, status FROM cases.case_revision
        WHERE case_id = ${caseId} AND status = 'reviewing'
        ORDER BY revision_no DESC LIMIT 1
      `;
  const rev = revRows[0];
  if (!rev) return json({ error: "无可审核的 Revision（未找到 reviewing 状态版本）" }, 404);

  const reviewId = genId("RV");
  const reviewer = body.reviewer ?? "human";
  const categories = Array.isArray(body.categories) ? body.categories : [];

  if (decision === "approve") {
    // 应用层防线：已冻结的 revision 拒绝再次变更（DB trigger 兜底）
    if (rev.frozen_at) return json({ error: `Revision ${rev.revision_id} 已冻结，不可变更` }, 409);
    await sql.begin(async (tx) => {
      const upd = await tx`
        UPDATE cases.case_revision
        SET status = 'frozen', frozen_at = now(), updated_at = now()
        WHERE revision_id = ${rev.revision_id} AND frozen_at IS NULL
        RETURNING revision_id
      `;
      if (upd.length === 0) {
        throw new Error(`Revision ${rev.revision_id} 已冻结，不可变更`);
      }
      await tx`
        INSERT INTO cases.review_record
          (review_id, case_id, revision_id, decision, reason, categories, reviewer)
        VALUES (${reviewId}, ${caseId}, ${rev.revision_id}, 'approve', ${reason}, ${categories}, ${reviewer})
      `;
      await tx`
        UPDATE cases."case" SET status = 'frozen', updated_at = now() WHERE case_id = ${caseId}
      `;
    });
    return json({
      caseId,
      revisionId: rev.revision_id,
      decision,
      caseStatus: "frozen",
      reviewId,
      note: "Revision 已冻结；此后对该 Revision 的 UPDATE 将被拒绝，仅可追加 Observation",
    });
  }

  if (decision === "request_changes") {
    await sql.begin(async (tx) => {
      await tx`
        UPDATE cases.case_revision SET status = 'draft', updated_at = now()
        WHERE revision_id = ${rev.revision_id} AND frozen_at IS NULL
      `;
      await tx`
        INSERT INTO cases.review_record
          (review_id, case_id, revision_id, decision, reason, categories, reviewer)
        VALUES (${reviewId}, ${caseId}, ${rev.revision_id}, 'request_changes', ${reason}, ${categories}, ${reviewer})
      `;
      await tx`
        UPDATE cases."case" SET status = 'researching', updated_at = now() WHERE case_id = ${caseId}
      `;
    });
    return json({ caseId, revisionId: rev.revision_id, decision, caseStatus: "researching", reviewId });
  }

  // reject（终态；原因保留于审核记录，供 Discovery 行与 Versions 展示）
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO cases.review_record
        (review_id, case_id, revision_id, decision, reason, categories, reviewer)
      VALUES (${reviewId}, ${caseId}, ${rev.revision_id}, 'reject', ${reason}, ${categories}, ${reviewer})
    `;
    await tx`
      UPDATE cases."case" SET status = 'rejected', updated_at = now() WHERE case_id = ${caseId}
    `;
  });
  return json({ caseId, revisionId: rev.revision_id, decision, caseStatus: "rejected", reviewId });
}

// ---------- POST /api/cases/:id/observations ----------
// 仅 frozen / observing 状态允许追加（Phase 2 §4.2 操作矩阵）；首个观察将 frozen 推进为 observing

async function postObservation(caseId: string, req: Request): Promise<Response> {
  let body: { windowStart?: string; windowEnd?: string; outcome?: string; content?: string; refs?: unknown[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "请求体必须是 JSON" }, 400);
  }

  const caseRows = await sql<{ status: string }[]>`
    SELECT status FROM cases."case" WHERE case_id = ${caseId}
  `;
  const c = caseRows[0];
  if (!c) return json({ error: `Case 不存在：${caseId}` }, 404);
  if (c.status !== "frozen" && c.status !== "observing") {
    return json({ error: `Case 当前状态为 ${c.status}，仅 Frozen / Observing 状态可追加 Observation` }, 409);
  }

  const content = (body.content ?? "").trim();
  if (!content) return json({ error: "观察内容为必填项" }, 400);
  const outcome = body.outcome ?? "";
  if (!OUTCOMES.includes(outcome as typeof OUTCOMES[number])) {
    return json({ error: "outcome 必须是 support / oppose / mixed / no_change / indeterminate" }, 400);
  }
  if (!body.windowStart || !body.windowEnd) {
    return json({ error: "观察窗口起止时间为必填项" }, 400);
  }
  const ws = new Date(body.windowStart);
  const we = new Date(body.windowEnd);
  if (Number.isNaN(ws.getTime()) || Number.isNaN(we.getTime()) || we.getTime() < ws.getTime()) {
    return json({ error: "观察窗口无效（结束不得早于开始）" }, 400);
  }

  const observationId = genId("OB");
  const windowStart = body.windowStart as string;
  const windowEnd = body.windowEnd as string;
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO cases.observation
        (observation_id, case_id, window_start, window_end, outcome, content, refs)
      VALUES (${observationId}, ${caseId}, ${windowStart}, ${windowEnd}, ${outcome}, ${content},
              ${sql.json(Array.isArray(body.refs) ? body.refs : [])})
    `;
    // Frozen → Observing（追加首个观察即进入观察期）
    if (c.status === "frozen") {
      await tx`
        UPDATE cases."case" SET status = 'observing', updated_at = now() WHERE case_id = ${caseId}
      `;
    } else {
      await tx`
        UPDATE cases."case" SET updated_at = now() WHERE case_id = ${caseId}
      `;
    }
  });

  return json(
    {
      observationId,
      caseId,
      caseStatus: c.status === "frozen" ? "observing" : c.status,
      createdAt: now(),
    },
    201
  );
}

// ---------- GET /api/runs?status= ----------

async function runList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const conds: Frag[] = [];
  if (status) conds.push(sql`status = ${status}`);
  const where = conds.length > 0
    ? sql` WHERE ${conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} AND ${c}`))}`
    : sql``;

  const rows = await sql<{
    run_id: string;
    run_type: string;
    date_scope: Record<string, unknown>;
    stage: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    processed_count: number;
    success_count: number;
    failed_count: number;
    error: string | null;
    retryable: boolean;
  }[]>`
    SELECT run_id, run_type, date_scope, stage, status,
           started_at::text, finished_at::text,
           processed_count, success_count, failed_count, error, retryable
    FROM cases.agent_run${where}
    ORDER BY started_at DESC
  `;

  return json({
    runs: rows.map((r) => ({
      runId: r.run_id,
      runType: r.run_type,
      dateScope: r.date_scope,
      stage: r.stage,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      processedCount: r.processed_count,
      successCount: r.success_count,
      failedCount: r.failed_count,
      error: r.error,
      retryable: r.retryable,
    })),
    footer: {
      total: rows.length,
      running: rows.filter((r) => r.status === "running").length,
      failed: rows.filter((r) => r.status === "failed").length,
    },
  });
}

async function runDetail(runId: string): Promise<Response> {
  const rows = await sql<{
    run_id: string;
    run_type: string;
    date_scope: Record<string, unknown>;
    stage: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    processed_count: number;
    success_count: number;
    failed_count: number;
    outputs: Record<string, unknown>;
    error: string | null;
    retryable: boolean;
  }[]>`
    SELECT run_id, run_type, date_scope, stage, status,
           started_at::text, finished_at::text,
           processed_count, success_count, failed_count, outputs, error, retryable
    FROM cases.agent_run
    WHERE run_id = ${runId}
  `;
  const r = rows[0];
  if (!r) return json({ error: `Run 不存在：${runId}` }, 404);
  return json({
    run: {
      runId: r.run_id,
      runType: r.run_type,
      dateScope: r.date_scope,
      stage: r.stage,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      processedCount: r.processed_count,
      successCount: r.success_count,
      failedCount: r.failed_count,
      outputs: r.outputs,
      error: r.error,
      retryable: r.retryable,
    },
  });
}

// ---------- GET /api/search?q= ----------
// 四组：涨停观察（REAL）/ Episode（REAL）/ Case（含 FIXTURE）/ Run（FIXTURE），各 limit 5

async function search(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return json({ error: "搜索关键词为空" }, 400);
  const like = `%${q}%`;

  // ① 涨停观察：代码前缀匹配 + 股票名称匹配（名称先查 ju.stocks 再取各代码最新一条观察）
  const codeRows = await sql<{
    stock_code: string;
    display_name: string | null;
    trade_date: string;
    change_pct: string | null;
    source_snapshot_id: string;
  }[]>`
    SELECT DISTINCT ON (o.stock_code)
           o.stock_code, s.display_name, o.trade_date::text, o.change_pct::text, o.source_snapshot_id
    FROM research.market_limit_up_observation o
    LEFT JOIN LATERAL (
      SELECT display_name FROM ju.stocks js
      WHERE js.stock_code = o.stock_code
        AND js.start_date <= o.trade_date
        AND (js.end_date IS NULL OR js.end_date >= o.trade_date)
      LIMIT 1
    ) s ON true
    WHERE o.stock_code LIKE ${q + "%"}
    ORDER BY o.stock_code, o.trade_date DESC
    LIMIT 5
  `;
  const nameStocks = await sql<{ stock_code: string }[]>`
    SELECT stock_code FROM ju.stocks WHERE display_name ILIKE ${like} LIMIT 5
  `;
  let nameRows: { stock_code: string; display_name: string | null; trade_date: string; change_pct: string | null; source_snapshot_id: string }[] = [];
  if (nameStocks.length > 0) {
    const codes = nameStocks.map((r) => r.stock_code);
    nameRows = await sql<{
      stock_code: string;
      display_name: string | null;
      trade_date: string;
      change_pct: string | null;
      source_snapshot_id: string;
    }[]>`
      SELECT DISTINCT ON (o.stock_code)
             o.stock_code, s.display_name, o.trade_date::text, o.change_pct::text, o.source_snapshot_id
      FROM research.market_limit_up_observation o
      LEFT JOIN LATERAL (
        SELECT display_name FROM ju.stocks js
        WHERE js.stock_code = o.stock_code
          AND js.start_date <= o.trade_date
          AND (js.end_date IS NULL OR js.end_date >= o.trade_date)
        LIMIT 1
      ) s ON true
      WHERE o.stock_code = ANY(${codes})
      ORDER BY o.stock_code, o.trade_date DESC
      LIMIT 5
    `;
  }
  // 合并去重（代码命中优先），各取 5 条
  const seen = new Set<string>();
  const observations = [...codeRows, ...nameRows]
    .filter((r) => (seen.has(r.stock_code) ? false : (seen.add(r.stock_code), true)))
    .slice(0, 5)
    .map((r) => ({
      stockCode: r.stock_code,
      name: r.display_name,
      date: r.trade_date,
      changePct: num(r.change_pct),
      snapshotId: r.source_snapshot_id,
    }));

  // ② Episode：主题名 / Episode ID
  const epRows = await sql<{
    episode_id: string;
    theme_id: string;
    theme_name: string;
    status: string;
    start_date: string;
    end_date: string;
  }[]>`
    SELECT e.episode_id::text, e.theme_id::text, t.theme_name, e.status::text,
           e.start_date::text, e.end_date::text
    FROM research.theme_episode e
    JOIN research.theme t ON t.theme_id = e.theme_id
    WHERE t.theme_name ILIKE ${like} OR e.episode_id::text ILIKE ${q + "%"}
    ORDER BY e.start_date DESC
    LIMIT 5
  `;

  // ③ Case（含 FIXTURE；带 is_fixture 供前端子视图路由）
  const caseRows = await sql<{
    case_id: string;
    title: string;
    status: string;
    is_fixture: boolean;
  }[]>`
    SELECT case_id, title, status, is_fixture
    FROM cases."case"
    WHERE case_id ILIKE ${like} OR title ILIKE ${like} OR research_question ILIKE ${like}
    ORDER BY updated_at DESC
    LIMIT 5
  `;

  // ④ Run
  const runRows = await sql<{
    run_id: string;
    run_type: string;
    status: string;
    started_at: string;
  }[]>`
    SELECT run_id, run_type, status, started_at::text
    FROM cases.agent_run
    WHERE run_id ILIKE ${like} OR run_type ILIKE ${like} OR coalesce(error, '') ILIKE ${like}
    ORDER BY started_at DESC
    LIMIT 5
  `;

  return json({
    query: q,
    observations,
    episodes: epRows.map((e) => ({
      episodeId: e.episode_id,
      themeId: e.theme_id,
      themeName: e.theme_name,
      status: e.status,
      startDate: e.start_date,
      endDate: e.end_date,
    })),
    cases: caseRows.map((c) => ({
      caseId: c.case_id,
      title: c.title,
      status: c.status,
      isFixture: c.is_fixture,
    })),
    runs: runRows.map((r) => ({
      runId: r.run_id,
      runType: r.run_type,
      status: r.status,
      startedAt: r.started_at,
    })),
  });
}

// ---------- 路由分发 ----------

export async function routeCases(req: Request, path: string): Promise<Response | undefined> {
  if (path === "/api/cases" && req.method === "GET") return caseList(req);
  if (path === "/api/runs" && req.method === "GET") return runList(req);
  const detail = /^\/api\/cases\/([^/]+)$/.exec(path);
  if (detail && req.method === "GET") return caseDetail(decodeURIComponent(detail[1]));
  const review = /^\/api\/cases\/([^/]+)\/review$/.exec(path);
  if (review && req.method === "POST") return postReview(decodeURIComponent(review[1]), req);
  const obs = /^\/api\/cases\/([^/]+)\/observations$/.exec(path);
  if (obs && req.method === "POST") return postObservation(decodeURIComponent(obs[1]), req);
  const run = /^\/api\/runs\/([^/]+)$/.exec(path);
  if (run && req.method === "GET") return runDetail(decodeURIComponent(run[1]));
  if (path === "/api/search" && req.method === "GET") return search(req);
  return undefined;
}
