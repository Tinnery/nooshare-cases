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

Web 界面位于 `web/` 目录，使用 Bun + Svelte 全栈架构。

### 技术栈

- **Runtime**: Bun（已安装在 `~/.bun/bin/bun`）
- **前端框架**: Svelte 5
- **构建工具**: Vite（仅前端）
- **后端**: Bun.serve（单进程托管 API 和静态文件）

### 目录结构

```
web/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── server/
    │   ├── index.ts          # Bun.serve 服务器
    │   └── index.test.ts
    └── client/
        ├── index.html
        ├── main.ts
        └── app.svelte
```

### 开发命令

```bash
cd web

# 安装依赖
~/.bun/bin/bun install

# 开发模式（前后端同时启动）
~/.bun/bin/bun run dev
# - Client: http://localhost:5173
# - Server: http://localhost:3000

# 构建前端
~/.bun/bin/bun run build

# 生产模式（单进程托管）
~/.bun/bin/bun run start

# 测试
~/.bun/bin/bun test
```

### 架构约束

遵循 `ts-bun-svelte-fullstack-skeleton.md` 约束：

- Bun 原生全链路：运行、依赖管理、测试使用 Bun 内置能力
- Vite 单一职责：仅用于 Svelte 前端开发和构建
- 延迟抽象：无真实需求不创建 interface、class 或分层目录
- 测试就近：测试文件与被测代码同目录，使用 `.test.ts`
- 禁止预建目录：不提前创建 utils、services、components、stores 等目录
- 结构随业务增长：需要什么再创建什么
