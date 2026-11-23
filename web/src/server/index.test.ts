import { test, expect } from "bun:test";
import { startServer } from "./index";

test("server entry exists", () => {
  expect(typeof startServer).toBe("function");
});
