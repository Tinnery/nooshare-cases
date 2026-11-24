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

## Development

### 后端（FastAPI）

```bash
cd web
uv sync
uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000
uv run uvicorn nooshare_cases.web.main:app --host 127.0.0.1 --port 3000
```

### 前端（Svelte + Vite）

```bash
cd web
bun install
bun run dev:client
bun run build
```

### Python CLI

```bash
uv venv
uv sync --extra dev
uv run nooshare-cases
uv run pytest
```

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
