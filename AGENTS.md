# nooshare-cases — Agent 工作规则

本仓库负责 NooShare Matrix 案例与用例管理。

## Matrix Authority

- **nooshare-design**：系统角色与跨仓逻辑职责（architecture/matrix.md）。
- **nooshare-noos**：适用的已验证知识与工程 invariant。
- **nooshare-workenv**：工作区、主机、部署与操作授权（AGENTS.md、workspace.yaml）。

## Context Bootstrap

任务涉及以下情形时，向上索引对应权威：

| 触发条件 | 索引目标 | 读什么 |
|----------|----------|--------|
| 系统角色 / 跨仓职责变更 | nooshare-design | `architecture/matrix.md` |
| 工程 invariant / 已验证知识 | nooshare-noos | 相关 domain 文件 |
| 主机 / 部署 / 操作授权变更 | nooshare-workenv | `AGENTS.md` + `workspace.yaml` |

索引路径：通过 `workspace.yaml` 找到目标 Repo 的 checkout 路径，读取对应文件。

## Local Ownership

本仓库拥有：

- 案例管理代码（`nooshare_cases/`）
- CLI 命令（`nooshare_cases/cli.py`）
- 配置（`nooshare_cases/config.py`）
- Web 后端 API（`nooshare_cases/web/`）
- 测试（`tests/`）

上游权威不替代这些本地契约。与权威要求冲突时，向拥有该问题的权威反馈，不在本地悄悄改写权威定义。

## Current Workflow

唯一执行入口是 CLI（`nooshare_cases/cli.py`）。

**命令**：

| 命令 | 状态 | 说明 |
|------|------|------|
| `run` | Current | 示例命令，输出问候语 |

## Development

### 环境初始化

```bash
uv venv
uv sync --extra dev
```

### 运行

```bash
uv run nooshare-cases
```

### 测试

```bash
uv run pytest
```

## Architecture Constraints

遵循 `nooshare-noos/knowledge/computing/architecture/` 下的编程约束：

- **Unit Boundary**（`unit-boundary.md`）：边界必须基于责任、依赖、变化、验证等有意义分离，不为结构而结构。
- **Unit Contract**（`unit-contract.md`）：公开契约必须明确责任、输入、输出、依赖、副作用、失败语义、状态与生命周期。
- **Unit Composition**（`unit-composition.md`）：内部步骤在获得独立边界价值前保持私有。
- **Application Structure Patterns**（`application-structure-patterns.md`）：从最简结构开始，按需引入 Trigger、Orchestration、Unit、Port、Adapter。
- **Python Skeleton**（`python-minimal-skeleton.md`）：flat 布局，UV 管理依赖，CLI 入口注册在 `[project.scripts]`，禁止 `__main__`。

## 结构纪律

- 禁止预建 `core/`、`utils/`、`scripts/` 等额外目录，除非有真实业务边界。
- 入口点必须注册在 `pyproject.toml` 的 `[project.scripts]`。
- `tests/` 必须保留，用于回归测试。
- 开发依赖隔离在 `dev` 组。

## Web UI

Web 界面采用前后端分离架构：
- **后端**：FastAPI（Python），位于 `nooshare_cases/web/`
- **前端**：Svelte 5（TypeScript），位于 `web/src/client/`

### 技术栈

- **后端框架**: FastAPI（Python 3.11+）
- **数据库驱动**: asyncpg（异步 PostgreSQL）
- **前端框架**: Svelte 5
- **构建工具**: Vite（仅前端）
- **进程管理**: supervisor（管理 uvicorn 进程）
- **反向代理**: nginx（SSL 终止 + 路由）

### 目录结构

```
nooshare_cases/
├── __init__.py
├── cli.py
├── config.py
└── web/
    ├── __init__.py
    ├── main.py              # FastAPI 应用入口
    ├── db.py                # 数据库连接与工具函数
    └── endpoints/
        ├── __init__.py
        └── discovery.py     # Discovery API 端点

web/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    └── client/
        ├── index.html
        ├── main.ts
        └── app.svelte
```

### 开发命令

#### 后端（FastAPI）

```bash
# 安装依赖
uv sync --extra dev

# 开发模式（热重载）
uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000

# 生产模式
uv run uvicorn nooshare_cases.web.main:app --host 127.0.0.1 --port 3000
```

#### 前端（Svelte）

```bash
cd web

# 安装依赖
~/.bun/bin/bun install

# 开发模式
~/.bun/bin/bun run dev

# 构建生产版本
~/.bun/bin/bun run build
```

### 部署架构

```
nginx (443 SSL)
  ↓
case.pro.neuralj.com
  ↓
uvicorn (127.0.0.1:3000)
  ↓
FastAPI 应用
```

- **supervisor 进程**: `cases-web`
- **日志位置**: `~/.local/state/supervisor/log/cases-web.{out,err}.log`
- **配置文件**: `~/.local/etc/supervisor/conf.d/cases-web.conf`

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/discovery/queue` | 获取 Discovery 队列 |
| GET | `/api/discovery/theme/{topic_id}` | 获取主题详情 |
| POST | `/api/discovery/{topic_id}/skip` | 跳过主题 |
| POST | `/api/discovery/{topic_id}/prepare` | 准备案例 |

### 架构约束

- FastAPI 应用遵循依赖注入原则，数据库连接池通过 `db.py` 管理
- API 端点按功能模块组织在 `endpoints/` 目录下
- 前端构建产物位于 `web/dist/client/`，由 FastAPI 静态文件服务托管
- 所有数据库查询使用 asyncpg 异步接口
- 环境变量通过 `config.py` 统一管理
