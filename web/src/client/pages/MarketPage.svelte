<!-- web/src/client/pages/MarketPage.svelte -->
<!-- Market 页（Phase 2 §2.1，REAL 域）：
     ① 日期与筛选栏（48px）→ ② 概况条 → ③ 主题分布表 → ④ 涨停主表 → 行详情 Drawer(720)。
     数据层 useMarketDay：三区块原子刷新；<400ms 不出骨架；日期切换保留搜索/排序、仅重置主题过滤。 -->
<script lang="ts">
  import { get } from "../lib/api";
  import { router, setQuery, navigate } from "../lib/router.svelte";
  import { useMarketDay, type MarketObservation } from "../lib/useMarketDay.svelte";
  import { toast } from "../lib/toast.svelte";
  import { episodeShort, signedPct, pctClass, fmtPrice, fmtYi, fmtRatio, todayStr } from "../lib/format";
  import DataTable, { type TableColumn } from "../components/DataTable.svelte";
  import Drawer from "../components/Drawer.svelte";
  import StatusTag from "../components/StatusTag.svelte";

  // ---------- 数据层 ----------
  const m = useMarketDay();

  // 首次挂载：URL ?date= 优先，否则最近完整交易日；筛选/排序自 URL 恢复
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    const params = new URLSearchParams(router.search);
    const th = params.get("theme");
    if (th) themeFilter = th;
    const q = params.get("q") ?? params.get("code"); // ?code= 来自 Discovery 相关股票回跳
    if (q) codeQuery = q;
    m.loadDates(params.get("date"));
  });

  // ---------- 筛选与排序（日期切换不重置搜索/排序，仅重置主题过滤——由 effect 处理） ----------
  let codeQuery = $state("");
  let themeFilter = $state<string | null>(null);
  let sortKey = $state("seal");
  let sortDir = $state<"asc" | "desc">("desc");

  function onSearchInput(): void {
    setQuery({ q: codeQuery.trim() || null });
  }

  function onSortChange(key: string, dir: "asc" | "desc"): void {
    sortKey = key;
    sortDir = dir;
    setQuery({ sort: key, dir });
  }

  function setThemeFilter(themeId: string | null): void {
    themeFilter = themeId;
    setQuery({ theme: themeId });
  }

  function clearFilters(): void {
    codeQuery = "";
    themeFilter = null;
    sortKey = "seal";
    sortDir = "desc";
    setQuery({ q: null, theme: null, sort: null, dir: null });
  }

  const hasFilters = $derived(codeQuery.trim() !== "" || themeFilter !== null || sortKey !== "seal" || sortDir !== "desc");

  // ---------- 日期导航 ----------
  function onDateChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (!v) return;
    m.loadDay(v);
    setQuery({ date: v });
  }

  function shiftDate(delta: number): void {
    const dates = m.datesInfo?.dates ?? [];
    if (!m.date) return;
    const i = dates.indexOf(m.date);
    // dates 降序（最新在前）：delta=-1 为前一交易日 → 数组索引 +1，故取 i - delta
    const next = dates[i - delta];
    if (next) {
      m.loadDay(next);
      setQuery({ date: next });
    }
  }

  function gotoLatestComplete(): void {
    const d = m.datesInfo?.latestComplete;
    if (d) {
      m.loadDay(d);
      setQuery({ date: d });
    }
  }

  // 完整性指示（data-facts §2.9：P0 按 observation 覆盖判断 → 完整 / 未入库 两态）
  const completeness = $derived.by(() => {
    if (!m.date || !m.datesInfo) return { label: "加载中", cls: "date-loading" };
    return m.datesInfo.dates.includes(m.date)
      ? { label: "完整", cls: "date-ok" }
      : { label: "未入库", cls: "date-missing" };
  });

  // 系统当天晚于最近完整入库日 → 行内琥珀提示（Phase 2 §2.1）
  const staleToday = $derived(
    m.datesInfo?.latestComplete != null && m.datesInfo.latestComplete < todayStr()
  );

  // ---------- 派生：筛选后的观察列表 ----------
  const filteredObs = $derived.by(() => {
    const obs = m.day?.observations ?? [];
    const q = codeQuery.trim().toLowerCase();
    if (!q && !themeFilter) return obs;
    return obs.filter((o) => {
      if (q && !(o.stockCode.includes(q) || (o.name ?? "").toLowerCase().includes(q))) return false;
      if (themeFilter && !o.themes.some((t) => t.themeId === themeFilter)) return false;
      return true;
    });
  });

  // ---------- 跨日期一致性（Phase 2 §3.4） ----------
  // 主题过滤 chip 指向新日期不存在的主题 → 自动清除 + toast
  $effect(() => {
    const d = m.day;
    if (d && themeFilter && !d.themes.some((t) => t.themeId === themeFilter)) {
      themeFilter = null;
      toast("所选主题在当前交易日不存在，主题过滤已清除", "warning");
    }
  });

  // ---------- 详情 Drawer ----------
  interface ObsDetail {
    snapshot: { snapshotId: string; importedAt: string | null } | null;
    observation: MarketObservation & { date: string; rawReason: string | null };
    fragments: { fragment_id: string; fragment_ordinal: number; raw_fragment: string; normalized_fragment: string }[];
    themeMappings: { themeId: string; themeName: string; matchMethod: string; mappingStatus: string }[];
    episodes: { episode_id: string; theme_id: string; status: string; start_date: string; end_date: string }[];
  }

  let drawerCode = $state<string | null>(null);
  let drawerData = $state<ObsDetail | null>(null);
  let drawerLoading = $state(false);
  let drawerError = $state<string | null>(null);

  async function openDrawer(code: string): Promise<void> {
    drawerCode = code;
    drawerData = null;
    drawerError = null;
    drawerLoading = true;
    const snap = m.day?.snapshot?.snapshotId ?? "";
    try {
      drawerData = await get<ObsDetail>(
        `/api/market/observation/${encodeURIComponent(snap)}/${m.date}/${code}`
      );
    } catch (e) {
      drawerError = e instanceof Error ? e.message : "加载观察详情失败";
    } finally {
      drawerLoading = false;
    }
  }

  function closeDrawer(): void {
    drawerCode = null;
    drawerData = null;
    drawerError = null;
  }

  // Drawer 标题：代码 + 名称（打开瞬间先用代码，详情到达后补名称）
  const drawerTitle = $derived(
    drawerCode
      ? `${drawerCode}${drawerData?.observation.name ? ` ${drawerData.observation.name}` : ""}`
      : "观察详情"
  );

  // 选中股票跨日期：新日期无记录则自动关 Drawer + 提示
  $effect(() => {
    const d = m.day;
    if (d && drawerCode && !d.observations.some((o) => o.stockCode === drawerCode)) {
      closeDrawer();
      toast("该股票在所选交易日无涨停记录，详情已关闭", "warning");
    }
  });

  // ---------- 主表列定义 ----------
  const obsCols: TableColumn<MarketObservation>[] = [
    { key: "code", label: "代码", width: "88px", mono: true, text: (r) => r.stockCode },
    { key: "name", label: "名称", width: "110px", text: (r) => r.name ?? "—" },
    { key: "price", label: "最新价", width: "88px", align: "right", sort: (r) => r.latestPrice, text: (r) => fmtPrice(r.latestPrice) },
    { key: "change", label: "涨幅", width: "88px", align: "right", sort: (r) => r.changePct, text: (r) => signedPct(r.changePct) },
    { key: "boards", label: "连板", width: "64px", align: "right", sort: (r) => r.continuousDays, text: (r) => (r.continuousDays == null ? "—" : String(r.continuousDays)) },
    { key: "firstTime", label: "首板时间", width: "96px", mono: true, sort: (r) => r.firstLimitUpTime ?? "", text: (r) => r.firstLimitUpTime ?? "—" },
    { key: "seal", label: "封单额", width: "104px", align: "right", sort: (r) => r.sealAmount, text: (r) => fmtYi(r.sealAmount) },
    { key: "ratio", label: "封成比", width: "88px", align: "right", sort: (r) => r.sealVolRatio, text: (r) => fmtRatio(r.sealVolRatio) },
    { key: "themes", label: "主题", width: "170px" },
    { key: "go", label: "", width: "36px" },
  ];

  // ---------- 主题分布表列定义 ----------
  interface ThemeRowView { themeId: string; themeName: string; mappingStatus: string; stockCount: number; fragmentCount: number; episodes: { episodeId: string; status: string }[] }
  const themeCols: TableColumn<ThemeRowView>[] = [
    { key: "name", label: "主题名", width: "160px", text: (r) => r.themeName },
    { key: "stocks", label: "涉及股票", width: "100px", align: "right", text: (r) => String(r.stockCount) },
    { key: "frags", label: "原始主题片段", width: "130px", align: "right", text: (r) => `${r.fragmentCount} 个原始片段` },
    { key: "mapping", label: "归属", width: "110px" },
    { key: "episode", label: "Episode" },
  ];
</script>

<div class="market">
  {#if m.showSkeleton}
    <!-- 骨架屏：三区块同高占位（Phase 2 §4.1） -->
    <div class="panel"><div class="skeleton" style="height:48px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:64px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:180px;border-radius:0"></div></div>
    <div class="panel"><div class="skeleton" style="height:420px;border-radius:0"></div></div>
  {:else}
    {#if staleToday && m.datesInfo?.latestComplete}
      <div class="stale-bar">今日数据尚未入库，当前展示最近完整交易日 {m.datesInfo.latestComplete}</div>
    {/if}

    {#if m.error}
      <!-- 错误态：面板级内联条 + 重试（日历仍可用，Phase 2 §4.1） -->
      <div class="panel error-panel">
        <span>加载 {m.date ?? ""} 数据失败：{m.error}</span>
        <button class="btn btn-text" onclick={() => (m.date ? m.loadDay(m.date) : gotoLatestComplete())}>重试</button>
      </div>
    {/if}

    <!-- ① 日期与筛选栏（48px） -->
    <div class="filter-bar">
      <div class="date-group">
        <input
          class="input mono"
          type="date"
          value={m.date ?? ""}
          min={m.day?.snapshot?.dateRange[0] ?? undefined}
          max={m.day?.snapshot?.dateRange[1] ?? undefined}
          onchange={onDateChange}
          aria-label="选择交易日"
        />
        <button class="btn" onclick={() => shiftDate(-1)} title="上一交易日">‹</button>
        <button class="btn" onclick={() => shiftDate(1)} title="下一交易日">›</button>
        <span class="date-status {completeness.cls}" title="数据完整性">● {completeness.label}</span>
      </div>

      <input
        class="input input-mono"
        style="width:200px"
        placeholder="搜索股票代码 / 名称"
        bind:value={codeQuery}
        oninput={onSearchInput}
        aria-label="搜索股票"
      />

      {#if themeFilter}
        <span class="chip">
          主题过滤 · {m.day?.themes.find((t) => t.themeId === themeFilter)?.themeName ?? themeFilter}
          <button class="chip-remove" onclick={() => setThemeFilter(null)} aria-label="移除主题过滤">✕</button>
        </span>
      {/if}

      <div class="spacer"></div>

      <span class="ts">共 {m.day?.summary.total ?? 0} 条{filteredObs.length !== (m.day?.summary.total ?? 0) ? ` · 筛选后 ${filteredObs.length} 条` : ""}</span>
      {#if hasFilters}
        <button class="btn-text" onclick={clearFilters}>清除全部</button>
      {/if}
    </div>

    <!-- ② 当日概况条（单行文字型统计，禁止 KPI 卡片） -->
    <div class="panel summary-bar">
      <span class="mono">涨停 <b>{m.day?.summary.total ?? 0}</b> 只</span>
      <span class="sep">·</span>
      <span>连板 <b class="mono">{m.day?.summary.continuousBoards ?? 0}</b></span>
      <span class="sep">·</span>
      <span>最高连板 <b class="mono">{m.day?.summary.maxContinuousDays ?? 0}</b> 天</span>
      <span class="sep">·</span>
      <span>首板 <b class="mono">{m.day?.summary.firstBoards ?? 0}</b></span>
      <span class="sep">·</span>
      <span>覆盖主题 <b class="mono">{m.day?.summary.themesCovered ?? 0}/{m.day?.summary.themesTotal ?? 0}</b></span>
    </div>

    {#if m.day && m.day.observations.length === 0}
      <!-- 空态：一行文字 + 次级动作链接（Phase 2 §4.1） -->
      <div class="panel">
        <div class="empty-state">
          该交易日无涨停记录
          {#if m.datesInfo?.latestComplete && m.date !== m.datesInfo.latestComplete}
            <button class="btn-text" onclick={gotoLatestComplete}>查看最近完整交易日</button>
          {/if}
        </div>
      </div>
    {:else if m.day}
      <!-- ③ 主题分布表（紧凑 32px；点击行 → 主表过滤 + 左缘蓝条高亮） -->
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">主题分布</h2>
          <span class="ts">点击主题行过滤主表</span>
        </div>
        <DataTable
          rows={m.day.themes}
          columns={themeCols}
          rowHeight={32}
          keyOf={(r) => `${r.themeId}:${r.mappingStatus}`}
          selectedKey={themeFilter}
          onRowClick={(r) => setThemeFilter(themeFilter === r.themeId ? null : r.themeId)}
          footerLeft="共 {m.day.themes.length} 个主题映射"
          emptyText="该交易日无主题映射"
        >
          {#snippet cell(row, col)}
            {#if col.key === "mapping"}
              <StatusTag kind="mapping" value={row.mappingStatus} />
            {:else if col.key === "episode"}
              {#if row.episodes.length > 0}
                <span class="ep-cell mono" title={row.episodes[0].episodeId}>
                  {episodeShort(row.episodes[0].episodeId)}
                  <StatusTag kind="episode" value={row.episodes[0].status} />
                </span>
              {:else}
                <span class="none-text">未关联</span>
              {/if}
            {:else if col.mono}
              <span class="mono">{col.text?.(row)}</span>
            {:else}
              {col.text?.(row)}
            {/if}
          {/snippet}
        </DataTable>
      </section>

      <!-- ④ 涨停股票表（紧凑 32px，虚拟滚动 >200 行启用） -->
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">涨停股票</h2>
          {#if themeFilter}
            <span class="ts">已按主题过滤（{filteredObs.length} 条）</span>
          {/if}
        </div>
        <DataTable
          rows={filteredObs}
          columns={obsCols}
          rowHeight={32}
          keyOf={(r) => r.stockCode}
          selectedKey={drawerCode}
          onRowClick={(r) => openDrawer(r.stockCode)}
          initialSortKey={sortKey}
          initialSortDir={sortDir}
          onSortChange={onSortChange}
          virtualize={filteredObs.length > 200}
          maxHeight={480}
          emptyText="无匹配记录"
          footerLeft={`共 ${m.day.summary.total} 条 · 筛选后 ${filteredObs.length} 条`}
        >
          {#snippet cell(row, col)}
            {#if col.key === "change"}
              <span class={pctClass(row.changePct)}>{signedPct(row.changePct)}</span>
            {:else if col.key === "price"}
              <span class="mono">{col.text?.(row)}</span>
            {:else if col.key === "themes"}
              {#if row.themes.length > 0}
                <span class="theme-cell">
                  <span
                    class="theme-tag"
                    class:theme-candidate={row.themes[0].mappingStatus === "candidate"}
                    title={row.themes.map((t) => t.themeName).join(" / ")}
                  >{row.themes[0].themeName}</span>
                  {#if row.themes.length > 1}
                    <span class="ts">+{row.themes.length - 1}</span>
                  {/if}
                </span>
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
  {/if}
</div>

<!-- 详情 Drawer（720，Phase 2 §3.1） -->
<Drawer open={drawerCode !== null} width={720} badge={null} title={drawerTitle} onClose={closeDrawer}>
  {#if drawerLoading}
    <div class="skeleton" style="height:64px;margin-bottom:16px"></div>
    <div class="skeleton" style="height:120px;margin-bottom:16px"></div>
    <div class="skeleton" style="height:96px"></div>
  {:else if drawerError}
    <div class="panel error-panel">
      <span>{drawerError}</span>
      {#if drawerCode}<button class="btn btn-text" onclick={() => openDrawer(drawerCode)}>重试</button>{/if}
    </div>
  {:else if drawerData}
    <!-- 1. 头部：代码 + 名称 + 涨停标签 + 最新价/涨幅 -->
    <div class="drawer-hero">
      <div>
        <span class="mono hero-code">{drawerData.observation.stockCode}</span>
        <span class="hero-name">{drawerData.observation.name ?? "—"}</span>
        {#if drawerData.observation.limitUpStatus}
          <span class="ev-chip">{drawerData.observation.limitUpStatus}</span>
        {/if}
        {#if drawerData.observation.daysBoards}
          <span class="ev-chip">{drawerData.observation.daysBoards}</span>
        {/if}
      </div>
      <div>
        <span class="mono hero-price">{fmtPrice(drawerData.observation.latestPrice)}</span>
        <span class={pctClass(drawerData.observation.changePct)}>{signedPct(drawerData.observation.changePct)}</span>
      </div>
    </div>

    <!-- 2. 行情快照表 -->
    <h3 class="sec-title">行情快照</h3>
    <dl class="dl-grid">
      <dt>首板时间</dt><dd class="mono">{drawerData.observation.firstLimitUpTime ?? "—"}</dd>
      <dt>末次封板</dt><dd class="mono">{drawerData.observation.finalLimitUpTime ?? "—"}</dd>
      <dt>开板次数</dt><dd class="mono">{drawerData.observation.openCount ?? "—"}</dd>
      <dt>封单额</dt><dd class="mono">{fmtYi(drawerData.observation.sealAmount)}</dd>
      <dt>封单量</dt><dd class="mono">{drawerData.observation.sealVolume == null ? "—" : `${drawerData.observation.sealVolume} 股`}</dd>
      <dt>封成比</dt><dd class="mono">{fmtRatio(drawerData.observation.sealVolRatio)}</dd>
      <dt>封单占流通比</dt><dd class="mono">{fmtRatio(drawerData.observation.sealCapRatio)}</dd>
      <dt>流通市值</dt><dd class="mono">{fmtYi(drawerData.observation.circulatingMarketCap)}</dd>
    </dl>

    <!-- 3. 原始问财观察（raw_reason 引用块，左缘 3px 灰条） -->
    <h3 class="sec-title">原始问财观察</h3>
    {#if drawerData.observation.rawReason}
      <blockquote class="raw-quote">{drawerData.observation.rawReason}</blockquote>
    {/if}
    {#if drawerData.fragments.length > 0}
      <ul class="frag-list">
        {#each drawerData.fragments as f (f.fragment_id)}
          <li>
            <span class="mono frag-no">#{f.fragment_ordinal}</span>
            {f.raw_fragment}
            {#if f.normalized_fragment !== f.raw_fragment}
              <span class="ts">→ {f.normalized_fragment}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <!-- 4. 主题映射：原始 vs 标准化（candidate/confirmed 关键区分） -->
    <h3 class="sec-title">主题映射</h3>
    {#if drawerData.themeMappings.length > 0}
      <ul class="map-list">
        {#each drawerData.themeMappings as mp (mp.themeId)}
          <li class="map-item">
            <span>{mp.themeName}</span>
            <span class="ts">{mp.matchMethod}</span>
            <StatusTag kind="mapping" value={mp.mappingStatus} />
          </li>
        {/each}
      </ul>
    {:else}
      <p class="none-text">无主题映射</p>
    {/if}

    <!-- 5. 关联 Episode（→ Discovery 双向带参跳转） -->
    <h3 class="sec-title">关联 Episode</h3>
    {#if drawerData.episodes.length > 0}
      {#each drawerData.episodes as ep (ep.episode_id)}
        <div class="ep-row">
          <span class="mono ep-id" title={ep.episode_id}>{episodeShort(ep.episode_id)}</span>
          <span>{drawerData.themeMappings.find((t) => t.themeId === ep.theme_id)?.themeName ?? ep.theme_id}</span>
          <span class="ts">{ep.start_date} ~ {ep.end_date}</span>
          <StatusTag kind="episode" value={ep.status} />
        </div>
      {/each}
      <button
        class="btn-text ep-link"
        onclick={() => navigate(`/discovery?episode=${drawerData?.episodes[0]?.episode_id ?? ""}&date=${m.date ?? ""}`)}
      >在 Discovery 中查看该热点 →</button>
    {:else}
      <p class="none-text">未关联 Episode</p>
    {/if}

    <!-- 6. 元信息 -->
    <div class="meta-line ts">
      入库时间 {drawerData.observation.refreshedAt ?? "—"} · snapshot
      <span class="mono">{drawerData.snapshot?.snapshotId ?? "—"}</span>
    </div>
  {/if}
</Drawer>

<style>
  .market {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .spacer {
    flex: 1;
  }
  .date-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .date-status {
    font-size: var(--text-caption);
    white-space: nowrap;
  }
  .date-ok { color: var(--status-success); }
  .date-missing { color: var(--text-tertiary); }
  .date-loading { color: var(--text-tertiary); }

  .stale-bar {
    padding: 8px 16px;
    background: var(--status-warning-bg);
    color: var(--status-warning);
    border: 1px solid var(--status-warning);
    border-radius: var(--radius-control);
    font-size: var(--text-body);
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

  /* 概况条：单行内联统计（非卡片） */
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
  .sep { color: var(--border-strong); }

  /* 主题行/单元格 */
  .ep-cell {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-caption);
  }
  .none-text {
    color: var(--text-tertiary);
  }

  /* 主表主题标签 */
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
  }
  .theme-tag.theme-candidate {
    background: var(--status-warning-bg);
    color: var(--status-warning);
  }
  .go-arrow {
    color: var(--text-tertiary);
  }

  /* Drawer 内容 */
  .drawer-hero {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .hero-code {
    font-size: var(--text-title);
    font-weight: 600;
    margin-right: 8px;
  }
  .hero-name {
    font-size: var(--text-heading);
    font-weight: 600;
    margin-right: 8px;
  }
  .hero-price {
    font-size: var(--text-title);
    font-weight: 600;
    margin-right: 6px;
  }
  .sec-title {
    font-size: var(--text-heading);
    font-weight: 600;
    color: var(--text-primary);
    margin: 16px 0 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border-default);
  }
  .dl-grid {
    display: grid;
    grid-template-columns: 110px 1fr 110px 1fr;
    gap: 6px 12px;
  }
  .dl-grid dt {
    font-size: var(--text-caption);
    color: var(--text-tertiary);
  }
  .dl-grid dd {
    font-size: var(--text-table);
    color: var(--text-primary);
  }
  .raw-quote {
    border-left: 3px solid var(--border-strong);
    background: var(--bg-subtle);
    padding: 8px 12px;
    font-size: var(--text-body);
    line-height: var(--lh-body);
    color: var(--text-primary);
  }
  .frag-list {
    list-style: none;
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .frag-no {
    color: var(--text-tertiary);
    margin-right: 6px;
    font-size: var(--text-caption);
  }
  .map-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .map-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: var(--text-body);
  }
  .ep-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: var(--text-body);
  }
  .ep-id {
    font-weight: 600;
  }
  .ep-link {
    margin-top: 8px;
    padding-left: 0;
  }
  .meta-line {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border-default);
  }
</style>
