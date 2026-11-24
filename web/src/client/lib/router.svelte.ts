// web/src/client/lib/router.svelte.ts
// 轻量路由 store（location + history API，无路由库）：App 骨架与页面共享导航能力。

export const router = $state({ href: location.pathname, search: location.search });

function sync(): void {
  router.href = location.pathname;
  router.search = location.search;
}

window.addEventListener("popstate", sync);

/** 页面跳转（pushState；replace=true 用于重定向/筛选类替换） */
export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  sync();
}

/** 仅更新当前路径的 query 参数（默认 replace：筛选类状态不产生历史栈） */
export function setQuery(patch: Record<string, string | null | undefined>, replace = true): void {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  navigate(`${u.pathname}${u.search}${u.hash}`, replace);
}
