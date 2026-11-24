<!-- web/src/client/components/DataTable.svelte -->
<!-- 通用数据表：排序 / 虚拟滚动（>200 行启用）/ footer 计数 / 选中态 / FIXTURE hatch 条。
     行高 40 默认，rowHeight=32 为紧凑模式；自定义单元格经 cell snippet 注入。 -->
<script module lang="ts">
  // 列定义（module script 导出，供页面 import type）
  export interface TableColumn<T> {
    key: string;
    label: string;
    width?: string;
    align?: "left" | "right";
    mono?: boolean;
    /** 排序取值函数；提供后表头可点击排序 */
    sort?: (row: T) => number | string | null;
    /** 默认单元格文本（未传 cell snippet 时使用） */
    text?: (row: T) => string;
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  interface Props {
    rows: T[];
    columns: TableColumn<T>[];
    keyOf: (row: T) => string;
    rowHeight?: number; // 40 默认 / 32 紧凑
    selectedKey?: string | null;
    onRowClick?: (row: T) => void;
    initialSortKey?: string | null;
    initialSortDir?: "asc" | "desc";
    onSortChange?: (key: string, dir: "asc" | "desc") => void;
    footerLeft?: string;
    /** 行数多时启用虚拟滚动 */
    virtualize?: boolean;
    /** 虚拟滚动视口高度（px） */
    maxHeight?: number;
    emptyText?: string;
    /** FIXTURE 模式表头 hatch 纹理条（Phase 2 §5.2 第三层防线） */
    hatch?: boolean;
    /** 自定义单元格渲染 */
    cell?: Snippet<[T, TableColumn<T>]>;
  }

  let {
    rows,
    columns,
    keyOf,
    rowHeight = 40,
    selectedKey = null,
    onRowClick,
    initialSortKey = null,
    initialSortDir = "desc",
    onSortChange,
    footerLeft = "",
    virtualize = false,
    maxHeight = 480,
    emptyText = "暂无数据",
    hatch = false,
    cell,
  }: Props = $props();

  // ---------- 排序 ----------
  let sortKey = $state<string | null>(initialSortKey);
  let sortDir = $state<"asc" | "desc">(initialSortDir);

  const sortedRows = $derived.by(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sort!(a);
      const vb = col.sort!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  });

  function toggleSort(col: TableColumn<T>): void {
    if (!col.sort) return;
    if (sortKey === col.key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = col.key;
      sortDir = "desc";
    }
    onSortChange?.(sortKey, sortDir);
  }

  // ---------- 虚拟滚动（行高一致的窗口化渲染，overscan 8） ----------
  let scrollTop = $state(0);
  const start = $derived(virtualize ? Math.max(0, Math.floor(scrollTop / rowHeight) - 8) : 0);
  const end = $derived(
    virtualize
      ? Math.min(sortedRows.length, Math.ceil((scrollTop + maxHeight) / rowHeight) + 8)
      : sortedRows.length
  );
  const visible = $derived(virtualize ? sortedRows.slice(start, end) : sortedRows);

  function onScroll(e: Event): void {
    scrollTop = (e.target as HTMLElement).scrollTop;
  }
</script>

<div class="dt-wrap">
  {#if hatch}
    <div class="hatch-bar"></div>
  {/if}
  <div
    class="dt-scroll"
    style:max-height={virtualize ? `${maxHeight}px` : undefined}
    onscroll={onScroll}
  >
    <table class="table" class:table-compact={rowHeight === 32}>
      <thead>
        <tr>
          {#each columns as col (col.key)}
            <th
              class={col.align === "right" ? "num" : ""}
              style:width={col.width ?? undefined}
            >
              {#if col.sort}
                <button
                  class="th-sort"
                  class:th-active={sortKey === col.key}
                  onclick={() => toggleSort(col)}
                >
                  {col.label}
                  {#if sortKey === col.key}
                    <span class="th-arrow" aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>
                  {/if}
                </button>
              {:else}
                {col.label}
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#if visible.length === 0}
          <tr>
            <td colspan={columns.length} style="padding:0;border:none">
              <div class="empty-state">{emptyText}</div>
            </td>
          </tr>
        {:else}
          {#if virtualize && start > 0}
            <tr aria-hidden="true" style="height:{start * rowHeight}px"><td colspan={columns.length} style="padding:0;border:none"></td></tr>
          {/if}
          {#each visible as row (keyOf(row))}
            <tr
              class="clickable"
              class:selected={selectedKey !== null && keyOf(row) === selectedKey}
              onclick={() => onRowClick?.(row)}
            >
              {#each columns as col (col.key)}
                <td class={col.align === "right" ? "num" : ""}>
                  {#if cell}
                    {@render cell(row, col)}
                  {:else}
                    <span class={col.mono ? "mono" : undefined}>{col.text?.(row) ?? ""}</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
          {#if virtualize && end < sortedRows.length}
            <tr aria-hidden="true" style="height:{(sortedRows.length - end) * rowHeight}px"><td colspan={columns.length} style="padding:0;border:none"></td></tr>
          {/if}
        {/if}
      </tbody>
    </table>
  </div>
  <div class="table-footer">
    <span>{footerLeft}</span>
    <span>显示 {sortedRows.length === 0 ? 0 : start + 1}–{end} / 共 {sortedRows.length} 行</span>
  </div>
</div>

<style>
  .dt-wrap {
    background: var(--bg-panel);
  }
  .dt-scroll {
    overflow-y: auto;
  }
  /* 排序表头：仅当前排序列显示箭头，激活列头文字变 accent（Phase 1 §5.1） */
  .th-sort {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    color: inherit;
  }
  .th-sort:hover {
    color: var(--text-primary);
  }
  .th-sort.th-active {
    color: var(--accent-primary);
  }
  .th-arrow {
    font-size: 12px;
  }
</style>
