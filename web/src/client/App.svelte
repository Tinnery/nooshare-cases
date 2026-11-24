<!-- web/src/client/App.svelte -->
<!-- 应用骨架：左侧导航（220/64 折叠）+ Topbar（56px）+ FIXTURE 全局横幅 + 轻量路由 + 页面挂载。
     批次 A：Market 页为完整实现；其余页面暂为占位（批次 B/C 交付）。 -->
<script lang="ts">
  import { get } from "./lib/api";
  import { router, navigate } from "./lib/router.svelte";
  import { toasts } from "./lib/toast.svelte";
  import {
    mode,
    setMode,
    domainFromPath,
    resolveMode,
    modeLockReason,
    applyModeFromUrl,
  } from "./lib/mode.svelte";
  import MarketPage from "./pages/MarketPage.svelte";
  import DiscoveryPage from "./pages/DiscoveryPage.svelte";
  import CasesPage from "./pages/CasesPage.svelte";

  // ---------- 轻量路由（共享 router store，页面可用 navigate 跳转） ----------
  function syncFromLocation(): void {
    applyModeFromUrl(router.search);
  }
  window.addEventListener("popstate", syncFromLocation);

  // / → 重定向 /market（替换历史，不产生回退步骤）
  $effect(() => {
    if (router.href === "/") navigate("/market", true);
  });

  const domain = $derived(domainFromPath(router.href));
  const effectiveMode = $derived(resolveMode(domain));
  const lockReason = $derived(modeLockReason(domain));
  const caseIdMatch = $derived(/\/cases\/([^/]+)$/.exec(router.href));

  // ---------- 导航折叠（220/64，持久化） ----------
  const NAV_KEY = "nooshare.nav.collapsed";
  let collapsed = $state(false);
  try {
    collapsed = localStorage.getItem(NAV_KEY) === "1";
  } catch {
    /* 忽略 */
  }
  function toggleNav(): void {
    collapsed = !collapsed;
    try {
      localStorage.setItem(NAV_KEY, collapsed ? "1" : "0");
    } catch {
      /* 忽略 */
    }
  }

  // ---------- 全局搜索（回车进结果页；空查询不发起请求） ----------
  let searchInput = $state("");
  function onSearchKeydown(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    const q = searchInput.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  // ---------- Run 状态灯 / 导航 badge（30s 轮询） ----------
  // Discovery badge 需独立轻量计数端点（避免为拉徽章整表聚合），P0 暂不显示，列入后续批次。
  let reviewingCount = $state<number | null>(null); // Cases/Review 共享：待审核数
  let runsRunning = $state(0);
  let runsFailed = $state(0);
  let runsLastFinishedAt = $state<string | null>(null);

  async function loadBadges(): Promise<void> {
    try {
      const c = await get<{ footer: { reviewing: number } }>("/api/cases?status=reviewing");
      reviewingCount = c.footer.reviewing;
    } catch {
      /* badge 获取失败静默 */
    }
    try {
      const r = await get<{
        footer: { running: number; failed: number };
        runs: { status: string; finishedAt: string | null }[];
      }>("/api/runs");
      runsRunning = r.footer.running;
      runsFailed = r.footer.failed;
      const finished = r.runs
        .filter((x) => x.status !== "running")
        .map((x) => x.finishedAt ?? "")
        .sort()
        .at(-1);
      runsLastFinishedAt = finished || null;
    } catch {
      /* 忽略 */
    }
  }

  $effect(() => {
    syncFromLocation();
    loadBadges();
    const t = setInterval(loadBadges, 30_000);
    return () => clearInterval(t);
  });

  // Run 状态灯（Phase 2 §1.4）：FIXTURE 域静态提示；REAL 域按运行/失败/成功三态
  const runLight = $derived.by(() => {
    if (effectiveMode === "fixture") return { kind: "fixture" } as const;
    if (runsRunning > 0) return { kind: "running" } as const;
    if (runsFailed > 0) return { kind: "failed", count: runsFailed } as const;
    return { kind: "ok", at: runsLastFinishedAt } as const;
  });

  function goRuns(status?: string): void {
    navigate(status ? `/runs?status=${status}` : "/runs");
  }

  // ---------- 模式切换（单向降级；域锁定时不响应） ----------
  function onModeClick(next: "real" | "fixture"): void {
    if (lockReason) return;
    if (next === "real" && mode.current === "fixture") {
      if (!window.confirm("确认返回真实数据模式？FIXTURE 演示内容将被隐藏。")) return;
    }
    setMode(next, true);
  }

  // ---------- 导航项（按工作流顺序，Phase 2 §1.2） ----------
  const activeId = $derived(
    ["market", "discovery", "cases", "review", "corpus", "runs"].find(
      (id) =>
        router.href === `/${id}` ||
        (id === "cases" && router.href.startsWith("/cases")) ||
        (id === "runs" && router.href.startsWith("/runs"))
    ) ?? ""
  );
</script>

<div class="app">
  <div class="shell">
    <!-- 左侧导航 -->
    <nav class="sidenav" class:collapsed aria-label="主导航">
      {#each [["market", "Market"], ["discovery", "Discovery"], ["cases", "Cases"], ["review", "Review"], ["corpus", "Corpus"], ["runs", "Agent Runs"]] as [id, label] (id)}
        <button
          class="nav-item"
          class:active={activeId === id}
          onclick={() => navigate(`/${id}`)}
          title={collapsed ? label : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            {#if id === "market"}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 6h13M5 9.5h6"/></svg>
            {:else if id === "discovery"}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5z"/></svg>
            {:else if id === "cases"}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5z"/></svg>
            {:else if id === "review"}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M5 8.5l2 2 4-5"/></svg>
            {:else if id === "corpus"}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 2.5h4.5A2 2 0 0 1 8.5 4.5V14a1.5 1.5 0 0 0-1.5-1.5H2zM14 2.5H9.5A2 2 0 0 0 7.5 4.5V14a1.5 1.5 0 0 1 1.5-1.5H14z"/></svg>
            {:else}
              <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="3" cy="8" r="1.8"/><circle cx="13" cy="3.5" r="1.8"/><circle cx="13" cy="12.5" r="1.8"/><path d="M4.6 7.2l6.8-3M4.6 8.8l6.8 3"/></svg>
            {/if}
          </span>
          {#if !collapsed}
            <span class="nav-label">{label}</span>
          {/if}
          {#if (id === "cases" || id === "review") && reviewingCount !== null && reviewingCount > 0}
            <span class="nav-badge" class:nav-dot={collapsed}>{reviewingCount}</span>
          {/if}
        </button>
      {/each}
    </nav>

    <!-- 主列：FIXTURE 横幅（Topbar 之上）+ Topbar + 内容区 -->
    <div class="main">
      {#if effectiveMode === "fixture"}
        <div class="fixture-bar" role="status">
          <span>⚠ 当前为 Fixture 数据——所有 Cases/Runs 相关内容为演示数据</span>
        </div>
      {/if}

      <header class="topbar">
        <button class="icon-btn" onclick={toggleNav} aria-label="折叠导航" title={collapsed ? "展开导航" : "折叠导航"}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></svg>
        </button>

        <input
          class="input input-mono global-search"
          type="search"
          placeholder="搜索股票代码 / 名称 / Case ID / Episode"
          bind:value={searchInput}
          onkeydown={onSearchKeydown}
          aria-label="全局搜索"
        />

        <div class="topbar-spacer"></div>

        <!-- Run 状态灯 -->
        {#if runLight.kind === "fixture"}
          <span class="run-light" title="Fixture：无真实运行">
            <span class="run-dot run-dot-fixture"></span><span class="run-light-text">Fixture：无真实运行</span>
          </span>
        {:else if runLight.kind === "running"}
          <button class="run-light run-light-btn" onclick={() => goRuns("running")} title="有运行中的 Agent Run">
            <span class="run-dot run-dot-running"></span><span class="run-light-text">运行中 {runsRunning}</span>
          </button>
        {:else if runLight.kind === "failed"}
          <button class="run-light run-light-btn" onclick={() => goRuns("failed")} title="最近一次 Run 失败">
            <span class="run-dot run-dot-failed"></span><span class="run-light-text">{runLight.count} 失败</span>
          </button>
        {:else if runLight.kind === "ok"}
          <button class="run-light run-light-btn" onclick={() => goRuns()} title={runLight.at ? `上次完成时间 ${runLight.at}` : "全部成功"}>
            <span class="run-dot run-dot-ok"></span><span class="run-light-text">空闲</span>
          </button>
        {/if}

        <!-- 数据模式分段控件（域锁定时禁用 + tooltip） -->
        <div class="mode-switch" class:mode-locked={!!lockReason} title={lockReason ?? undefined}>
          <button
            class="mode-opt"
            class:mode-active={effectiveMode === "real"}
            disabled={!!lockReason}
            onclick={() => onModeClick("real")}>REAL</button>
          <button
            class="mode-opt"
            class:mode-active={effectiveMode === "fixture"}
            disabled={!!lockReason}
            onclick={() => onModeClick("fixture")}>FIXTURE</button>
        </div>

        <span class="avatar" aria-label="用户">T</span>
      </header>

      <main class="content">
        {#if router.href === "/market"}
          <MarketPage />
        {:else if router.href === "/discovery"}
          <DiscoveryPage />
        {:else if router.href.startsWith("/cases") && caseIdMatch}
          {@render placeholder(`Case ${caseIdMatch[1]}`, true, "Case Workspace 详情页在批次 C 实现：摘要块 + 五个 Tab（Overview / Companies / Evidence / Judgment & Critic / Versions & Observations）。")}
        {:else if router.href === "/cases"}
          <CasesPage />
        {:else if router.href === "/review"}
          {@render placeholder("Review", true, "审核工作区在批次 C 实现：左栏摘要 + 右栏审查面板 + 吸底操作栏（Request Changes / Reject / Approve & Freeze）。")}
        {:else if router.href === "/corpus"}
          {@render placeholder("Corpus", true, "已冻结 Case 库在批次 C 实现：Cases 列表变体（默认 Frozen/Observing/Completed/Rejected）+ 只读详情。")}
        {:else if router.href.startsWith("/runs")}
          {@render placeholder("Agent Runs", true, "Run 列表与阶段流水 Drawer 在批次 C 实现。")}
        {:else if router.href === "/search"}
          {@render placeholder("搜索结果", false, "全局搜索结果页在批次 C 实现：涨停观察（REAL）/ Episode（REAL）/ Case（FIXTURE）/ Run（FIXTURE）四组，各 5 条。")}
        {:else}
          <div class="panel"><div class="empty-state">页面不存在 · <a href="/market" onclick={(e) => { e.preventDefault(); navigate("/market"); }}>返回 Market</a></div></div>
        {/if}
      </main>
    </div>
  </div>
</div>

<!-- 全局 Toast（右下） -->
<div class="toast-stack" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast toast-{t.kind}">{t.text}</div>
  {/each}
</div>

{#snippet placeholder(title: string, isFixture: boolean, note: string)}
  <section class="panel page-placeholder">
    <div class="panel-head">
      <h1 class="page-title">{title}</h1>
      {#if isFixture}
        <span class="badge-fixture">FIXTURE</span>
      {/if}
    </div>
    <div class="placeholder-body">
      <p class="prose">{note}</p>
      <p class="ts">当前生效模式：{effectiveMode === "real" ? "REAL" : "FIXTURE"}{lockReason ? `（${lockReason}）` : ""}</p>
    </div>
  </section>
{/snippet}

<style>
  /* 全局骨架 */
  .app {
    min-height: 100vh;
    display: flex;
  }
  .shell {
    display: flex;
    width: 100%;
    min-height: 100vh;
  }

  /* 左侧导航 220/64（Phase 2 §1.2） */
  .sidenav {
    width: var(--nav-w);
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    background: var(--bg-panel);
    border-right: 1px solid var(--border-default);
    transition: width 120ms ease;
  }
  .sidenav.collapsed {
    width: var(--nav-w-collapsed);
  }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-body);
    text-align: left;
    white-space: nowrap;
  }
  .nav-item:hover {
    background: var(--bg-subtle);
  }
  /* 选中态：左侧 2px accent 竖条 + 浅蓝底（仅颜色+位置区分，同时有文字） */
  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--text-primary);
    box-shadow: inset 2px 0 0 var(--accent-primary);
  }
  .nav-icon {
    display: inline-flex;
    flex: none;
  }
  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nav-badge {
    margin-left: auto;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent-primary);
    color: var(--text-on-accent);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }
  /* 折叠态：badge 缩为图标右上角小圆点 */
  .sidenav.collapsed .nav-item {
    justify-content: center;
    padding: 0;
  }
  .sidenav.collapsed .nav-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    margin: 0;
    min-width: 8px;
    width: 8px;
    height: 8px;
    padding: 0;
    font-size: 0;
  }

  /* 主列 */
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* Topbar 56px（Phase 2 §1.3） */
  .topbar {
    height: var(--topbar-h);
    flex: none;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 24px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-default);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
  }
  .icon-btn:hover {
    background: var(--bg-subtle);
  }
  .global-search {
    width: 360px;
  }
  .topbar-spacer {
    flex: 1;
  }

  /* Run 状态灯（8px 圆点 + 文字，不单靠颜色） */
  .run-light {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-caption);
  }
  .run-light-btn {
    border-radius: var(--radius-control);
  }
  .run-light-btn:hover {
    background: var(--bg-subtle);
  }
  .run-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .run-dot-fixture { background: var(--text-tertiary); }
  .run-dot-running { background: var(--status-running); animation: pulse 2s ease-in-out infinite; }
  .run-dot-failed  { background: var(--status-error); }
  .run-dot-ok      { background: var(--status-success); }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* 模式分段控件 */
  .mode-switch {
    display: inline-flex;
    height: 28px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    overflow: hidden;
  }
  .mode-opt {
    height: 100%;
    padding: 0 12px;
    border: none;
    background: var(--bg-panel);
    color: var(--text-tertiary);
    font-size: var(--text-caption);
    letter-spacing: 0.04em;
  }
  .mode-opt + .mode-opt {
    border-left: 1px solid var(--border-default);
  }
  .mode-opt.mode-active {
    background: var(--bg-inset);
    color: var(--text-primary);
    font-weight: 600;
  }
  .mode-locked .mode-opt {
    cursor: not-allowed;
    color: var(--text-tertiary);
  }

  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-subtle);
    color: var(--accent-primary);
    font-size: var(--text-caption);
    font-weight: 600;
  }

  /* 内容区：fluid，页面左右 padding 24px */
  .content {
    flex: 1;
    padding: 24px;
    min-width: 0;
  }

  /* 页面占位（批次 B/C 替换） */
  .page-placeholder .page-title {
    font-size: var(--text-display);
    line-height: var(--lh-display);
    font-weight: 600;
    color: var(--text-primary);
  }
  .placeholder-body {
    padding: 24px 16px;
  }
</style>
