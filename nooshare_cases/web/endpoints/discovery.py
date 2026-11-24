"""
Discovery API：REAL 热点队列（research 只读聚合）+ 人类校准动作写 cases schema。
路由：GET /queue · GET /theme/{topic_id} · POST /{topic_id}/skip · POST /{topic_id}/prepare
"""
import json
import time
import random
import asyncio
from datetime import datetime, date
from ..utils_time import parse_to_shanghai, validate_trading_day
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..db import fetch_all, fetch_one, execute, latest_snapshot_id, num, get_pool

router = APIRouter()


# ---------- Pydantic models ----------

class SkipRequest(BaseModel):
    reason: Optional[str] = None
    note: Optional[str] = None
    undo: Optional[bool] = None


class PrepareRequest(BaseModel):
    researchQuestion: Optional[str] = None
    researchTimeT: Optional[str] = None
    infoCutoff: Optional[str] = None
    note: Optional[str] = None
    episodeRef: Optional[str] = None
    sourceSnapshotId: Optional[str] = None


# ---------- Agent 状态推导 ----------

CASE_STATUS_MAP = {
    "candidate":    {"rank": 1, "agent": "prepared"},
    "researching":  {"rank": 2, "agent": "researching"},
    "reviewing":    {"rank": 3, "agent": "researched"},
    "frozen":       {"rank": 4, "agent": "researched"},
    "observing":    {"rank": 4, "agent": "researched"},
    "completed":    {"rank": 5, "agent": "researched"},
    "rejected":     {"rank": 0, "agent": "rejected"},
    "blocked":      {"rank": -1, "agent": "rejected"},
}


def parse_topic_id(topic_id: str) -> tuple[str, str]:
    """解析 topicId → (type, key)"""
    if topic_id.startswith("t:"):
        return ("theme", topic_id[2:])
    if topic_id.startswith("f:"):
        return ("fragment", topic_id[2:])
    return ("theme", topic_id)


async def load_case_refs() -> list[dict]:
    rows = await fetch_all(
        'SELECT case_id, title, status, trigger_discovery_ref FROM cases."case" ORDER BY created_at'
    )
    result = []
    for r in rows:
        ref = r.get("trigger_discovery_ref") or {}
        if isinstance(ref, str):
            ref = json.loads(ref)
        keys = [
            v for v in [ref.get("subjectKey"), ref.get("themeName"), ref.get("normalized_fragment")]
            if isinstance(v, str) and v != ""
        ]
        result.append({"caseId": r["case_id"], "title": r["title"], "status": r["status"], "refKeys": keys})
    return result


async def load_skip_keys() -> set[tuple[str, str]]:
    rows = await fetch_all(
        "SELECT DISTINCT ON (subject_type, subject_key) subject_type, subject_key, action "
        "FROM cases.discovery_action ORDER BY subject_type, subject_key, created_at DESC"
    )
    return {(r["subject_type"], r["subject_key"]) for r in rows if r["action"] == "skip"}


def derive_agent_status(topic_keys: list[str], cases: list[dict], skipped: bool) -> dict:
    best = None
    for c in cases:
        if not any(k in topic_keys for k in c["refKeys"]):
            continue
        m = CASE_STATUS_MAP.get(c["status"], {"rank": -1, "agent": "rejected"})
        if m["rank"] < 0:
            continue
        if best is None or m["rank"] > best["rank"]:
            best = {"rank": m["rank"], "agent": m["agent"], "c": c}
    if best:
        return {
            "agentStatus": best["agent"],
            "candidateCase": {"caseId": best["c"]["caseId"], "title": best["c"]["title"], "status": best["c"]["status"]},
        }
    return {"agentStatus": "skipped" if skipped else "unhandled", "candidateCase": None}


# ---------- GET /queue ----------

@router.get("/queue")
async def discovery_queue():
    snap = await latest_snapshot_id()
    if not snap:
        raise HTTPException(status_code=503, detail="无可用数据快照")

    # 查询 snapshot 元数据
    snap_meta = await fetch_one(
        "SELECT source_snapshot_id, snapshot_at::text, min_trade_date::text, max_trade_date::text, "
        "source_system, import_status FROM research.source_snapshot WHERE source_snapshot_id = $1",
        snap
    )
    if not snap_meta:
        raise HTTPException(status_code=503, detail=f"Snapshot {snap} 元数据缺失")

    # 1) 标准化片段聚合
    agg_rows = await fetch_all(
        "SELECT rf.normalized_fragment, "
        "min(rf.trade_date)::text AS first_seen, "
        "max(rf.trade_date)::text AS last_seen, "
        "count(DISTINCT rf.stock_code)::text AS stock_count, "
        "count(*)::text AS fragment_count "
        "FROM research.reason_fragment rf "
        "WHERE rf.source_snapshot_id = $1 "
        "GROUP BY rf.normalized_fragment "
        "ORDER BY max(rf.trade_date) DESC, count(DISTINCT rf.stock_code) DESC "
        "LIMIT 300",
        snap,
    )
    topics = [r["normalized_fragment"] for r in agg_rows]

    if not topics:
        return {
            "queue": [],
            "footer": {"total": 0, "unhandled": 0},
            "snapshotId": snap,
            "snapshotMeta": {
                "sourceSnapshotId": snap_meta["source_snapshot_id"],
                "snapshotAt": snap_meta["snapshot_at"],
                "minTradeDate": snap_meta["min_trade_date"],
                "maxTradeDate": snap_meta["max_trade_date"],
                "sourceSystem": snap_meta["source_system"],
                "importStatus": snap_meta["import_status"],
            }
        }

    # 2) 每个热点取 3 条最近原始片段样本
    sample_rows = await fetch_all(
        "SELECT normalized_fragment, raw_fragment, trade_date::text, stock_code "
        "FROM ( "
        "  SELECT rf.normalized_fragment, rf.raw_fragment, rf.trade_date, rf.stock_code, "
        "         row_number() OVER (PARTITION BY rf.normalized_fragment ORDER BY rf.trade_date DESC, rf.fragment_ordinal) AS rn "
        "  FROM research.reason_fragment rf "
        "  WHERE rf.source_snapshot_id = $1 AND rf.normalized_fragment = ANY($2) "
        ") t WHERE rn <= 3 ORDER BY normalized_fragment, rn",
        snap,
        topics,
    )

    # 3) 原始片段 → 标准化主题投票
    vote_rows = await fetch_all(
        "SELECT f.normalized_fragment, ot.theme_id, t.theme_name, t.theme_type, "
        "       count(DISTINCT f.stock_code)::text AS stock_votes, "
        "       bool_or(ot.mapping_status = 'confirmed') AS has_confirmed "
        "FROM research.reason_fragment f "
        "JOIN research.observation_theme ot "
        "  ON ot.source_snapshot_id = f.source_snapshot_id "
        " AND ot.trade_date = f.trade_date "
        " AND ot.stock_code = f.stock_code "
        "JOIN research.theme t ON t.theme_id = ot.theme_id "
        "WHERE f.source_snapshot_id = $1 AND f.normalized_fragment = ANY($2) "
        "GROUP BY f.normalized_fragment, ot.theme_id, t.theme_name, t.theme_type",
        snap,
        topics,
    )
    theme_votes: dict[str, list[dict]] = {}
    for v in vote_rows:
        theme_votes.setdefault(v["normalized_fragment"], []).append(v)

    # 4) 关联主题 Episode
    theme_ids = list({v["theme_id"] for v in vote_rows})
    ep_rows = []
    if theme_ids:
        ep_rows = await fetch_all(
            "SELECT e.episode_id::text, e.theme_id::text, e.status::text, "
            "       e.start_date::text, e.end_date::text, e.peak_obs_count, e.total_stock_count "
            "FROM research.theme_episode e "
            "WHERE e.theme_id = ANY($1) ORDER BY e.start_date DESC",
            theme_ids,
        )

    # 5) Agent 状态推导
    case_refs, skip_keys = await asyncio.gather(load_case_refs(), load_skip_keys())

    # 构建中间行
    fragment_rows = []
    for r in agg_rows:
        fragment = r["normalized_fragment"]
        votes = theme_votes.get(fragment, [])
        best = max(votes, key=lambda v: int(v["stock_votes"])) if votes else None
        topic_keys = [fragment, best["theme_name"]] if best else [fragment]
        is_skipped = ("fragment", fragment) in skip_keys or (best and ("theme", best["theme_name"]) in skip_keys)
        status_info = derive_agent_status(topic_keys, case_refs, bool(is_skipped))

        ep_row = None
        if best:
            ep_list = [e for e in ep_rows if e["theme_id"] == best["theme_id"]]
            ep_row = next(
                (e for e in ep_list if e["start_date"] <= r["last_seen"] and e["end_date"] >= r["last_seen"]),
                ep_list[0] if ep_list else None,
            )

        fragment_rows.append({
            "fragment": fragment,
            "topicId": f"t:{best['theme_id']}" if best else f"f:{fragment}",
            "rawTopic": fragment,
            "theme": {
                "themeId": best["theme_id"],
                "themeName": best["theme_name"],
                "themeType": best["theme_type"],
                "mapping": "confirmed" if best["has_confirmed"] else "candidate",
            } if best else None,
            "rawSamples": [
                {"rawFragment": s["raw_fragment"], "date": s["trade_date"], "stockCode": s["stock_code"]}
                for s in sample_rows if s["normalized_fragment"] == fragment
            ][:3],
            "firstSeen": r["first_seen"],
            "lastSeen": r["last_seen"],
            "stockCount": num(r["stock_count"]) or 0,
            "fragmentCount": num(r["fragment_count"]) or 0,
            "episode": {
                "episodeId": ep_row["episode_id"],
                "status": ep_row["status"],
                "startDate": ep_row["start_date"],
                "endDate": ep_row["end_date"],
                "peakObsCount": ep_row["peak_obs_count"],
                "totalStockCount": ep_row["total_stock_count"],
            } if ep_row else None,
            "agentStatus": status_info["agentStatus"],
            "candidateCase": status_info["candidateCase"],
        })

    # 按 topicId 聚合
    topic_map: dict[str, dict] = {}
    for row in fragment_rows:
        existing = topic_map.get(row["topicId"])
        if not existing:
            topic_map[row["topicId"]] = row
        else:
            existing["firstSeen"] = min(existing["firstSeen"], row["firstSeen"])
            existing["lastSeen"] = max(existing["lastSeen"], row["lastSeen"])
            existing["stockCount"] = max(existing["stockCount"], row["stockCount"])
            existing["fragmentCount"] += row["fragmentCount"]
            sample_set = {s["rawFragment"] for s in existing["rawSamples"]}
            for s in row["rawSamples"]:
                if s["rawFragment"] not in sample_set and len(existing["rawSamples"]) < 3:
                    existing["rawSamples"].append(s)
                    sample_set.add(s["rawFragment"])
            if row["episode"] and existing["lastSeen"] >= row["episode"]["startDate"] and existing["lastSeen"] <= row["episode"]["endDate"]:
                existing["episode"] = row["episode"]

    queue = list(topic_map.values())
    return {
        "queue": queue,
        "footer": {"total": len(queue), "unhandled": sum(1 for q in queue if q["agentStatus"] == "unhandled")},
        "snapshotId": snap,
        "snapshotMeta": {
            "sourceSnapshotId": snap_meta["source_snapshot_id"],
            "snapshotAt": snap_meta["snapshot_at"],
            "minTradeDate": snap_meta["min_trade_date"],
            "maxTradeDate": snap_meta["max_trade_date"],
            "sourceSystem": snap_meta["source_system"],
            "importStatus": snap_meta["import_status"],
        }
    }


# ---------- GET /theme/{topic_id} ----------

@router.get("/theme/{topic_id}")
async def theme_detail(topic_id: str):
    snap = await latest_snapshot_id()
    if not snap:
        raise HTTPException(status_code=503, detail="无可用数据快照")
    t, key = parse_topic_id(topic_id)

    if t == "theme":
        return await _theme_detail_branch(key, snap)
    else:
        return await _fragment_detail_branch(key, snap)


async def _theme_detail_branch(key: str, snap: str):
    theme = await fetch_one(
        "SELECT theme_id, theme_name, theme_type, parent_theme_id, definition, status, taxonomy_version "
        "FROM research.theme WHERE theme_id = $1",
        key,
    )
    if not theme:
        raise HTTPException(status_code=404, detail=f"主题不存在：{key}")

    alias_rows = await fetch_all(
        "SELECT alias_text, mapping_method, review_status FROM research.theme_alias "
        "WHERE theme_id = $1 ORDER BY review_status NULLS LAST, alias_text LIMIT 20",
        key,
    )
    ep_rows = await fetch_all(
        "SELECT e.episode_id::text, e.status::text, e.start_date::text, e.end_date::text, "
        "       e.duration_days, e.peak_date::text, e.peak_obs_count, "
        "       e.total_obs_count, e.total_stock_count, e.active_days, e.intermittent_days "
        "FROM research.theme_episode e WHERE e.theme_id = $1 ORDER BY e.start_date DESC",
        key,
    )
    stock_rows = await fetch_all(
        "SELECT ot.stock_code, s.display_name, count(*)::text AS obs_count, "
        "       min(ot.trade_date)::text AS first_seen, max(ot.trade_date)::text AS last_seen "
        "FROM research.observation_theme ot "
        "LEFT JOIN LATERAL ( "
        "  SELECT display_name FROM ju.stocks js "
        "  WHERE js.stock_code = ot.stock_code AND js.start_date <= ot.trade_date "
        "    AND (js.end_date IS NULL OR js.end_date >= ot.trade_date) LIMIT 1 "
        ") s ON true "
        "WHERE ot.theme_id = $1 AND ot.source_snapshot_id = $2 "
        "GROUP BY ot.stock_code, s.display_name ORDER BY max(ot.trade_date) DESC, count(*) DESC LIMIT 50",
        key, snap,
    )
    frag_rows = await fetch_all(
        "SELECT rf.raw_fragment, rf.normalized_fragment, rf.trade_date::text, rf.stock_code, s.display_name "
        "FROM research.observation_theme ot "
        "JOIN research.reason_fragment rf ON rf.source_snapshot_id = ot.source_snapshot_id "
        "  AND rf.trade_date = ot.trade_date AND rf.stock_code = ot.stock_code "
        "LEFT JOIN LATERAL ( "
        "  SELECT display_name FROM ju.stocks js "
        "  WHERE js.stock_code = ot.stock_code AND js.start_date <= ot.trade_date "
        "    AND (js.end_date IS NULL OR js.end_date >= ot.trade_date) LIMIT 1 "
        ") s ON true "
        "WHERE ot.theme_id = $1 AND ot.source_snapshot_id = $2 "
        "ORDER BY rf.trade_date DESC, rf.fragment_ordinal LIMIT 10",
        key, snap,
    )
    actions = await fetch_all(
        "SELECT action, reason, note, created_at::text FROM cases.discovery_action "
        "WHERE subject_type = 'theme' AND subject_key = $1 ORDER BY created_at DESC LIMIT 5",
        key,
    )

    return {
        "topicId": f"t:{key}",
        "theme": {
            "themeId": theme["theme_id"], "themeName": theme["theme_name"],
            "themeType": theme["theme_type"], "parentThemeId": theme["parent_theme_id"],
            "definition": theme["definition"], "status": theme["status"],
            "taxonomyVersion": theme["taxonomy_version"],
        },
        "episodes": [{
            "episodeId": e["episode_id"], "status": e["status"],
            "startDate": e["start_date"], "endDate": e["end_date"],
            "durationDays": e["duration_days"], "peakDate": e["peak_date"],
            "peakObsCount": e["peak_obs_count"], "totalObsCount": e["total_obs_count"],
            "totalStockCount": e["total_stock_count"], "activeDays": e["active_days"],
            "intermittentDays": e["intermittent_days"],
        } for e in ep_rows],
        "stocks": [{
            "stockCode": s["stock_code"], "name": s["display_name"],
            "obsCount": num(s["obs_count"]) or 0,
            "firstSeen": s["first_seen"], "lastSeen": s["last_seen"],
        } for s in stock_rows],
        "aliases": [{
            "aliasText": a["alias_text"], "mappingMethod": a["mapping_method"],
            "reviewStatus": a["review_status"],
        } for a in alias_rows],
        "fragmentSamples": [{
            "rawFragment": f["raw_fragment"], "normalizedFragment": f["normalized_fragment"],
            "date": f["trade_date"], "stockCode": f["stock_code"], "name": f["display_name"],
        } for f in frag_rows],
        "actions": [{"action": a["action"], "reason": a["reason"], "note": a["note"], "createdAt": a["created_at"]} for a in actions],
    }


async def _fragment_detail_branch(key: str, snap: str):
    agg = await fetch_one(
        "SELECT min(trade_date)::text AS first_seen, max(trade_date)::text AS last_seen, "
        "count(DISTINCT stock_code)::text AS stock_count, count(*)::text AS fragment_count "
        "FROM research.reason_fragment WHERE source_snapshot_id = $1 AND normalized_fragment = $2",
        snap, key,
    )
    if not agg:
        raise HTTPException(status_code=404, detail=f"热点片段不存在：{key}")

    frag_rows = await fetch_all(
        "SELECT rf.raw_fragment, rf.trade_date::text, rf.stock_code, s.display_name "
        "FROM research.reason_fragment rf "
        "LEFT JOIN LATERAL ( "
        "  SELECT display_name FROM ju.stocks js WHERE js.stock_code = rf.stock_code "
        "  AND js.start_date <= rf.trade_date AND (js.end_date IS NULL OR js.end_date >= rf.trade_date) LIMIT 1 "
        ") s ON true "
        "WHERE rf.source_snapshot_id = $1 AND rf.normalized_fragment = $2 "
        "ORDER BY rf.trade_date DESC, rf.fragment_ordinal LIMIT 10",
        snap, key,
    )
    actions = await fetch_all(
        "SELECT action, reason, note, created_at::text FROM cases.discovery_action "
        "WHERE subject_type = 'fragment' AND subject_key = $1 ORDER BY created_at DESC LIMIT 5",
        key,
    )
    return {
        "topicId": f"f:{key}", "theme": None, "fragment": key,
        "stats": {
            "firstSeen": agg["first_seen"], "lastSeen": agg["last_seen"],
            "stockCount": num(agg["stock_count"]) or 0,
            "fragmentCount": num(agg["fragment_count"]) or 0,
        },
        "fragmentSamples": [{
            "rawFragment": f["raw_fragment"], "normalizedFragment": key,
            "date": f["trade_date"], "stockCode": f["stock_code"], "name": f["display_name"],
        } for f in frag_rows],
        "actions": [{"action": a["action"], "reason": a["reason"], "note": a["note"], "createdAt": a["created_at"]} for a in actions],
    }


# ---------- POST /{topic_id}/skip ----------

@router.post("/{topic_id}/skip")
async def skip_topic(topic_id: str, body: SkipRequest):
    t, key = parse_topic_id(topic_id)

    if body.undo:
        await execute(
            "DELETE FROM cases.discovery_action WHERE action_id IN ( "
            "  SELECT action_id FROM cases.discovery_action "
            "  WHERE subject_type = $1 AND subject_key = $2 AND action = 'skip' "
            "  ORDER BY created_at DESC LIMIT 1 "
            ")",
            t, key,
        )
        action_id = f"DA-{int(time.time()*1000):x}-{random.randint(0, 0xffffff):06x}"
        await execute(
            "INSERT INTO cases.discovery_action (action_id, subject_type, subject_key, action, reason, note) "
            "VALUES ($1, $2, $3, 'restore', NULL, $4)",
            action_id, t, key, body.note,
        )
        return {"topicId": topic_id, "agentStatus": "unhandled"}

    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="标记不研究必须填写原因")
    allowed = ["热度不足", "已研究过", "超出能力范围", "其他"]
    if reason not in allowed:
        raise HTTPException(status_code=400, detail=f"原因必须是：{' / '.join(allowed)}")

    action_id = f"DA-{int(time.time()*1000):x}-{random.randint(0, 0xffffff):06x}"
    await execute(
        "INSERT INTO cases.discovery_action (action_id, subject_type, subject_key, action, reason, note) "
        "VALUES ($1, $2, $3, 'skip', $4, $5)",
        action_id, t, key, reason, body.note,
    )
    return JSONResponse(status_code=201, content={"topicId": topic_id, "actionId": action_id, "agentStatus": "skipped"})


# ---------- POST /{topic_id}/prepare ----------

@router.post("/{topic_id}/prepare")
async def prepare_case(topic_id: str, body: PrepareRequest):
    t, key = parse_topic_id(topic_id)

    question = (body.researchQuestion or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="研究问题为必填项")
    if not body.researchTimeT or not body.infoCutoff:
        raise HTTPException(status_code=400, detail="T 时点与信息截止均为必填项")
    try:
        ts_t = parse_to_shanghai(body.researchTimeT)
        ts_cutoff = parse_to_shanghai(body.infoCutoff)
        # G3: 校验是否为交易日
        validate_trading_day(ts_t.date(), "researchTimeT")
        validate_trading_day(ts_cutoff.date(), "infoCutoff")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if ts_cutoff > ts_t:
        raise HTTPException(status_code=400, detail="信息截止必须早于或等于 T 时点")

    # G3: 验证 sourceSnapshotId
    if not body.sourceSnapshotId:
        raise HTTPException(status_code=400, detail="sourceSnapshotId 为必填项")
    
    snap_meta = await fetch_one(
        "SELECT source_snapshot_id, snapshot_at::text, min_trade_date::text, max_trade_date::text, "
        "source_system, import_status FROM research.source_snapshot WHERE source_snapshot_id = $1",
        body.sourceSnapshotId
    )
    if not snap_meta:
        raise HTTPException(status_code=404, detail=f"Snapshot {body.sourceSnapshotId} 不存在")
    if snap_meta["import_status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Snapshot {body.sourceSnapshotId} 尚未完成导入")

    theme_name = None
    theme_id = None
    if t == "theme":
        theme_id = key
        row = await fetch_one("SELECT theme_name FROM research.theme WHERE theme_id = $1", key)
        theme_name = row["theme_name"] if row else None

    # G3: 幂等性检查 - 同一 subjectKey + snapshot 不重复创建
    dup = await fetch_one(
        'SELECT case_id FROM cases."case" WHERE status NOT IN (\'rejected\', \'blocked\') '
        "AND trigger_discovery_ref->>'subjectKey' = $1 "
        "AND trigger_discovery_ref->>'sourceSnapshotId' = $2 LIMIT 1",
        key, body.sourceSnapshotId,
    )
    if dup:
        # 幂等返回已有 case
        return JSONResponse(
            status_code=200,
            content={
                "caseId": dup["case_id"],
                "status": "candidate",
                "topicId": topic_id,
                "idempotent": True,
                "note": "该 snapshot 下已存在相同热点的 Case"
            },
        )

    seq_row = await fetch_one("SELECT nextval('cases.case_id_seq') AS n")
    case_id = f"C-{seq_row['n']}"

    # G3: 完整的 trigger_discovery_ref
    ref_json = json.dumps({
        "source": "discovery",
        "subjectType": t,
        "subjectKey": key,
        "sourceSnapshotId": body.sourceSnapshotId,
        "themeId": theme_id,
        "themeName": theme_name,
        "episodeRef": body.episodeRef if body.episodeRef else None,
    })

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                'INSERT INTO cases."case" (case_id, title, research_question, research_time_t, info_cutoff, status, '
                "trigger_discovery_ref, episode_refs, themes, is_fixture) "
                "VALUES ($1, $2, $3, $4, $5, 'candidate', $6::jsonb, $7, $8, false)",
                case_id, question[:60], question, ts_t, ts_cutoff,
                ref_json, [], [theme_name] if theme_name else [],
            )
            # G3: 完整的 input_manifest，包含 PIT 信息
            input_manifest = {
                "source": "discovery",
                "subjectType": t,
                "subjectKey": key,
                "sourceSnapshotId": body.sourceSnapshotId,
                "snapshotAt": snap_meta["snapshot_at"],
                "minTradeDate": snap_meta["min_trade_date"],
                "maxTradeDate": snap_meta["max_trade_date"],
                "sourceSystem": snap_meta["source_system"],
                "researchTimeT": body.researchTimeT,
                "infoCutoff": body.infoCutoff,
                "themeId": theme_id,
                "themeName": theme_name,
                "episodeRef": body.episodeRef if body.episodeRef else None,
                "note": body.note,
            }
            await conn.execute(
                "INSERT INTO cases.case_revision (revision_id, case_id, revision_no, input_manifest, judgment, status, created_by) "
                "VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, 'draft', 'agent')",
                f"{case_id}-R1", case_id,
                json.dumps(input_manifest),
                json.dumps({"hypotheses": [], "conclusion": None, "counterarguments": [], "counter_evidence": [], "open_questions": [], "applicability": ""}),
            )

    warning = "研究问题少于 15 字，建议补充具体化" if len(question) < 15 else None
    return JSONResponse(
        status_code=201,
        content={"caseId": case_id, "status": "candidate", "topicId": topic_id, "warning": warning},
    )

