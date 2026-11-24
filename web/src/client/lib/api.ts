// web/src/client/lib/api.ts
// fetch 封装：JSON 编解码、错误统一抛 ApiError、默认超时 10s。

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions extends RequestInit {
  /** 超时毫秒数（默认 10s） */
  timeoutMs?: number;
}

export async function api<T>(path: string, init?: RequestOptions): Promise<T> {
  const { timeoutMs = 10_000, ...rest } = init ?? {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...rest,
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...(rest.headers ?? {}) },
    });
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        /* 非 JSON 响应体保持 null */
      }
    }
    if (!res.ok) {
      const msg =
        (data !== null && typeof data === "object" && "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : undefined) ?? `请求失败（HTTP ${res.status}）`;
      throw new ApiError(msg, res.status);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === "AbortError") throw new ApiError("请求超时（10s）", 0);
    throw new ApiError((err as Error).message || "网络错误", 0);
  } finally {
    clearTimeout(timer);
  }
}

export const get = <T>(path: string): Promise<T> => api<T>(path);

export const post = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
