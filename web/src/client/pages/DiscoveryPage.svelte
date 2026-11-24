<!-- web/src/client/pages/DiscoveryPage.svelte -->
<!-- Discovery 页（Phase 2 §2.2，REAL 域恒定，无 FIXTURE 徽章）：
     ① 筛选栏（48px）→ ② 概况行 → ③ 热点队列表 → 行 Drawer(720)：
        热点概览 / 主题定义与映射链（原始片段 → theme_alias.alias_text → 标准化主题，含 mapping_method 注记）/
        相关股票（点击 → Market 带参回跳 ?date=&code=）/ Episodes / 原始片段样本 / 人类校准。
     人类校准：skip 表单（四选一原因 + 备注 + 撤销）/ Case Prep 表单（研究问题 + T + 信息截止校验 + 防重复置灰）。
     双向跳转：Market Drawer → /discovery?episode=<id>&date=<d> 自动开对应热点 Drawer。 -->
<script lang="ts">
  import { get, post, ApiError } from "../lib/api";
  import { router, setQuery, navigate } from "../lib/router.svelte";
  import { toast } from "../lib/toast.svelte";
  import { episodeShort } from "../lib/format";
  import DataTable, { type TableColumn } from "../components/DataTable.svelte";
  import Drawer from "../components/Drawer.svelte";
  import StatusTag from "../components/StatusTag.svelte";

  // ---------- 类型 ----------
  interface QueueEpisode {
    episodeId: string;
    status: string;
    startDate: string;
    endDate: string;
    peakObsCount: number | null;
    totalStockCount: number | null;
  }

  interface QueueRow {
    topicId: string; // "t:<theme_id>" | "f:<normalized_fragment>"
    rawTopic: string;
    theme: { themeId: string; themeName: string; themeType: string | null; mapping: string } | null;
    rawSamples: { rawFragment: string; date: string; stockCode: string }[];
    firstSeen: string;
    lastSeen: string;
    stockCount: number;
    fragmentCount: number;
    episode: QueueEpisode | null;
    agentStatus: string;
    candidateCase: { caseId: string; title: string; status: string } | null;
  }

  interface QueueData {
    queue: QueueRow[];
    footer: { total: number; unhandled: number };
    snapshotId: string;
  }

  interface DetailAction {
    action: string;
    reason: string | null;
    note: string | null;
    createdAt: string;
  }

  interface DetailSample {
    rawFragment: string;
    normalizedFragment: string;
    date: string;
    stockCode: string;
    name: string | null;
  }

  interface TopicDetail {
    topicId: string;
    theme: {
      themeId: string;
      themeName: string;
      themeType: string | null;
      parentThemeId: string | null;
      definition: string | null;
      status: string | null;
      taxonomyVersion: string | null;
    } | null;
    fragment: string | null;
    stats?: { firstSeen: string; lastSeen: string; stockCount: number; fragmentCount: number };
    episodes?: {
      episodeId: string;
      status: string;
      startDate: string;
      endDate: string;
      durationDays: number | null;
      peakDate: string | null;
      peakObsCount: number | null;
      totalObsCount: number | null;
      totalStockCount: number | null;
      activeDays: number | null;
      intermittentDays: number | null;
    }[];
    stocks?: { stockCode: string; name: string | null; obsCount: number; firstSeen: string; lastSeen: string }[];
    fragmentSamples: DetailSample[];
    aliases?: { aliasText: string; mappingMethod: string | null; reviewStatus: string | null }[];
    actions: DetailAction[];
  }

  // ---------- 所有 $state 声明 ----------
  let queue = $state<QueueRow[]>([]);
  let footer = $state<{ total: number; unhandled: number }>({ total: 0, unhandled: 0 });
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showSkeleton = $state(false);
  let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
  let episodeParam = $state<string | null>(null);
  let marketDateParam = $state<string | null>(null);
  let textQuery = $state("");
  let agentFilter = $state("");
  let sortKey = $state("last");
  let sortDir = $state<"asc" | "desc">("desc");

  // ---------- 队列加载（<400ms 不出骨架，与 Market 同款防闪烁） ----------
  async function loadQueue(): Promise<void> {
    loading = true;
    error = null;
    showSkeleton = false;
    if (skeletonTimer) clearTimeout(skeletonTimer);
    skeletonTimer = setTimeout(() => {
      if (loading) showSkeleton = true;
    }, 400);
    try {
      const data = await get<QueueData>("/api/discovery/queue");
      queue = data.queue;
      footer = data.footer;
    } catch (e) {
      error = e instanceof Error ? e.message : "加载热点队列失败";
    } finally {
      loading = false;
      if (skeletonTimer) {
        clearTimeout(skeletonTimer);
        skeletonTimer = null;
      }
      showSkeleton = false;
    }
  }

  // 首次挂载：URL 恢复筛选/排序 + Market 带参上下文（?episode=&date=）
  // 使用 $effect + initialized 标志（与 MarketPage 同款模式，比 onMount 更可靠）
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    const params = new URLSearchParams(router.search);
    const ag = params.get("agent");
    if (ag) agentFilter = ag;
    const qq = params.get("q");
    if (qq) textQuery = qq;
    const sk = params.get("sort");
    if (sk) sortKey = sk;
    const sd = params.get("dir");
    if (sd === "asc" || sd === "desc") sortDir = sd;
    episodeParam = params.get("episode");
    marketDateParam = params.get("date");
    loadQueue();
  });

  // ?episode= 自动打开对应热点的 Drawer（队列到达后执行一次；找不到给一次性提示）
  let episodeHandled = false;
  $effect(() => {
    if (episodeHandled || !episodeParam || loading || queue.length === 0) return;
    episodeHandled = true;
    const row = queue.find((r) => r.episode?.episodeId === episodeParam);
    if (row) openDrawer(row.topicId);
    else toast("未在当前快照热点队列中找到该 Episode 对应的热点", "warning");
  });

  // ---------- 筛选与排序（客户端过滤；状态写入 URL） ----------
  const AGENT_OPTS: { value: string; label: string }[] = [
    { value: "unhandled", label: "未处理" },
    { value: "researching", label: "处理中" },
    { value: "prepared", label: "已有候选 Case" },
    { value: "researched", label: "Agent 已研究" },
    { value: "skipped", label: "已跳过" },
    { value: "rejected", label: "被拒绝" },
  ];

  function onSearchInput(): void {
    setQuery({ q: textQuery.trim() || null });
  }

  function onAgentChange(e: Event): void {
    agentFilter = (e.target as HTMLSelectElement).value;
    setQuery({ agent: agentFilter || null });
  }

  function onSortChange(key: string, dir: "asc" | "desc"): void {
    sortKey = key;
    sortDir = dir;
    setQuery({ sort: key, dir });
  }

  function clearFilters(): void {
    textQuery = "";
    agentFilter = "";
    sortKey = "last";
    sortDir = "desc";
    setQuery({ q: null, agent: null, sort: null, dir: null });
  }

  function clearSourceParams(): void {
    episodeParam = null;
    marketDateParam = null;
    setQuery({ episode: null, date: null });
  }

  const filteredQueue = $derived.by(() => {
    const q = textQuery.trim().toLowerCase();
    return queue.filter((r) => {
      if (agentFilter && r.agentStatus !== agentFilter) return false;
      if (q) {
        const hay = `${r.rawTopic} ${r.theme?.themeName ?? ""} ${r.candidateCase?.caseId ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  const skippedCount = $derived(queue.filter((r) => r.agentStatus === "skipped").length);
  const hasFilters = $derived(
    textQuery.trim() !== "" || agentFilter !== "" || sortKey !== "last" || sortDir !== "desc"
  );

  // ---------- 详情 Drawer ----------
  let drawerTopicId = $state<string | null>(null);
  let drawerDetail = $state<TopicDetail | null>(null);
  let drawerLoading = $state(false);
  let drawerError = $state<string | null>(null);

  const drawerRow = $derived(
    drawerTopicId ? (queue.find((r) => r.topicId === drawerTopicId) ?? null) : null
  );

  async function openDrawer(topicId: string): Promise<void> {
    drawerTopicId = topicId;
    drawerDetail = null;
    drawerError = null;
    drawerLoading = true;
    // 切换 Drawer 目标时重置全部表单态（事件驱动，避免 effect 依赖风暴）
    skipReason = "热度不足";
    skipNote = "";
    formErr = null;
    dupCaseId = null;
    prepQuestion = "";
    prepT = "";
    prepCutoff = "";
    prepNote = "";
    try {
      drawerDetail = await get<TopicDetail>(`/api/discovery/theme/${encodeURIComponent(topicId)}`);
    } catch (e) {
      drawerError = e instanceof Error ? e.message : "加载热点详情失败";
    } finally {
      drawerLoading = false;
    }
  }

  function closeDrawer(): void {
    drawerTopicId = null;
    drawerDetail = null;
    drawerError = null;
    // 关闭 Drawer 时重置表单态
    skipReason = "热度不足";
    skipNote = "";
    formErr = null;
    dupCaseId = null;
    prepQuestion = "";
    prepT = "";
    prepCutoff = "";
    prepNote = "";
  }

  const drawerTitle = $derived(
    drawerRow ? (drawerRow.theme?.themeName ?? drawerRow.rawTopic) : "热点详情"
  );

  // ---------- 人类校准：skip / undo ----------
  const SKIP_REASONS = ["热度不足", "已研究过", "超出能力范围", "其他"];
  let skipReason = $state("热度不足");
  let skipNote = $state("");
  let skipSubmitting = $state(false);
  let formErr = $state<string | null>(null);

  // 切换 Drawer 目标时重置表单态 → 已移至 openDrawer() 函数内（事件驱动，避免 effect 依赖风暴）

  function updateRow(topicId: string, patch: Partial<QueueRow>): void {
    const i = queue.findIndex((r) => r.topicId === topicId);
    if (i >= 0) queue[i] = { ...queue[i], ...patch };
  }

  async function submitSkip(): Promise<void> {
    if (!drawerTopicId || !drawerRow) return;
    skipSubmitting = true;
    formErr = null;
    try {
      await post(`/api/discovery/${encodeURIComponent(drawerTopicId)}/skip`, {
        reason: skipReason,
        note: skipNote.trim() || null,
      });
      updateRow(drawerTopicId, { agentStatus: "skipped" });
      toast("已标记不研究，该热点移入已跳过", "success");
    } catch (e) {
      formErr = e instanceof Error ? e.message : "标记失败";
    } finally {
      skipSubmitting = false;
    }
  }

  async function undoSkip(): Promise<void> {
    if (!drawerTopicId || !drawerRow) return;
    skipSubmitting = true;
    formErr = null;
    try {
      await post(`/api/discovery/${encodeURIComponent(drawerTopicId)}/skip`, { undo: true });
      updateRow(drawerTopicId, { agentStatus: "unhandled" });
      toast("已撤销跳过，热点恢复为未处理", "success");
    } catch (e) {
      formErr = e instanceof Error ? e.message : "撤销失败";
    } finally {
      skipSubmitting = false;
    }
  }

  // ---------- 人类校准：Case Prep（防重复置灰：本地行状态 + 409 双防线） ----------
  let prepQuestion = $state("");
  let prepT = $state("");
  let prepCutoff = $state("");
  let prepNote = $state("");
  let prepSubmitting = $state(false);
  let dupCaseId = $state<string | null>(null);

  const prepBlocked = $derived.by(() => {
    if (!drawerRow) return null;
    if (
      ["prepared", "researching", "researched"].includes(drawerRow.agentStatus) &&
      drawerRow.candidateCase
    ) {
      return `该热点已有关联 Case ${drawerRow.candidateCase.caseId}（${drawerRow.candidateCase.status}），不可重复准备`;
    }
    if (dupCaseId) return `该热点已存在候选 Case ${dupCaseId}，不可重复准备`;
    return null;
  });

  const prepInvalid = $derived.by(() => {
    if (!prepQuestion.trim()) return "研究问题为必填项";
    if (!prepT) return "T 时点为必填项";
    if (!prepCutoff) return "信息截止为必填项";
    if (new Date(prepCutoff).getTime() > new Date(prepT).getTime()) {
      return "信息截止必须早于或等于 T 时点";
    }
    return null;
  });

  async function submitPrepare(): Promise<void> {
    if (!drawerTopicId || !drawerRow || prepBlocked || prepInvalid || prepSubmitting) return;
    prepSubmitting = true;
    formErr = null;
    try {
      const res = await post<{ caseId: string; warning: string | null }>(
        `/api/discovery/${encodeURIComponent(drawerTopicId)}/prepare`,
        {
          researchQuestion: prepQuestion.trim(),
          researchTimeT: prepT,
          infoCutoff: prepCutoff,
          note: prepNote.trim() || null,
          episodeRef: drawerRow.episode?.episodeId ?? null,
        }
      );
      updateRow(drawerTopicId, {
        agentStatus: "prepared",
        candidateCase: {
          caseId: res.caseId,
          title: prepQuestion.trim().slice(0, 60),
          status: "candidate",
        },
      });
      toast(`已创建候选 Case ${res.caseId}（在 Cases 页「真实候选 REAL」子视图查看）`, "success");
      if (res.warning) toast(res.warning, "warning");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 服务端防重复：{ error, existingCaseId } → 置灰表单（ID 从错误文案中提取）
        const m = /C-[0-9]+/.exec(e.message);
        dupCaseId = m ? m[0] : "unknown";
        formErr = e.message;
      } else {
        formErr = e instanceof Error ? e.message : "创建候选 Case 失败";
      }
    } finally {
      prepSubmitting = false;
    }
  }

  // ---------- 队列表列定义 ----------
  const queueCols: TableColumn<QueueRow>[] = [
    { key: "topic", label: "热点 / 主题", width: "220px", sort: (r) => r.theme?.themeName ?? r.rawTopic },
    { key: "episode", label: "Episode", width: "160px", sort: (r) => r.episode?.episodeId ?? "" },
    { key: "first", label: "首现", width: "100px", mono: true, sort: (r) => r.firstSeen, text: (r) => r.firstSeen },
    { key: "last", label: "最近", width: "100px", mono: true, sort: (r) => r.lastSeen, text: (r) => r.lastSeen },
    { key: "stocks", label: "股票数", width: "76px", align: "right", sort: (r) => r.stockCount, text: (r) => String(r.stockCount) },
    { key: "frags", label: "片段数", width: "76px", align: "right", sort: (r) => r.fragmentCount, text: (r) => String(r.fragmentCount) },
    { key: "agent", label: "Agent 状态", width: "130px" },
    { key: "case", label: "关联 Case", width: "100px", mono: true },
    { key: "go", label: "", width: "36px" },
  ];
</script>

<div class="discovery">
  {#if showSkeleton}
    <!-- 骨架屏：与 Market 同款三区块占位（Phase 2 §4.1） -->
    <div class="panel"><div class="skeleton" style="height:48px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:44px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:420px;border-radius:0"></div></div>
  {:else}
    {#if error}
      <!-- 错误态：面板级内联条 + 重试（Phase 2 §4.1） -->
      <div class="panel error-panel">
        <span>加载热点队列失败：{error}</span>
        <button class="btn btn-text" onclick={loadQueue}>重试</button>
      </div>
    {/if}

    <!-- ① 筛选栏（48px） -->
    <div class="filter-bar">
      <input
        class="input"
        style="width:240px"
        placeholder="搜索主题 / 原始片段 / Case ID"
        bind:value={textQuery}
        oninput={onSearchInput}
        aria-label="搜索热点"
      />

      <select
        class="input"
        style="width:150px"
        value={agentFilter}
        onchange={onAgentChange}
        aria-label="Agent 状态筛选"
      >
        <option value="">全部状态</option>
        {#each AGENT_OPTS as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>

      {#if episodeParam || marketDateParam}
        <!-- 来自 Market 的带参上下文（双向跳转另一半） -->
        <span class="chip">
          来自 Market{marketDateParam ? ` · ${marketDateParam}` : ""}
          {#if marketDateParam}
            <button
              class="chip-remove"
              onclick={() => navigate(`/market?date=${marketDateParam}`)}
              aria-label="返回 Market 该交易日"
              title="返回 Market 该交易日">↩</button>
          {/if}
          <button class="chip-remove" onclick={clearSourceParams} aria-label="清除来源上下文">✕</button>
        </span>
      {/if}

      <div class="spacer"></div>

      <span class="ts">共 {queue.length} 个热点{filteredQueue.length !== queue.length ? ` · 筛选后 ${filteredQueue.length} 个` : ""}</span>
      {#if hasFilters}
        <button class="btn-text" onclick={clearFilters}>清除全部</button>
      {/if}
    </div>

    <!-- ② 概况行（单行文字统计，禁止 KPI 卡片） -->
    <div class="panel summary-bar">
      <span>热点 <b class="mono">{queue.length}</b></span>
      <span class="sep">·</span>
      <span>未处理 <b class="mono">{footer.unhandled}</b></span>
      <span class="sep">·</span>
      <span>已跳过 <b class="mono">{skippedCount}</b></span>
      <span class="sep">·</span>
      <span class="ts">点击行查看详情与人类校准动作</span>
    </div>

    <!-- ③ 热点队列表 -->
    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">热点队列</h2>
        <span class="ts">标准化主题聚合 + 未映射原始片段 · Agent 状态由 Case 生命周期推导</span>
      </div>
      <DataTable
        rows={filteredQueue}
        columns={queueCols}
        rowHeight={40}
        keyOf={(r) => r.topicId}
        selectedKey={drawerTopicId}
        onRowClick={(r) => openDrawer(r.topicId)}
        initialSortKey={sortKey}
        initialSortDir={sortDir}
        onSortChange={onSortChange}
        emptyText={queue.length === 0 ? "当前快照无热点（队列为空）" : "无匹配热点"}
        footerLeft={`共 ${queue.length} 个热点 · 未处理 ${footer.unhandled} · 已跳过 ${skippedCount}`}
      >
        {#snippet cell(row, col)}
          {#if col.key === "topic"}
            <span class="topic-cell">
              {#if row.theme}
                <span class="theme-tag">{row.theme.themeName}</span>
                <span class="ts sub-line">{row.rawTopic}</span>
              {:else}
                <span class="theme-tag theme-raw">{row.rawTopic}</span>
                <span class="ts sub-line none-text">未映射标准化主题</span>
              {/if}
            </span>
          {:else if col.key === "episode"}
            {#if row.episode}
              <span class="ep-cell mono" title={row.episode.episodeId}>
                {episodeShort(row.episode.episodeId)}
                <StatusTag kind="episode" value={row.episode.status} />
              </span>
            {:else}
              <span class="none-text">—</span>
            {/if}
          {:else if col.key === "agent"}
            <StatusTag kind="agent" value={row.agentStatus} />
          {:else if col.key === "case"}
            {#if row.candidateCase}
              <span class="mono" title={row.candidateCase.title}>{row.candidateCase.caseId}</span>
            {:else}
              <span class="none-text">—</span>
            {/if}
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
</div>

<!-- 热点 Drawer（720，REAL 域 → 无徽章，徽章不对称规则） -->
<Drawer open={drawerTopicId !== null} width={720} badge={null} title={drawerTitle} onClose={closeDrawer}>
  {#if drawerRow}
    <!-- 1. 热点概览（来自队列表行，无需等待详情请求） -->
    <div class="drawer-hero">
      <div class="hero-left">
        {#if drawerRow.theme}
          <span class="hero-name">{drawerRow.theme.themeName}</span>
          <StatusTag kind="mapping" value={drawerRow.theme.mapping} />
        {:else}
          <span class="hero-name">{drawerRow.rawTopic}</span>
          <span class="none-text">未映射标准化主题</span>
        {/if}
      </div>
      <StatusTag kind="agent" value={drawerRow.agentStatus} />
    </div>
    <dl class="dl-grid">
      <dt>原始片段</dt><dd>{drawerRow.rawTopic}</dd>
      <dt>活跃区间</dt><dd class="mono">{drawerRow.firstSeen} ~ {drawerRow.lastSeen}</dd>
      <dt>覆盖范围</dt><dd>{drawerRow.stockCount} 只股票 · {drawerRow.fragmentCount} 条片段</dd>
      {#if drawerRow.episode}
        <dt>Episode</dt>
        <dd>
          <span class="mono ep-id" title={drawerRow.episode.episodeId}>{episodeShort(drawerRow.episode.episodeId)}</span>
          <span class="ts">{drawerRow.episode.startDate} ~ {drawerRow.episode.endDate}</span>
          <StatusTag kind="episode" value={drawerRow.episode.status} />
        </dd>
      {/if}
      {#if drawerRow.candidateCase}
        <dt>关联 Case</dt>
        <dd>
          <button class="btn-text case-link" onclick={() => drawerRow && navigate(`/cases/${drawerRow.candidateCase?.caseId}`)}>
            <span class="mono">{drawerRow.candidateCase.caseId}</span>
          </button>
          <span class="ts">（{drawerRow.candidateCase.status}）</span>
        </dd>
      {/if}
    </dl>

    {#if drawerLoading}
      <div class="skeleton" style="height:64px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:120px;margin-bottom:16px"></div>
      <div class="skeleton" style="height:96px"></div>
    {:else if drawerError}
      <div class="panel error-panel">
        <span>{drawerError}</span>
        {#if drawerTopicId}<button class="btn btn-text" onclick={() => openDrawer(drawerTopicId)}>重试</button>{/if}
      </div>
    {:else if drawerDetail}
      {#if drawerDetail.theme}
        <!-- 2. 主题定义 -->
        <h3 class="sec-title">主题定义</h3>
        <dl class="dl-grid">
          <dt>主题类型</dt><dd>{drawerDetail.theme.themeType ?? "—"}</dd>
          <dt>状态</dt><dd>{drawerDetail.theme.status ?? "—"}</dd>
          <dt>词表版本</dt><dd class="mono">{drawerDetail.theme.taxonomyVersion ?? "—"}</dd>
          <dt>父主题</dt><dd class="mono">{drawerDetail.theme.parentThemeId ?? "—"}</dd>
        </dl>
        {#if drawerDetail.theme.definition}
          <p class="theme-def">{drawerDetail.theme.definition}</p>
        {/if}

        <!-- 3. 映射链：原始片段 → theme_alias.alias_text → 标准化主题（含 mapping_method 注记） -->
        <h3 class="sec-title">映射链（原始 → 标准化）</h3>
        {#if (drawerDetail.aliases?.length ?? 0) > 0}
          <ul class="map-list">
            {#each drawerDetail.aliases ?? [] as a (a.aliasText)}
              <li class="map-item">
                <span class="mono">{a.aliasText}</span>
                <span class="ts">→ {drawerDetail.theme?.themeName}</span>
                <span class="ts">{a.mappingMethod ?? "映射方式未知"}</span>
                <span class="ts">{a.reviewStatus ?? ""}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="none-text">该主题暂无别名映射记录</p>
        {/if}

        <!-- 4. Episodes -->
        {#if (drawerDetail.episodes?.length ?? 0) > 0}
          <h3 class="sec-title">Episodes</h3>
          {#each drawerDetail.episodes ?? [] as ep (ep.episodeId)}
            <div class="ep-line">
              <span class="mono ep-id" title={ep.episodeId}>{episodeShort(ep.episodeId)}</span>
              <span class="ts">{ep.startDate} ~ {ep.endDate}</span>
              <StatusTag kind="episode" value={ep.status} />
              <span class="ts">
                {ep.durationDays ?? "—"} 天 · 峰值 {ep.peakDate ?? "—"}（{ep.peakObsCount ?? 0} 观察）· 累计 {ep.totalStockCount ?? 0} 只股票
              </span>
            </div>
          {/each}
        {/if}

        <!-- 5. 相关股票（点击 → Market 带参回跳，双向跳转另一半） -->
        {#if (drawerDetail.stocks?.length ?? 0) > 0}
          <h3 class="sec-title">相关股票 <span class="ts">点击跳转 Market 对应交易日</span></h3>
          <div class="stock-list">
            {#each drawerDetail.stocks ?? [] as s (s.stockCode)}
              <button
                class="stock-row"
                onclick={() => navigate(`/market?date=${s.lastSeen}&code=${s.stockCode}`)}
                title={`在 Market 中查看 ${s.stockCode}（${s.lastSeen}）`}
              >
                <span class="mono">{s.stockCode}</span>
                <span>{s.name ?? "—"}</span>
                <span class="ts">{s.obsCount} 次观察 · {s.firstSeen} ~ {s.lastSeen}</span>
                <span class="go-arrow" aria-hidden="true">→ Market</span>
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <!-- 未映射片段：仅统计 + 样本 -->
        <h3 class="sec-title">片段统计</h3>
        <dl class="dl-grid">
          <dt>首现 / 最近</dt>
          <dd class="mono">{drawerDetail.stats?.firstSeen ?? "—"} ~ {drawerDetail.stats?.lastSeen ?? "—"}</dd>
          <dt>覆盖范围</dt>
          <dd>{drawerDetail.stats?.stockCount ?? 0} 只股票 · {drawerDetail.stats?.fragmentCount ?? 0} 条片段</dd>
        </dl>
        <p class="none-text frag-note">该片段尚未映射到标准化主题——可在积累观察后由主题映射流程归入词表。</p>
      {/if}

      <!-- 6. 原始片段样本 -->
      <h3 class="sec-title">原始片段样本</h3>
      {#if drawerDetail.fragmentSamples.length > 0}
        <ul class="frag-list">
          {#each drawerDetail.fragmentSamples as f, i (i)}
            <li>
              <span class="mono frag-no">{f.date} · {f.stockCode}{f.name ? ` ${f.name}` : ""}</span>
              {f.rawFragment}
              {#if f.normalizedFragment !== f.rawFragment}
                <span class="ts">→ {f.normalizedFragment}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none-text">无原始片段样本</p>
      {/if}

      <!-- 7. 人类校准记录 -->
      <h3 class="sec-title">人类校准记录</h3>
      {#if drawerDetail.actions.length > 0}
        <ul class="map-list">
          {#each drawerDetail.actions as a (a.createdAt + a.action)}
            <li class="map-item">
              <span class="mono ts">{a.createdAt.replace("T", " ").slice(0, 19)}</span>
              <span>{a.action}</span>
              {#if a.reason}<span class="ts">{a.reason}</span>{/if}
              {#if a.note}<span class="ts">{a.note}</span>{/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none-text">暂无校准动作</p>
      {/if}
    {/if}

    <!-- 8. 人类校准操作区（skip 表单 / 撤销 + Case Prep 表单） -->
    {#if drawerRow && !drawerLoading}
      <h3 class="sec-title">标记不研究</h3>
      {#if drawerRow.agentStatus === "skipped"}
        <div class="skip-done">
          <span>该热点已标记不研究{drawerDetail?.actions.find((a) => a.action === "skip")?.reason ? `（${drawerDetail.actions.find((a) => a.action === "skip")?.reason}）` : ""}。</span>
          <button class="btn" disabled={skipSubmitting} onclick={undoSkip}>撤销跳过（恢复为未处理）</button>
        </div>
      {:else}
        <form class="skip-form" onsubmit={(e) => { e.preventDefault(); submitSkip(); }}>
          <div class="radio-row" role="radiogroup" aria-label="不研究原因">
            {#each SKIP_REASONS as r (r)}
              <label class="radio-opt">
                <input type="radio" name="skip-reason" value={r} bind:group={skipReason} />
                <span>{r}</span>
              </label>
            {/each}
          </div>
          <input
            class="input"
            style="width:100%"
            placeholder="备注（可选）"
            bind:value={skipNote}
            aria-label="不研究备注"
          />
          {#if formErr}<div class="form-error">{formErr}</div>{/if}
          <div class="form-actions">
            <button class="btn" type="submit" disabled={skipSubmitting}>标记不研究</button>
          </div>
        </form>
      {/if}

      <h3 class="sec-title">Case Preparation</h3>
      {#if prepBlocked}
        <!-- 防重复置灰：本地行状态（prepared/researching/researched）或服务端 409 命中 -->
        <div class="prep-blocked">
          <span>{prepBlocked}</span>
          {#if drawerRow.candidateCase}
            <button class="btn btn-text" onclick={() => navigate(`/cases/${drawerRow.candidateCase?.caseId}`)}>
              查看 {drawerRow.candidateCase.caseId}
            </button>
          {/if}
        </div>
      {:else}
        <form class="prep-form" onsubmit={(e) => { e.preventDefault(); submitPrepare(); }}>
          <label class="field">
            <span class="field-label">研究问题 <span class="req">*</span></span>
            <textarea
              class="input"
              rows="3"
              style="width:100%"
              placeholder="例如：XX 主题的持续性是否足以支撑龙头公司的第二波行情？（少于 15 字会收到补充建议）"
              bind:value={prepQuestion}
            ></textarea>
          </label>
          <div class="field-grid">
            <label class="field">
              <span class="field-label">研究时点 T <span class="req">*</span></span>
              <input class="input mono" type="datetime-local" bind:value={prepT} />
            </label>
            <label class="field">
              <span class="field-label">信息截止 <span class="req">*</span> <span class="ts">（必须早于或等于 T）</span></span>
              <input class="input mono" type="date" bind:value={prepCutoff} />
            </label>
          </div>
          <label class="field">
            <span class="field-label">备注（可选，写入 R1 input_manifest）</span>
            <input class="input" style="width:100%" bind:value={prepNote} />
          </label>
          {#if prepInvalid}<div class="form-hint">{prepInvalid}</div>{/if}
          {#if formErr}<div class="form-error">{formErr}</div>{/if}
          <div class="form-actions">
            <button class="btn btn-primary" type="submit" disabled={prepSubmitting || !!prepInvalid}>
              创建候选 Case
            </button>
            <span class="ts">创建后进入 candidate 状态，可在 Cases 页「真实候选 REAL」子视图查看</span>
          </div>
        </form>
      {/if}
    {/if}
  {/if}
</Drawer>

<style>
  .discovery {
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

  /* 概况行 */
  .summary-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-size: var(--text-body);
    color: var(--text-secondary);
  }
  .summary-bar b {
    color: var(--text-primary);
    font-weight: 600;
  }
  .sep {
    color: var(--border-strong);
  }

  /* 队列单元格 */
  .topic-cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 0;
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
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .theme-tag.theme-raw {
    background: var(--status-warning-bg);
    color: var(--status-warning);
  }
  .sub-line {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ep-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-caption);
  }
  .none-text {
    color: var(--text-tertiary);
  }
  .go-arrow {
    color: var(--text-tertiary);
    white-space: nowrap;
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
  .hero-name {
    font-size: var(--text-title);
    line-height: var(--lh-title);
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
    margin-bottom: 8px;
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
  .ep-id {
    font-weight: 600;
    margin-right: 6px;
  }
  .case-link {
    padding-left: 0;
  }

  .sec-title {
    font-size: var(--text-heading);
    font-weight: 600;
    color: var(--text-primary);
    margin: 16px 0 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border-default);
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .theme-def {
    font-size: var(--text-body);
    line-height: var(--lh-body);
    color: var(--text-secondary);
  }
  .frag-note {
    margin-top: 6px;
  }

  .map-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .map-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: var(--text-body);
    flex-wrap: wrap;
  }
  .ep-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 0;
    font-size: var(--text-body);
    flex-wrap: wrap;
  }

  .stock-list {
    display: flex;
    flex-direction: column;
  }
  .stock-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-body);
    text-align: left;
    cursor: pointer;
  }
  .stock-row:hover {
    background: var(--bg-subtle);
  }
  .stock-row .go-arrow {
    margin-left: auto;
    font-size: var(--text-caption);
  }

  .frag-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .frag-list li {
    font-size: var(--text-body);
    line-height: var(--lh-body);
  }
  .frag-no {
    color: var(--text-tertiary);
    margin-right: 6px;
    font-size: var(--text-caption);
  }

  /* 校准表单 */
  .skip-done {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--text-body);
    color: var(--text-secondary);
  }
  .skip-form,
  .prep-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .radio-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .radio-opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-body);
    color: var(--text-primary);
    cursor: pointer;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-label {
    font-size: var(--text-caption);
    color: var(--text-secondary);
  }
  .req {
    color: var(--status-error);
  }
  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .form-hint {
    font-size: var(--text-caption);
    color: var(--status-warning);
  }
  .form-error {
    font-size: var(--text-caption);
    color: var(--status-error);
  }
  .form-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .prep-blocked {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-body);
  }
</style>
