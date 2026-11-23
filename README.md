# nooshare-cases

NooShare Matrix 案例与用例管理。

## 组件

- **Python 后端**：案例管理 CLI（`nooshare_cases/`）
- **Web UI**：Bun + Svelte 全栈界面（`web/`）

## 快速开始

### Python CLI

```bash
uv venv
uv sync --extra dev
uv run nooshare-cases
```

### Web UI

```bash
cd web
~/.bun/bin/bun install
~/.bun/bin/bun run dev
```

访问 http://localhost:5173

## 测试

```bash
# Python 测试
uv run pytest

# Web UI 测试
cd web && ~/.bun/bin/bun test
```
