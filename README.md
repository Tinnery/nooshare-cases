# nooshare-cases

NooShare Matrix 案例与用例管理。

## 架构

- **Web 后端**：FastAPI + asyncpg（nooshare_cases/web/）
- **Web 前端**：Svelte 5 + Vite（web/src/client/）
- **Python CLI**：案例管理命令行工具（nooshare_cases/）

**注意**：web/src/server/ 中的 Bun server 已退役，不再使用。FastAPI 是唯一的 Web 服务入口。

## 快速开始

### Web 服务

    # 安装前端依赖
    cd web
    bun install

    # 构建前端
    bun run build

    # 启动 FastAPI 服务
    cd ..
    uv sync
    uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000

访问 http://localhost:3000

### Python CLI

    uv venv
    uv sync --extra dev
    uv run nooshare-cases

## 开发

### 前端开发

    cd web
    bun install
    bun run dev:client  # 启动 Vite 开发服务器（端口 5173）

前端开发服务器会自动代理 API 请求到 FastAPI（端口 3000）。

### 后端开发

    uv sync
    uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000

FastAPI 提供自动 API 文档：http://localhost:3000/docs

## 测试

    # Python 测试（FastAPI 端点）
    uv run pytest

    # 前端测试
    cd web && bun test

## 技术栈

| 组件 | 技术 |
|------|------|
| Web 后端 | FastAPI + asyncpg |
| Web 前端 | Svelte 5 + Vite |
| 前端构建 | Bun（仅用于依赖管理和构建） |
| 数据库 | PostgreSQL |
| Python 包管理 | uv |

## API 端点

| 路径 | 说明 |
|------|------|
| /api/limitup/* | 涨停观察 |
| /api/discovery/* | Discovery 队列 |
| /api/cases | Case 列表 |
| /api/cases/:id | Case 详情 |
| /api/cases/:id/review | 审核操作 |
| /api/cases/:id/observations | 追加观察 |
| /api/runs | Agent Run 列表 |
| /api/runs/:id | Agent Run 详情 |
| /api/search | 全局搜索 |
| /health | 健康检查 |
