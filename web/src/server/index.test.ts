import { test, expect } from "bun:test";

test("server entry module loads", async () => {
  // index.ts 顶层直接 Bun.serve，模块加载即入口；此处仅验证可导入无语法错误
  const mod = await import("./index");
  expect(mod).toBeDefined();
});
