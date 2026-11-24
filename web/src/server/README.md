# Bun Server（已退役）

此目录包含旧版 Bun server 实现，已不再使用。

## 状态

- **FastAPI**（nooshare_cases/web/）现在是唯一的 Web 服务入口
- 所有 API 端点已迁移到 FastAPI
- 此目录保留作为历史参考

## 保留的文件

- schema.sql：数据库 DDL 定义（待迁移到 nooshare_cases/web/migrations/）
- seed-fixtures.ts：测试数据生成脚本
- index.test.ts：旧版测试（已被 tests/test_api_cases.py 替代）

## 不要使用此目录

请勿在此目录添加新功能或修复 bug。所有 Web 后端开发应在 nooshare_cases/web/ 中进行。
