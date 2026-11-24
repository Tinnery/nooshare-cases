<!-- web/src/client/components/Drawer.svelte -->
<!-- 详情 Drawer 容器（Phase 1 §5.3）：三档宽度 480/720/960，右侧滑入，ESC/遮罩关闭。
     响应式降档（Phase 2 §6）：1024–1440 降一档；<1024 全宽覆盖。 -->
<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    /** 三档宽度：480（轻量元数据）/ 720（默认详情）/ 960（审阅） */
    width?: 480 | 720 | 960;
    title: string;
    /** 模式徽章：real = REAL DATA 描边 / fixture = FIXTURE 琥珀 / null 不显示 */
    badge?: "real" | "fixture" | null;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let { open, width = 720, title, badge = null, onClose, children, footer }: Props = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="drawer-mask" onclick={onClose} aria-hidden="true"></div>
  <div
    class="drawer"
    style="--drawer-w: {width}px"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <div class="drawer-head">
      <div class="drawer-head-left">
        <h2 class="drawer-title">{title}</h2>
        {#if badge === "fixture"}
          <span class="badge-fixture">FIXTURE</span>
        {:else if badge === "real"}
          <span class="badge-real">REAL DATA</span>
        {/if}
      </div>
      <button class="drawer-close" onclick={onClose} aria-label="关闭详情">✕</button>
    </div>
    <div class="drawer-body">
      {@render children()}
    </div>
    {#if footer}
      <div class="drawer-foot">
        {@render footer()}
      </div>
    {/if}
  </div>
{/if}

<style>
  .drawer {
    width: var(--drawer-w, 720px);
  }
  .drawer-head-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .drawer-title {
    font-size: var(--text-title);
    line-height: var(--lh-title);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: none;
    border: none;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-body);
  }
  .drawer-close:hover {
    background: var(--bg-subtle);
    color: var(--text-primary);
  }

  /* 响应式降档（Phase 2 §6）：1024–1440 降一档 */
  @media (max-width: 1439px) and (min-width: 1024px) {
    .drawer[style*="--drawer-w: 960px"] { width: 720px; }
    .drawer[style*="--drawer-w: 720px"] { width: 480px; }
  }
  /* <1024：全宽覆盖 */
  @media (max-width: 1023px) {
    .drawer { width: 100vw; }
  }
</style>
