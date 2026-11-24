# nooshare-cases — Agent 工作规则

本仓库负责 NooShare Matrix 案例与用例管理。

## Matrix Authority

- **nooshare-design**：系统角色与跨仓逻辑职责（architecture/matrix.md、architecture/nooshare-cases.md）。
- **nooshare-noos**：适用的已验证知识与工程 invariant。
- **nooshare-workenv**：工作区、主机、部署与操作授权（AGENTS.md、workspace.yaml）。

## Context Bootstrap

任务涉及以下情形时，向上索引对应权威：

| 触发条件 | 索引目标 | 读什么 |
|----------|----------|--------|
| 系统角色 / 跨仓职责变更 | nooshare-design | `architecture/matrix.md`、`architecture/nooshare-cases.md` |
| 工程 invariant / 已验证知识 | nooshare-noos | 相关 domain 文件 |
| 主机 / 部署 / 操作授权变更 | nooshare-workenv | `AGENTS.md` + `workspace.yaml` |

索引路径：通过 `workspace.yaml` 找到目标 Repo 的 checkout 路径，读取对应文件。

## Local Ownership

本仓库拥有：

- 案例管理代码（`nooshare_cases/`）
- CLI 命令（`nooshare_cases/cli.py`）
- 配置（`nooshare_cases/config.py`）
- Web 后端（`web/src/server/`）—— FastAPI 入口，API 路由 + 静态文件服务
- Web 前端（`web/src/client/`）—— Svelte 5 + Vite
- 数据库 Schema（`web/src/server/schema.sql`）—— `cases.*` DDL
- 测试（`tests/`、`web/src/server/index.test.ts`）

上游权威不替代这些本地契约。与权威要求冲突时，向拥有该问题的权威反馈，不在本地悄悄改写权威定义。

## Current Workflow

Cases 有两个执行入口：CLI（Python）和 Web（FastAPI + Svelte）。

### CLI（Python）

| 命令 | 状态 | 说明 |
|------|------|------|
| `run` | Current | 示例命令，输出问候语 |

CLI 当前仅为占位入口，核心业务逻辑在 Web 端。

### Web（FastAPI + Svelte）

Web 是主要业务入口，拥有完整的 API 路由和前端页面。

**后端**（FastAPI，端口 3000）：

| API 路由模块 | 路径前缀 | 说明 |
|-------------|---------|------|
| `limitup_router` | `/api/limitup/*` | 涨停数据：日期列表、每日涨停、龙头股排行、个股历史 |
| `discovery_router` | `/api/discovery/*` | Discovery 队列、主题详情、跳过/准备操作 |

**前端页面**（Svelte 5）：

| 页面 | 文件 | 说明 |
|------|------|------|
| LimitUpPage | `pages/LimitUpPage.svelte` | 涨停原始数据展示、日期导航、龙头股排行、涨停列表 |

**数据库 Schema**（`cases.*`）：

| 表 | 职责 |
|---|------|
| `cases.case` | 研究案例主表（状态：candidate → researching → reviewing → frozen → observing → completed） |
| `cases.case_revision` | 案例修订版本（frozen 后不可变） |
| `cases.company_participation` | 企业参与样本（七类角色） |
| `cases.evidence_reference` | 证据引用（PIT 四态） |
| `cases.review_record` | 人工审核记录 |
| `cases.observation` | 观察追加（frozen 后唯一允许的写入） |
| `cases.agent_run` | Agent 运行记录 |
| `cases.discovery_action` | Discovery 人类校准动作 |

**数据边界**（硬约束，`db.ts` 注释明确）：

- **写入**：仅 `cases.*` schema
- **只读**：`research.*`、`iwen.*`、`ju.*`、`public.*`、`annual_semi.*`

## Development

### 后端（FastAPI）

```bash
cd web

# 安装依赖
uv sync

# 开发模式（热重载）
uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000

# 生产模式
uv run uvicorn nooshare_cases.web.main:app --host 127.0.0.1 --port 3000
```

### 前端（Svelte + Vite）

```bash
cd web

# 安装依赖
bun install

# 开发模式
bun run dev:client

# 构建生产版本
bun run build
```

### Python CLI

```bash
uv venv
uv sync --extra dev

uv run nooshare-cases
uv run pytest
```

## Deployment

```
nginx (443 SSL, case.pro.neuralj.com)
  ↓
uvicorn (127.0.0.1:3000)
  ↓
FastAPI 应用
```

- **supervisor 进程**: `cases-web`
- **日志位置**: `~/.local/state/supervisor/log/cases-web.{out,err}.log`

## Architecture Constraints

遵循 `nooshare-noos/knowledge/computing/architecture/` 下的编程约束：

- **Unit Boundary**（`unit-boundary.md`）：边界必须基于责任、依赖、变化、验证等有意义分离，不为结构而结构。
- **Unit Contract**（`unit-contract.md`）：公开契约必须明确责任、输入、输出、依赖、副作用、失败语义、状态与生命周期。
- **Unit Composition**（`unit-composition.md`）：内部步骤在获得独立边界价值前保持私有。
- **Application Structure Patterns**（`application-structure-patterns.md`）：从最简结构开始，按需引入 Trigger、Orchestration、Unit、Port、Adapter。

## 结构纪律

- 禁止预建 `core/`、`utils/`、`scripts/` 等额外目录，除非有真实业务边界。
- 入口点必须注册在 `pyproject.toml` 的 `[project.scripts]`（Python CLI）。
- `tests/` 必须保留，用于回归测试。
- 开发依赖隔离在 `dev` 组。
