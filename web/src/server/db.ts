// web/src/server/db.ts
// PG 客户端单例：Unix socket /tmp 免密连接（data-facts §1）。
// 写入边界（硬约束）：research / iwen / ju / public / annual_semi 只读；仅 cases schema 可写。
import postgres from "postgres";

export const sql = postgres({
  host: "/tmp",
  database: "nooshare_dev",
  user: "travis",
  max: 10, // 连接池上限（P0 单进程足够）
  idle_timeout: 30, // 空闲连接回收（秒）
  connect_timeout: 10,
});

/** 最新已完成导入的数据 snapshot（research.source_snapshot 均为同一份 iwen 数据，取最新 completed） */
export async function latestSnapshotId(): Promise<string | null> {
  // 优先取拥有主题/原因片段关联的 snapshot（上游映射表挂在特定 snapshot 上，
  // 其余 snapshot 虽内容相同但缺主题关联，会导致 Market/Discovery 主题区为空）
  const withThemes = await sql<{ source_snapshot_id: string }[]>`
    SELECT o.source_snapshot_id
    FROM research.market_limit_up_observation o
    WHERE EXISTS (SELECT 1 FROM research.observation_theme t WHERE t.source_snapshot_id = o.source_snapshot_id)
    GROUP BY o.source_snapshot_id
    ORDER BY o.source_snapshot_id DESC
    LIMIT 1
  `;
  if (withThemes[0]) return withThemes[0].source_snapshot_id;
  const rows = await sql<{ source_snapshot_id: string }[]>`
    SELECT source_snapshot_id
    FROM research.source_snapshot
    WHERE import_status = 'completed'
    ORDER BY snapshot_at DESC
    LIMIT 1
  `;
  return rows[0]?.source_snapshot_id ?? null;
}

/** 涨停时间等文本字段可能带前导空格（如 " 09:32:30"），统一 trim */
export function trimTime(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** numeric 列 postgres 默认返回字符串，安全转数值 */
export function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
