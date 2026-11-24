<!-- web/src/client/pages/CasesPage.svelte -->
<!-- Cases 列表页（Phase 2 §2.3，FIXTURE 域 + 双子视图）：
     「演示案例 FIXTURE」（默认，?view 缺省）/「真实候选 REAL」（?view=real，REAL DATA 描边徽章）。
     全局模式控件仍按域锁定恒 FIXTURE（子视图仅切换列表数据源 is_fixture 过滤，同一页面不混用两源）。
     flat table + 行 Drawer(720)：摘要 + 最近审核记录 + 进入完整工作区链接（Workspace 在批次 C）。
     REAL 子视图空态提供「前往 Discovery 准备 Case」引导。 -->
<script lang="ts">
  import { get } from "../lib/api";
  import { router, setQuery, navigate } from "../lib/router.svelte";
  import { episodeShort } from "../lib/format";
  import DataTable, { type TableColumn } from "../components/DataTable.svelte";
  import Drawer from "../components/Drawer.svelte";
  import StatusTag from "../components/StatusTag.svelte";

  // ---------- 类型 ----------
  interface CaseRow {
    caseId: string;
    title: string;
    status: string;
    researchQuestion: string;
    researchTimeT: string | null;
    infoCutoff: string | null;
    themes: string[];
    episodeRefs: string[];
    isFixture: boolean;
    updatedAt: string;
    createdAt: string;
    revisionCount: number;
    currentRevisionNo: number | null;
    reviewingRevisionId: string | null;
  }

  interface CaseListData {
    cases: CaseRow[];
    footer: { total: number; reviewing: number };
  }

  interface CaseDetail {
    case: {
      caseId: string;
      title: string;
      researchQuestion: string;
      researchTimeT: string | null;
      infoCutoff: string | null;
      status: string;
      triggerDiscoveryRef: Record<string, unknown> | null;
      episodeRefs: string[];
      themes: string[];
      isFixture: boolean;
      createdAt: string;
      updatedAt: string;
    };
    revisions: {
      revisionId: string;
      revisionNo: number;
      status: string;
      frozenAt: string | null;
      createdBy: string;
      createdAt: string;
      updatedAt: string;
    }[];
    companies: unknown[];
    evidence: unknown[];
    reviews: {
      reviewId: string;
      revisionId: string;
      decision: string;
      reason: string;
      categories: string[];
      reviewer: string;
      reviewedAt: string;
    }[];
    observations: unknown[];
  }

  // ---------- 视图状态（URL 单一数据源：?view=&status=&q=，effect 统一触发重载） ----------
  let view = $state<"fixture" | "real">("fixture");
  let statusFilter = $state("");
  let textQuery = $state("");

  let cases = $state<CaseRow[]>([]);
  let reviewingCount = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showSkeleton = $state(false);
  let skeletonTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadCases(v: "fixture" | "real", status: string, q: string): Promise<void> {
    loading = true;
    error = null;
    showSkeleton = false;
    if (skeletonTimer) clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (loading) showSkeleton = true;
    }, 400);
    const params = new URLSearchParams();
    params.set("view", v);
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    try {
      const data = await get<CaseListData>(`/api/cases?${params.toString()}`);
      cases = data.cases;
      reviewingCount = data.footer.reviewing;
    } catch (e) {
      error = e instanceof Error ? e.message : "加载 Case 列表失败";
    } finally {
      loading = false;
      if (skeletonTimer) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
      showSkeleton = false;
    }
  }

  // URL → 状态（切视图/筛选都走 setQuery，此 effect 依据 router.search 重载）
  $effect(() => {
    const params = new URLSearchParams(router.search);
    const v = params.get("view") === "real" ? "real" : "fixture";
    const st = params.get("status") ?? "";
    const q = params.get("q") ?? "";
    view = v;
    statusFilter = st;
    textQuery = q;
    loadCases(v, st, q);
  });

  // ---------- 子视图切换（清状态过滤，保持搜索） ----------
  function switchView(v: "fixture" | "real"): void {
    if (v === view) return;
    setQuery({ view: v === "fixture" ? null : "real", status: null });
  }

  const STATUS_OPTS: { value: string; label: string }[] = [
    { value: "candidate", label: "Candidate" },
    { value: "researching", label: "Researching" },
    { value: "reviewing", label: "Reviewing" },
    { value: "frozen", label: "Frozen" },
    { value: "observing", label: "Observing" },
    { value: "completed", label: "Completed" },
    { value: "rejected", label: "Rejected" },
    { value: "blocked", label: "Blocked" },
  ];

  function onStatusChange(e: Event): void {
    setQuery({ status: (e.target as HTMLSelectElement).value || null });
  }

  // 搜索 300ms 防抖后写 URL（服务端过滤）
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput(): void {
    const q = textQuery.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setQuery({ q: q || null }), 300);
  }

  const hasFilters = $derived(statusFilter !== "" || textQuery.trim() !== "");

  function clearFilters(): void {
    setQuery({ status: null, q: null });
  }

  // ---------- Case Drawer ----------
  let drawerCaseId = $state<string | null>(null);
  let drawerData = $state<CaseDetail | null>(null);
  let drawerLoading = $state(false);
  let drawerError = $state<string | null>(null);

  const drawerRow = $derived(
    drawerCaseId ? (cases.find((c) => c.caseId === drawerCaseId) ?? null) : null
  );

  async function openDrawer(caseId: string): Promise<void> {
    drawerCaseId = caseId;
    drawerData = null;
    drawerError = null;
    drawerLoading = true;
    try {
      drawerData = await get<CaseDetail>(`/api/cases/${encodeURIComponent(caseId)}`);
    } catch (e) {
      drawerError = e instanceof Error ? e.message : "加载 Case 详情失败";
    } finally {
      drawerLoading = false;
    }
  }

  function closeDrawer(): void {
    drawerCaseId = null;
    drawerData = null;
    drawerError = null;
  }

  const drawerTitle = $derived(
    drawerCaseId
      ? `${drawerCaseId}${drawerData?.case.title ? ` ${drawerData.case.title}` : ""}`
      : "Case 详情"
  );

  // Drawer 徽章随子视图（REAL 视图描边 REAL DATA；FIXTURE 视图琥珀 FIXTURE）
  const drawerBadge = $derived(view === "real" ? ("real" as const) : ("fixture" as const));

  const DECISION_LABELS: Record<string, string> = {
    approve: "Approve（冻结 Revision）",
    request_changes: "Request Changes（退回修改）",
    reject: "Reject（终态拒绝）",
  };

  // ---------- 列表列定义 ----------
  const caseCols: TableColumn<CaseRow>[] = [
    { key: "id", label: "Case ID", width: "96px", mono: true, sort: (r) => r.caseId, text: (r) => r.caseId },
    { key: "title", label: "标题", width: "240px", sort: (r) => r.title, text: (r) => r.title },
    { key: "status", label: "状态", width: "110px" },
    { key: "themes", label: "主题", width: "170px" },
    { key: "rev", label: "版本", width: "110px", align: "right", sort: (r) => r.revisionCount },
    { key: "t", label: "T 时点", width: "110px", mono: true, sort: (r) => r.researchTimeT ?? "", text: (r) => (r.researchTimeT ?? "—").slice(0, 10) },
    { key: "updated", label: "更新时间", width: "150px", mono: true, sort: (r) => r.updatedAt, text: (r) => r.updatedAt.replace("T", " ").slice(0, 19) },
    { key: "go", label: "", width: "36px" },
  ];
</script>

<div class="cases-page">
  {#if showSkeleton}
    <div class="panel"><div class="skeleton" style="height:48px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:420px;border-radius:0"></div></div>
  {:else}
    {#if error}
      <div class="panel error-panel">
        <span>加载 Case 列表失败：{error}</span>
        <button class="btn btn-text" onclick={() => loadCases(view, statusFilter, textQuery)}>重试</button>
      </div>
    {/if}

    <!-- ① 筛选栏（48px）：双子视图分段控件 + 状态过滤 + 搜索 -->
    <div class="filter-bar">
      <div class="view-switch" role="tablist" aria-label="Case 子视图">
        <button
          class="view-opt"
          class:view-active={view === "fixture"}
          role="tab"
          aria-selected={view === "fixture"}
          onclick={() => switchView("fixture")}
        >
          演示案例 <span class="badge-fixture">FIXTURE</span>
        </button>
        <button
          class="view-opt"
          class:view-active={view === "real"}
          role="tab"
          aria-selected={view === "real"}
          onclick={() => switchView("real")}
        >
          真实候选 <span class="badge-real">REAL DATA</span>
        </button>
      </div>

      <select
        class="input"
        style="width:140px"
        value={statusFilter}
        onchange={onStatusChange}
        aria-label="状态筛选"
      >
        <option value="">全部状态</option>
        {#each STATUS_OPTS as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>

      <input
        class="input"
        style="width:220px"
        placeholder="搜索 Case ID / 标题 / 研究问题"
        bind:value={textQuery}
        oninput={onSearchInput}
        aria-label="搜索 Case"
      />

      <div class="spacer"></div>

      <span class="ts">共 {cases.length} 个 Case{reviewingCount > 0 ? ` · 待审核 ${reviewingCount}` : ""}</span>
      {#if hasFilters}
        <button class="btn-text" onclick={clearFilters}>清除筛选</button>
      {/if}
    </div>

    {#if !loading && cases.length === 0 && view === "real" && !hasFilters}
      <!-- REAL 子视图空态：引导到 Discovery（Phase 2 空态规范：一行文字 + 次级动作） -->
      <div class="panel">
        <div class="empty-state">
          暂无真实候选 Case —— 在 Discovery 中对热点执行「Case Preparation」后，候选会出现在这里
          <button class="btn-text" onclick={() => navigate("/discovery")}>前往 Discovery →</button>
        </div>
      </div>
    {:else if !loading && cases.length === 0 && view === "fixture" && !hasFilters}
      <div class="panel">
        <div class="empty-state">暂无演示案例（FIXTURE 种子数据未包含）</div>
      </div>
    {:else}
      <!-- ② Case 列表（flat table；FIXTURE 子视图带 hatch 纹理条——第三层防线） -->
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">{view === "real" ? "真实候选 Case" : "演示案例"}</h2>
          {#if view === "real"}
            <span class="ts">来自 Discovery「Case Preparation」的真实候选（is_fixture = false）</span>
          {:else}
            <span class="ts">FIXTURE 种子数据（C-F 前缀）</span>
          {/if}
        </div>
        <DataTable
          rows={cases}
          columns={caseCols}
          rowHeight={32}
          keyOf={(r) => r.caseId}
          selectedKey={drawerCaseId}
          onRowClick={(r) => openDrawer(r.caseId)}
          hatch={view === "fixture"}
          emptyText="无匹配 Case"
          footerLeft={`共 ${cases.length} 个 Case${reviewingCount > 0 ? ` · 待审核 ${reviewingCount}` : ""}`}
        >
          {#snippet cell(row, col)}
            {#if col.key === "status"}
              <StatusTag kind="case" value={row.status} />
            {:else if col.key === "themes"}
              {#if row.themes.length > 0}
                <span class="theme-cell">
                  <span class="theme-tag" title={row.themes.join(" / ")}>{row.themes[0]}</span>
                  {#if row.themes.length > 1}
                    <span class="ts">+{row.themes.length - 1}</span>
                  {/if}
                </span>
              {:else}
                <span class="none-text">—</span>
              {/if}
            {:else if col.key === "rev"}
              <span class="rev-cell">
                R{row.currentRevisionNo ?? 0} · 共 {row.revisionCount}
                {#if row.reviewingRevisionId}
                  <StatusTag kind="case" value="reviewing" label="审核中" />
                {/if}
              </span>
            {:else if col.key === "go"}
              <span class="go-arrow" aria-hidden="true">›</span>
            {:else if col.mono}
              <span class="mono">{col.text?.(row)}</span>
            {:else}
              {col.text?.(row)}
            {/if}
          {/snippet}
        </DataTable>
      </section>
    {/if}
  {/if}
</div>

<!-- Case Drawer（720；徽章随子视图） -->
<Drawer open={drawerCaseId !== null} width={720} badge={drawerBadge} title={drawerTitle} onClose={closeDrawer}>
  {#snippet footer()}
    <button class="btn btn-primary" disabled={!drawerCaseId} onclick={() => drawerCaseId && navigate(`/cases/${drawerCaseId}`)}>
      进入完整工作区 →
    </button>
    <span class="ts">Case Workspace（五 Tab）在批次 C 提供</span>
  {/snippet}

  {#if drawerLoading}
    <div class="skeleton" style="height:64px;margin-bottom:16px"></div>
    <div class="skeleton" style="height:120px;margin-bottom:16px"></div>
    <div class="skeleton" style="height:96px"></div>
  {:else if drawerError}
    <div class="panel error-panel">
      <span>{drawerError}</span>
      {#if drawerCaseId}<button class="btn btn-text" onclick={() => openDrawer(drawerCaseId)}>重试</button>{/if}
    </div>
  {:else if drawerData}
    <!-- 1. 头部：Case ID + 标题 + 状态 -->
    <div class="drawer-hero">
      <div class="hero-left">
        <span class="mono hero-id">{drawerData.case.caseId}</span>
        <span class="hero-name">{drawerData.case.title}</span>
      </div>
      <StatusTag kind="case" value={drawerData.case.status} />
    </div>

    <!-- 2. 摘要 dl -->
    <dl class="dl-grid">
      <dt>T 时点</dt><dd class="mono">{drawerData.case.researchTimeT ?? "—"}</dd>
      <dt>信息截止</dt><dd class="mono">{drawerData.case.infoCutoff ?? "—"}</dd>
      <dt>版本</dt><dd>当前 R{drawerRow?.currentRevisionNo ?? 0} · 共 {drawerRow?.revisionCount ?? 0} 个 Revision</dd>
      <dt>创建</dt><dd class="mono">{drawerData.case.createdAt.replace("T", " ").slice(0, 19)}</dd>
      <dt>更新</dt><dd class="mono">{drawerData.case.updatedAt.replace("T", " ").slice(0, 19)}</dd>
      <dt>触发来源</dt>
      <dd>
        {#if drawerData.case.triggerDiscoveryRef?.source === "discovery"}
          Discovery · <span class="mono ts">{String(drawerData.case.triggerDiscoveryRef?.subjectKey ?? "—")}</span>
        {:else}
          <span class="ts">FIXTURE 种子（无 Discovery 触发引用）</span>
        {/if}
      </dd>
    </dl>

    <!-- 3. 研究问题 -->
    <h3 class="sec-title">研究问题</h3>
    <blockquote class="question-quote">{drawerData.case.researchQuestion}</blockquote>

    <!-- 4. 主题与 Episode -->
    <h3 class="sec-title">主题与 Episode</h3>
    {#if drawerData.case.themes.length > 0}
      <div class="chip-row">
        {#each drawerData.case.themes as th (th)}
          <span class="chip">{th}</span>
        {/each}
      </div>
    {:else}
      <span class="none-text">无主题标注</span>
    {/if}
    {#if drawerData.case.episodeRefs.length > 0}
      <div class="chip-row" style="margin-top:8px">
        {#each drawerData.case.episodeRefs as ep (ep)}
          <span class="chip mono" title={ep}>{episodeShort(ep)}</span>
        {/each}
      </div>
    {/if}

    <!-- 5. Revision 列表（冻结不可变提示） -->
    <h3 class="sec-title">Revisions</h3>
    <ul class="rev-list">
      {#each drawerData.revisions as r (r.revisionId)}
        <li class="rev-item">
          <span class="mono">R{r.revisionNo}</span>
          <StatusTag kind="case" value={r.status} label={r.status} />
          {#if r.frozenAt}
            <span class="ts frozen-note" title={r.frozenAt}>已冻结 {r.frozenAt.replace("T", " ").slice(0, 19)} · 此后不可变更，仅可追加 Observation</span>
          {/if}
          <span class="ts">由 {r.createdBy} 创建</span>
        </li>
      {/each}
    </ul>

    <!-- 6. 最近审核记录 -->
    <h3 class="sec-title">最近审核记录</h3>
    {#if drawerData.reviews.length > 0}
      <ul class="rev-list">
        {#each drawerData.reviews.slice(0, 5) as rv (rv.reviewId)}
          <li class="rev-item">
            <span class="mono ts">{rv.reviewedAt.replace("T", " ").slice(0, 19)}</span>
            <span>{DECISION_LABELS[rv.decision] ?? rv.decision}</span>
            <span class="ts">{rv.reason}</span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none-text">暂无审核记录</p>
    {/if}
  {/if}
</Drawer>

<style>
  .cases-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .spacer {
    flex: 1;
  }
  .error-panel {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-color: var(--status-error);
    color: var(--status-error);
    font-size: var(--text-body);
  }

  /* 子视图分段控件（与 Topbar mode-switch 同款视觉语言） */
  .view-switch {
    display: inline-flex;
    height: 32px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    overflow: hidden;
  }
  .view-opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 12px;
    border: none;
    background: var(--bg-panel);
    color: var(--text-tertiary);
    font-size: var(--text-body);
  }
  .view-opt + .view-opt {
    border-left: 1px solid var(--border-default);
  }
  .view-opt.view-active {
    background: var(--bg-inset);
    color: var(--text-primary);
    font-weight: 600;
  }

  /* 单元格 */
  .none-text {
    color: var(--text-tertiary);
  }
  .go-arrow {
    color: var(--text-tertiary);
  }
  .theme-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .theme-tag {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--accent-subtle);
    color: var(--accent-primary);
    font-size: var(--text-caption);
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rev-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-caption);
  }

  /* Drawer 内容 */
  .drawer-hero {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .hero-left {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .hero-id {
    font-size: var(--text-title);
    font-weight: 600;
    color: var(--text-primary);
  }
  .hero-name {
    font-size: var(--text-heading);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dl-grid {
    display: grid;
    grid-template-columns: 110px 1fr;
    gap: 6px 12px;
  }
  .dl-grid dt {
    font-size: var(--text-caption);
    color: var(--text-tertiary);
  }
  .dl-grid dd {
    font-size: var(--text-table);
    color: var(--text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sec-title {
    font-size: var(--text-heading);
    font-weight: 600;
    color: var(--text-primary);
    margin: 16px 0 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border-default);
  }
  .question-quote {
    border-left: 3px solid var(--border-strong);
    background: var(--bg-subtle);
    padding: 8px 12px;
    font-size: var(--text-body);
    line-height: var(--lh-body);
    color: var(--text-primary);
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .rev-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rev-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--text-body);
    flex-wrap: wrap;
  }
  .frozen-note {
    color: var(--status-warning);
  }
</style>
