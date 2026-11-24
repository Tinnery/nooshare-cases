// web/src/server/index.ts
// 主入口：Bun.serve（端口 3000）——API 路由分发 + 静态文件服务（dist/client）+ SPA fallback。
import path from "node:path";
import { routeMarket } from "./api/market";
import { routeDiscovery } from "./api/discovery";
import { routeCases } from "./api/cases";

const PORT = 3000;
// 构建产物目录：vite build 输出 web/dist/client（vite root 为 src/client）
const staticDir = path.resolve(import.meta.dir, "../../dist/client");

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// API 路由表（按域分发；均为 GET/POST 白名单式匹配）
const routes = [routeMarket, routeDiscovery, routeCases];

async function serveStatic(pathname: string): Promise<Response | null> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const fp = path.resolve(staticDir, rel);
  // 防目录穿越：解析后必须仍在 staticDir 内
  if (!fp.startsWith(staticDir + path.sep) && fp !== staticDir) return null;
  const file = Bun.file(fp);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: { "content-type": MIME[path.extname(fp).toLowerCase()] ?? "application/octet-stream" },
  });
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // API：统一 JSON 错误处理
  if (pathname.startsWith("/api/")) {
    try {
      for (const route of routes) {
        const res = await route(req, pathname);
        if (res) return res;
      }
      return json({ error: `接口不存在：${pathname}` }, 404);
    } catch (err) {
      console.error("[api]", pathname, err);
      return json({ error: err instanceof Error ? err.message : "服务内部错误" }, 500);
    }
  }

  // 静态文件
  const staticRes = await serveStatic(pathname);
  if (staticRes) return staticRes;

  // SPA fallback：非 /api 且文件不存在 → index.html（前端路由接管）
  const index = Bun.file(path.join(staticDir, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return json({ error: "静态资源未构建（先执行 bun run build）" }, 404);
}

Bun.serve({ port: PORT, fetch: handle });
console.log(`[server] NooShare Research Workbench 已启动：http://localhost:${PORT}`);
console.log(`[server] 静态目录：${staticDir}`);
