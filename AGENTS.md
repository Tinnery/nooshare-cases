# nooshare-cases — Agent 工作规则

本仓库负责 NooShare Matrix 案例与用例管理。

## 公共仓库文档禁令（硬约束）

本仓库是 public repo，以下规则优先于任何“按需写文档”的冲动：

1. **禁止文档目录**：不得新建或保留 `docs/`、`doc/`、`documentation/`、`deliverables/`、`reports/`、`notes/`、`decisions/`、`history/` 等文档或过程目录。
2. **禁止生成文字材料**：使用指南、API 清单、技术栈说明、报告、评审记录、笔记等文字文件（`.md` / `.rst` / `.pdf` / `.docx` 等）不得在本仓库生成或提交。机器验证的临时输出只能写入被忽略的 `.runtime/`，不作为文档维护。
3. **README.md 只做入口**：仅保留标题与一句话定位；子目录下的 README 同样只做入口。`AGENTS.md` 只放规则与路由。
4. **文字材料唯一归属**：所有文字材料必须维护在私有仓库 `nooshare-design` 的 `implementation-docs/nooshare-cases/` 下；本仓库只引用，不复制。
5. **违规处理**：发现本仓库出现上述目录或文字材料，不就地修订——先迁移到 nooshare-design，再删除本地文件，并更新下方索引表。

### 文字材料索引（nooshare-design）

| 材料 | 权威位置（nooshare-design） |
|------|------------------------------|
| 使用与开发指南（原 README） | `implementation-docs/nooshare-cases/README-full.md` |
| Web 前端开发说明 | `implementation-docs/nooshare-cases/web-README.md` |
| 已退役 Bun server 说明 | `implementation-docs/nooshare-cases/server-README.md` |
| 系统角色与跨仓职责 | `architecture/nooshare-cases.md` |
| 跨仓边界 | `architecture/matrix.md` |

通过 `workspace.yaml` 定位 nooshare-design 的 checkout 路径后读取上述文件。

## Matrix Authority

- **nooshare-design**：系统角色与跨仓逻辑职责（architecture/matrix.md、architecture/nooshare-cases.md）。
- **nooshare-noos**：适用的已验证知识与工程 invariant。
- **nooshare-workenv**：工作区、主机、部署与操作授权（AGENTS.md、workspace.yaml）。

## Context Bootstrap

任务涉及以下情形时，向上索引对应权威：

| 触发条件 | 索引目标 | 读什么 |
|----------|----------|--------|
| 系统角色 / 跨仓职责变更 | nooshare-design | architecture/matrix.md、architecture/nooshare-cases.md |
| 工程 invariant / 已验证知识 | nooshare-noos | 相关 domain 文件 |
| 主机 / 部署 / 操作授权变更 | nooshare-workenv | AGENTS.md + workspace.yaml |

索引路径：通过 workspace.yaml 找到目标 Repo 的 checkout 路径，读取对应文件。

## Local Ownership

本仓库拥有：

- 案例管理代码（nooshare_cases/）
- CLI 命令（nooshare_cases/cli.py）
- 配置（nooshare_cases/config.py）
- Web 后端（nooshare_cases/web/）—— FastAPI 入口，API 路由 + 静态文件服务
- Web 前端（web/src/client/）—— Svelte 5 + Vite
- 测试（tests/）—— pytest 异步测试
- 数据库 Schema（待迁移）—— cases.* DDL 当前在 nooshare_dev 数据库，由旧 Bun Server 的 schema.sql 初始化，需迁移到 nooshare_cases/ 管理

**注意**：web/src/server/ 中的 Bun server 已退役。FastAPI（nooshare_cases/web/）是唯一的 Web 服务入口。

上游权威不替代这些本地契约。与权威要求冲突时，向拥有该问题的权威反馈，不在本地悄悄改写权威定义。

## Development

### 后端（FastAPI）

    uv sync
    uv run uvicorn nooshare_cases.web.main:app --reload --host 127.0.0.1 --port 3000

### 前端（Svelte + Vite）

    cd web
    bun install
    bun run dev:client
    bun run build

### Python CLI

    uv venv
    uv sync --extra dev
    uv run nooshare-cases

## Testing

    # FastAPI 端点测试（15 个异步测试）
    uv run pytest

    # 前端测试
    cd web && bun test

## Architecture Constraints

遵循 nooshare-noos/knowledge/computing/architecture/ 下的编程约束：

- **Unit Boundary**（unit-boundary.md）：边界必须基于责任、依赖、变化、验证等有意义分离，不为结构而结构。
- **Unit Contract**（unit-contract.md）：公开契约必须明确责任、输入、输出、依赖、副作用、失败语义、状态与生命周期。
- **Unit Composition**（unit-composition.md）：内部步骤在获得独立边界价值前保持私有。
- **Application Structure Patterns**（application-structure-patterns.md）：从最简结构开始，按需引入 Trigger、Orchestration、Unit、Port、Adapter。

## 结构纪律

- 禁止预建 core/、utils/、scripts/ 等额外目录，除非有真实业务边界。
- 入口点必须注册在 pyproject.toml 的 [project.scripts]（Python CLI）。
- tests/ 必须保留，用于回归测试。
- 开发依赖隔离在 dev 组。

## 主机约束

本仓库只在 pro 主机开发和运行。禁止 clone 到 Windows 主机（travis-hp）。如果在 Windows 主机上发现本仓库的 checkout，应删除该 checkout 并修正来源（不正确的 clone 操作或 workspace 配置）。
