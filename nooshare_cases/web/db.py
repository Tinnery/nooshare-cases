"""
数据库连接与工具函数
"""
import os
import asyncpg
from typing import Optional, Any


def get_db_config():
    """PostgreSQL 连接配置：标准 PG_* 环境变量优先，默认本地开发库"""
    return {
        "host": os.environ.get("PGHOST", "127.0.0.1"),
        "port": int(os.environ.get("PGPORT", "5432")),
        "user": os.environ.get("PGUSER", "travis"),
        "password": os.environ.get("PGPASSWORD", ""),
        "database": os.environ.get("PGDATABASE", "nooshare_dev"),
    }


_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """获取数据库连接池（单例）"""
    global _pool
    if _pool is None:
        config = get_db_config()
        _pool = await asyncpg.create_pool(**config, min_size=2, max_size=10)
    return _pool


async def close_pool():
    """关闭数据库连接池"""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def fetch_all(query: str, *args) -> list[dict[str, Any]]:
    """执行查询并返回字典列表"""
    pool = await get_pool()
    rows = await pool.fetch(query, *args)
    return [dict(row) for row in rows]


async def fetch_one(query: str, *args) -> Optional[dict[str, Any]]:
    """执行查询并返回单行字典"""
    pool = await get_pool()
    row = await pool.fetchrow(query, *args)
    return dict(row) if row else None


async def execute(query: str, *args) -> str:
    """执行写操作"""
    pool = await get_pool()
    return await pool.execute(query, *args)


async def latest_snapshot_id() -> Optional[str]:
    """获取最新快照 ID"""
    row = await fetch_one(
        "SELECT source_snapshot_id::text FROM research.source_snapshot ORDER BY created_at DESC LIMIT 1"
    )
    return row["source_snapshot_id"] if row else None


def num(s: Optional[str]) -> Optional[int]:
    """字符串转整数"""
    return int(s) if s else None
