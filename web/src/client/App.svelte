<!-- web/src/client/App.svelte -->
<!-- 精简版：仅保留涨停观察页面 -->
<script lang="ts">
  import { router, navigate } from "./lib/router.svelte";
  import { toasts } from "./lib/toast.svelte";
  import LimitUpPage from "./pages/LimitUpPage.svelte";

  // ---------- 轻量路由 ----------
  window.addEventListener("popstate", () => {});

  // / → 重定向 /limitup
  $effect(() => {
    if (router.href === "/") navigate("/limitup", true);
  });

  // ---------- 导航折叠（220/64，持久化） ----------
  const NAV_KEY = "nooshare.nav.collapsed";
  let collapsed = $state(false);
  try {
    collapsed = localStorage.getItem(NAV_KEY) === "1";
  } catch { /* 忽略 */ }
  function toggleNav(): void {
    collapsed = !collapsed;
    try { localStorage.setItem(NAV_KEY, collapsed ? "1" : "0"); } catch { /* 忽略 */ }
  }
</script>

<div class="app">
  <div class="shell">
    <!-- 左侧导航 -->
    <nav class="sidenav" class:collapsed aria-label="主导航">
      <button class="nav-item active" title={collapsed ? "涨停" : undefined}>
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 2v12M4 6l4-4 4 4"/>
          </svg>
        </span>
        {#if !collapsed}
          <span class="nav-label">涨停</span>
        {/if}
      </button>
    </nav>

    <!-- 主列 -->
    <div class="main">
      <header class="topbar">
        <button class="icon-btn" onclick={toggleNav} aria-label="折叠导航" title={collapsed ? "展开导航" : "折叠导航"}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></svg>
        </button>
        <span class="topbar-title">涨停观察</span>
        <div class="topbar-spacer"></div>
        <span class="avatar" aria-label="用户">T</span>
      </header>

      <main class="content">
        <LimitUpPage />
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

<style>
  .app { min-height: 100vh; display: flex; }
  .shell { display: flex; width: 100%; min-height: 100vh; }

  /* 左侧导航 */
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
  .sidenav.collapsed { width: var(--nav-w-collapsed); }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 40px;
    padding: 0 12px;
    border: none;
    border-radius: var(--radius-control);
    background: var(--accent-subtle);
    color: var(--text-primary);
    font-size: var(--text-body);
    text-align: left;
    white-space: nowrap;
    box-shadow: inset 2px 0 0 var(--accent-primary);
  }
  .nav-item:hover { background: var(--accent-subtle); }
  .nav-icon { display: inline-flex; flex: none; }
  .nav-label { overflow: hidden; text-overflow: ellipsis; }
  .sidenav.collapsed .nav-item { justify-content: center; padding: 0; }

  /* 主列 */
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  /* Topbar */
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
  .icon-btn:hover { background: var(--bg-subtle); }
  .topbar-title {
    font-size: var(--text-body);
    font-weight: 600;
    color: var(--text-primary);
  }
  .topbar-spacer { flex: 1; }
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

  /* 内容区 */
  .content { flex: 1; padding: 24px; min-width: 0; }
</style>
