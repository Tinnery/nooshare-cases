// web/src/client/lib/toast.svelte.ts
// 全局 Toast store（runes）：App 骨架渲染 .toast-stack，任意模块调用 toast() 推送。

export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "success" | "warning" | "error";
}

export const toasts = $state<{ items: ToastItem[] }>({ items: [] });

let seq = 0;

/** 推送一条 toast，4s 自动消失 */
export function toast(text: string, kind: ToastItem["kind"] = "info"): void {
  const id = ++seq;
  toasts.items.push({ id, text, kind });
  setTimeout(() => {
    const i = toasts.items.findIndex((t) => t.id === id);
    if (i >= 0) toasts.items.splice(i, 1);
  }, 4000);
}
