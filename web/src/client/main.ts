// web/src/client/main.ts
// Svelte 5 挂载入口（runes 模式，mount API）
import { mount } from "svelte";
import "./tokens.css";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
