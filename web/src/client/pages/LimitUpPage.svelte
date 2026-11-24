<!-- web/src/client/pages/LimitUpPage.svelte -->
<!-- 涨停数据展示页：日期选择 + 统计概览 + 龙头股排行 + 全部涨停列表 -->
<script lang="ts">
  import { get } from "../lib/api";
  import { router, setQuery } from "../lib/router.svelte";
  import { signedPct, fmtPrice, fmtYi, fmtRatio } from "../lib/format";

  // ---------- 数据层 ----------
  interface DateInfo {
    trade_date: string;
    stock_count: number;
    continuous_count: number;
    max_continuous_days: number;
  }

  interface LimitUpStock {
    stock_code: string;
    stock_name: string | null;
    trade_date: string;
    latest_price: number | null;
    change_pct: number | null;
    limit_up_status: string | null;
    limit_up_type: string | null;
    limit_up_seal_amount: number | null;
    limit_up_seal_volume: number | null;
    first_limit_up_time: string | null;
    continuous_days: number | null;
    limit_up_open_count: number | null;
    limit_up_reason: string | null;
    days_boards: string | null;
    market_type: string | null;
    circulating_market_cap: number | null;
    seal_vol_ratio: number | null;
    seal_cap_ratio: number | null;
  }

  interface DailyData {
    trade_date: string;
    total_count: number;
    continuous_count: number;
    max_continuous_days: number;
    top_leaders: LimitUpStock[];
    all_stocks: LimitUpStock[];
  }

  interface LeaderStock extends LimitUpStock {
    leader_score: number;
    height_score: number;
    seal_score: number;
    time_weight: number;
  }

  interface LeadersData {
    trade_date: string;
    leaders: LeaderStock[];
  }

  let datesInfo = $state<DateInfo[]>([]);
  let selectedDate = $state<string | null>(null);
  let dailyData = $state<DailyData | null>(null);
  let leadersData = $state<LeadersData | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // ---------- 初始化 ----------
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    const params = new URLSearchParams(router.search);
    const dateParam = params.get("date");
    loadDates(dateParam);
  });

  // ---------- 加载日期列表 ----------
  async function loadDates(initialDate?: string | null): Promise<void> {
    try {
      datesInfo = await get<DateInfo[]>("/api/limitup/dates?limit=30");
      if (datesInfo.length === 0) {
        error = "无涨停数据";
        return;
      }
      const targetDate = initialDate || datesInfo[0].trade_date;
      await loadDay(targetDate);
    } catch (e) {
      error = e instanceof Error ? e.message : "加载日期列表失败";
    }
  }

  // ---------- 加载指定日期数据 ----------
  async function loadDay(date: string): Promise<void> {
    selectedDate = date;
    loading = true;
    error = null;
    try {
      const [daily, leaders] = await Promise.all([
        get<DailyData>(`/api/limitup/daily?trade_date=${date}`),
        get<LeadersData>(`/api/limitup/leaders?trade_date=${date}&top_n=10`),
      ]);
      dailyData = daily;
      leadersData = leaders;
      setQuery({ date });
    } catch (e) {
      error = e instanceof Error ? e.message : "加载涨停数据失败";
    } finally {
      loading = false;
    }
  }

  // ---------- 日期导航 ----------
  function onDateChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (v) loadDay(v);
  }

  function shiftDate(delta: number): void {
    if (!selectedDate) return;
    const i = datesInfo.findIndex((d) => d.trade_date === selectedDate);
    const next = datesInfo[i - delta];
    if (next) loadDay(next.trade_date);
  }

  // ---------- 格式化辅助 ----------
  function fmtTime(t: string | null): string {
    if (!t) return "—";
    return t.trim();
  }

  function boardClass(days: number | null): string {
    if (days == null) return "";
    if (days >= 5) return "board-high";
    if (days >= 3) return "board-mid";
    if (days >= 2) return "board-low";
    return "";
  }
</script>

<section class="panel">
  <div class="panel-head">
    <h1 class="page-title">涨停观察</h1>
    <div class="date-nav">
      <button class="icon-btn" onclick={() => shiftDate(-1)} disabled={!selectedDate || datesInfo.length === 0 || datesInfo[0].trade_date === selectedDate}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10 3L5 8l5 5"/>
        </svg>
      </button>
      <select class="input input-mono" value={selectedDate || ""} onchange={onDateChange}>
        {#each datesInfo as d}
          <option value={d.trade_date}>{d.trade_date}</option>
        {/each}
      </select>
      <button class="icon-btn" onclick={() => shiftDate(1)} disabled={!selectedDate || datesInfo.length === 0 || datesInfo[datesInfo.length - 1].trade_date === selectedDate}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 3l5 5-5 5"/>
        </svg>
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-state">{error}</div>
  {:else if loading && !dailyData}
    <div class="loading-state">加载中...</div>
  {:else if dailyData}
    <!-- 统计概览 -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-label">涨停股数</span>
        <span class="stat-value">{dailyData.total_count}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">连板股数</span>
        <span class="stat-value">{dailyData.continuous_count}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">最高连板</span>
        <span class="stat-value stat-highlight">{dailyData.max_continuous_days}板</span>
      </div>
    </div>

    <!-- 龙头股排行 -->
    {#if leadersData && leadersData.leaders.length > 0}
      <div class="section">
        <h2 class="section-title">龙头股排行</h2>
        <div class="leaders-grid">
          {#each leadersData.leaders.slice(0, 6) as leader, i}
            <div class="leader-card">
              <div class="leader-rank">#{i + 1}</div>
              <div class="leader-info">
                <div class="leader-code">{leader.stock_code}</div>
                <div class="leader-name">{leader.stock_name || "—"}</div>
              </div>
              <div class="leader-stats">
                <div class="leader-boards {boardClass(leader.continuous_days)}">
                  {leader.continuous_days}板
                </div>
                <div class="leader-score">{leader.leader_score.toFixed(0)}分</div>
              </div>
              <div class="leader-reason" title={leader.limit_up_reason || ""}>
                {leader.limit_up_reason || "—"}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- 全部涨停股列表 -->
    <div class="section">
      <h2 class="section-title">全部涨停股（{dailyData.all_stocks.length}）</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="col-code">代码</th>
              <th class="col-name">名称</th>
              <th class="col-num">最新价</th>
              <th class="col-num">涨幅</th>
              <th class="col-num">连板</th>
              <th class="col-time">首板时间</th>
              <th class="col-num">封单额</th>
              <th class="col-num">封成比</th>
              <th class="col-reason">涨停原因</th>
            </tr>
          </thead>
          <tbody>
            {#each dailyData.all_stocks as stock}
              <tr>
                <td class="col-code mono">{stock.stock_code}</td>
                <td class="col-name">{stock.stock_name || "—"}</td>
                <td class="col-num mono">{fmtPrice(stock.latest_price)}</td>
                <td class="col-num mono {stock.change_pct && stock.change_pct > 0 ? 'up' : stock.change_pct && stock.change_pct < 0 ? 'down' : ''}">
                  {signedPct(stock.change_pct)}
                </td>
                <td class="col-num">
                  <span class="board-tag {boardClass(stock.continuous_days)}">
                    {stock.continuous_days ?? "—"}
                  </span>
                </td>
                <td class="col-time mono">{fmtTime(stock.first_limit_up_time)}</td>
                <td class="col-num mono">{fmtYi(stock.limit_up_seal_amount)}</td>
                <td class="col-num mono">{fmtRatio(stock.seal_vol_ratio)}</td>
                <td class="col-reason" title={stock.limit_up_reason || ""}>
                  {stock.limit_up_reason || "—"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</section>

<style>
  .panel {
    background: var(--bg-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-panel);
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  .page-title {
    font-size: var(--text-display);
    line-height: var(--lh-display);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  /* 日期导航 */
  .date-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--bg-subtle);
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .date-nav select {
    width: 140px;
  }

  /* 状态提示 */
  .error-state,
  .loading-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-secondary);
  }
  .error-state {
    color: var(--status-error);
  }

  /* 统计概览 */
  .stats-bar {
    display: flex;
    gap: 24px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat-label {
    font-size: var(--text-caption);
    color: var(--text-tertiary);
  }
  .stat-value {
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--text-primary);
  }
  .stat-highlight {
    color: var(--accent-primary);
  }

  /* 区块 */
  .section {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  .section:last-child {
    border-bottom: none;
  }
  .section-title {
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px 0;
  }

  /* 龙头股卡片 */
  .leaders-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .leader-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: var(--bg-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-control);
  }
  .leader-rank {
    font-size: var(--text-caption);
    font-weight: 700;
    color: var(--accent-primary);
  }
  .leader-info {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .leader-code {
    font-family: var(--font-mono);
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--text-primary);
  }
  .leader-name {
    font-size: var(--text-caption);
    color: var(--text-secondary);
  }
  .leader-stats {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .leader-boards {
    font-size: var(--text-caption);
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg-subtle);
  }
  .leader-boards.board-high {
    background: var(--status-error);
    color: white;
  }
  .leader-boards.board-mid {
    background: var(--status-warning);
    color: white;
  }
  .leader-boards.board-low {
    background: var(--accent-primary);
    color: white;
  }
  .leader-score {
    font-size: var(--text-caption);
    color: var(--text-secondary);
  }
  .leader-reason {
    font-size: var(--text-caption);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 数据表格 */
  .table-wrap {
    overflow-x: auto;
  }
  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-body);
  }
  .data-table th,
  .data-table td {
    padding: 10px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border-default);
  }
  .data-table th {
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-inset);
    white-space: nowrap;
  }
  .data-table tbody tr:hover {
    background: var(--bg-subtle);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .up {
    color: var(--status-error);
  }
  .down {
    color: var(--status-success);
  }
  .col-code {
    width: 80px;
  }
  .col-name {
    width: 100px;
  }
  .col-num {
    width: 80px;
    text-align: right;
  }
  .col-time {
    width: 90px;
  }
  .col-reason {
    min-width: 200px;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .board-tag {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: var(--text-caption);
    font-weight: 600;
    background: var(--bg-subtle);
  }
  .board-tag.board-high {
    background: var(--status-error);
    color: white;
  }
  .board-tag.board-mid {
    background: var(--status-warning);
    color: white;
  }
  .board-tag.board-low {
    background: var(--accent-primary);
    color: white;
  }
</style>
