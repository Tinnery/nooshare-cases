"""Cases / Review / Runs / Search API 端点"""

from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional, List, Any, Dict
from datetime import datetime
from pydantic import BaseModel
import uuid
import time

from ..db import fetch_all, fetch_one, execute, get_pool

router = APIRouter()

# 常量
OUTCOMES = ["support", "oppose", "mixed", "no_change", "indeterminate"]
DECISIONS = ["approve", "request_changes", "reject"]
ROLE_ORDER = [
    "seed",
    "directly_related",
    "similar",
    "potential_beneficiary",
    "non_responder",
    "counterexample",
    "excluded",
]


def gen_id(prefix: str) -> str:
    """生成 ID：prefix-timestamp-random"""
    ts = int(time.time() * 1000)
    rand = uuid.uuid4().hex[:6]
    return f"{prefix}-{ts:x}-{rand}"


def now_iso() -> str:
    """当前 ISO 时间"""
    return datetime.utcnow().isoformat()


# ---------- Models ----------


class CaseListItem(BaseModel):
    caseId: str
    title: str
    status: str
    researchQuestion: Optional[str] = None
    researchTimeT: Optional[str] = None
    infoCutoff: Optional[str] = None
    themes: List[str] = []
    episodeRefs: List[str] = []
    isFixture: bool
    updatedAt: str
    createdAt: str
    revisionCount: int
    currentRevisionNo: Optional[int] = None
    reviewingRevisionId: Optional[str] = None


class CaseListResponse(BaseModel):
    cases: List[CaseListItem]
    footer: Dict[str, int]


class ReviewRequest(BaseModel):
    decision: str
    reason: Optional[str] = ""
    categories: List[str] = []
    revisionId: Optional[str] = None
    reviewer: Optional[str] = "human"


class ObservationRequest(BaseModel):
    windowStart: str
    windowEnd: str
    outcome: str
    content: str
    refs: List[Any] = []


# ---------- GET /api/cases ----------


@router.get("/cases", response_model=CaseListResponse)
async def case_list(
    status: Optional[str] = Query(None, description="逗号分隔的状态筛选"),
    theme: Optional[str] = Query(None, description="主题名筛选"),
    q: Optional[str] = Query(None, description="搜索关键词"),
    view: Optional[str] = Query(None, description="real | fixture 视图"),
):
    """查询 Case 列表"""
    conds = []
    params = []
    param_idx = 1

    if status:
        status_list = [s.strip() for s in status.split(",") if s.strip()]
        if status_list:
            placeholders = ",".join([f"${i}" for i in range(param_idx, param_idx + len(status_list))])
            conds.append(f"c.status = ANY(ARRAY[{placeholders}])")
            params.extend(status_list)
            param_idx += len(status_list)

    if theme:
        conds.append(f"${param_idx} = ANY(c.themes)")
        params.append(theme)
        param_idx += 1

    if q:
        like = f"%{q}%"
        conds.append(f"(c.case_id ILIKE ${param_idx} OR c.title ILIKE ${param_idx} OR c.research_question ILIKE ${param_idx})")
        params.append(like)
        param_idx += 1

    if view == "real":
        conds.append("c.is_fixture = false")
    elif view == "fixture":
        conds.append("c.is_fixture = true")

    where_clause = " WHERE " + " AND ".join(conds) if conds else ""
    params_tuple = tuple(params)

    query = f"""
        SELECT c.case_id, c.title, c.status, c.research_question,
               c.research_time_t::text, c.info_cutoff::text,
               c.themes, c.episode_refs, c.is_fixture,
               c.updated_at::text, c.created_at::text,
               (SELECT count(*) FROM cases.case_revision r WHERE r.case_id = c.case_id)::text AS revision_count,
               (SELECT max(r.revision_no) FROM cases.case_revision r WHERE r.case_id = c.case_id)::text AS current_revision_no,
               (SELECT r.revision_id FROM cases.case_revision r
                 WHERE r.case_id = c.case_id AND r.status = 'reviewing' LIMIT 1) AS reviewing_revision_id
        FROM cases."case" c{where_clause}
        ORDER BY c.updated_at DESC
    """

    rows = await fetch_all(query, *params_tuple)

    cases = []
    for r in rows:
        cases.append(CaseListItem(
            caseId=r["case_id"],
            title=r["title"],
            status=r["status"],
            researchQuestion=r.get("research_question"),
            researchTimeT=r.get("research_time_t"),
            infoCutoff=r.get("info_cutoff"),
            themes=r.get("themes", []),
            episodeRefs=r.get("episode_refs", []),
            isFixture=r["is_fixture"],
            updatedAt=r["updated_at"],
            createdAt=r["created_at"],
            revisionCount=int(r["revision_count"]) if r["revision_count"] else 0,
            currentRevisionNo=int(r["current_revision_no"]) if r["current_revision_no"] else None,
            reviewingRevisionId=r.get("reviewing_revision_id"),
        ))

    return CaseListResponse(
        cases=cases,
        footer={
            "total": len(cases),
            "reviewing": sum(1 for c in cases if c.status == "reviewing"),
        },
    )


# ---------- GET /api/cases/{case_id} ----------


@router.get("/cases/{case_id}")
async def case_detail(case_id: str):
    """查询 Case 详情"""
    c = await fetch_one(
        """
        SELECT case_id, title, research_question, research_time_t::text, info_cutoff::text,
               status, trigger_discovery_ref, episode_refs, themes, is_fixture,
               created_at::text, updated_at::text
        FROM cases."case"
        WHERE case_id = $1
        """,
        case_id,
    )
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")

    revisions = await fetch_all(
        """
        SELECT revision_id, revision_no, input_manifest, judgment, status,
               frozen_at::text, created_by, created_at::text, updated_at::text
        FROM cases.case_revision
        WHERE case_id = $1
        ORDER BY revision_no
        """,
        case_id,
    )

    companies = await fetch_all(
        """
        SELECT stock_code, company_name, role, rationale, evidence_refs, market_response_status
        FROM cases.company_participation
        WHERE case_id = $1
        """,
        case_id,
    )
    # 按角色顺序排序
    companies.sort(key=lambda x: ROLE_ORDER.index(x["role"]) if x["role"] in ROLE_ORDER else 999)

    evidence = await fetch_all(
        """
        SELECT evidence_id, revision_id, upstream_type, upstream_id, version_ref,
               locator, summary, published_at::text, availability_at::text,
               pit_status, pit_note
        FROM cases.evidence_reference
        WHERE case_id = $1
        ORDER BY created_at
        """,
        case_id,
    )

    reviews = await fetch_all(
        """
        SELECT review_id, revision_id, decision, reason, categories, reviewer, reviewed_at::text
        FROM cases.review_record
        WHERE case_id = $1
        ORDER BY reviewed_at DESC
        """,
        case_id,
    )

    observations = await fetch_all(
        """
        SELECT observation_id, revision_id, window_start::text, window_end::text,
               outcome, content, refs, created_at::text
        FROM cases.observation
        WHERE case_id = $1
        ORDER BY window_start DESC
        """,
        case_id,
    )

    return {
        "case": {
            "caseId": c["case_id"],
            "title": c["title"],
            "researchQuestion": c.get("research_question"),
            "researchTimeT": c.get("research_time_t"),
            "infoCutoff": c.get("info_cutoff"),
            "status": c["status"],
            "triggerDiscoveryRef": c.get("trigger_discovery_ref"),
            "episodeRefs": c.get("episode_refs", []),
            "themes": c.get("themes", []),
            "isFixture": c["is_fixture"],
            "createdAt": c["created_at"],
            "updatedAt": c["updated_at"],
        },
        "revisions": [
            {
                "revisionId": r["revision_id"],
                "revisionNo": r["revision_no"],
                "inputManifest": r.get("input_manifest"),
                "judgment": r.get("judgment"),
                "status": r["status"],
                "frozenAt": r.get("frozen_at"),
                "createdBy": r.get("created_by"),
                "createdAt": r["created_at"],
                "updatedAt": r["updated_at"],
            }
            for r in revisions
        ],
        "companies": [
            {
                "stockCode": p["stock_code"],
                "companyName": p["company_name"],
                "role": p["role"],
                "rationale": p.get("rationale"),
                "evidenceRefs": p.get("evidence_refs", []),
                "marketResponseStatus": p.get("market_response_status"),
            }
            for p in companies
        ],
        "evidence": [
            {
                "evidenceId": e["evidence_id"],
                "revisionId": e.get("revision_id"),
                "upstreamType": e["upstream_type"],
                "upstreamId": e["upstream_id"],
                "versionRef": e.get("version_ref"),
                "locator": e.get("locator"),
                "summary": e.get("summary"),
                "publishedAt": e.get("published_at"),
                "availabilityAt": e.get("availability_at"),
                "pitStatus": e["pit_status"],
                "pitNote": e.get("pit_note"),
            }
            for e in evidence
        ],
        "reviews": [
            {
                "reviewId": r["review_id"],
                "revisionId": r["revision_id"],
                "decision": r["decision"],
                "reason": r.get("reason"),
                "categories": r.get("categories", []),
                "reviewer": r.get("reviewer"),
                "reviewedAt": r["reviewed_at"],
            }
            for r in reviews
        ],
        "observations": [
            {
                "observationId": o["observation_id"],
                "revisionId": o.get("revision_id"),
                "windowStart": o["window_start"],
                "windowEnd": o["window_end"],
                "outcome": o["outcome"],
                "content": o["content"],
                "refs": o.get("refs", []),
                "createdAt": o["created_at"],
            }
            for o in observations
        ],
    }


# ---------- POST /api/cases/{case_id}/review ----------


@router.post("/cases/{case_id}/review")
async def post_review(case_id: str, req: ReviewRequest):
    """审核 Case"""
    if req.decision not in DECISIONS:
        raise HTTPException(status_code=400, detail="decision 必须是 approve / request_changes / reject")

    if req.decision != "approve" and not req.reason:
        if req.decision == "reject":
            raise HTTPException(status_code=400, detail="拒绝原因为必填项")
        else:
            raise HTTPException(status_code=400, detail="修改意见为必填项")

    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] != "reviewing":
        raise HTTPException(
            status_code=409,
            detail=f"Case 当前状态为 {c['status']}，仅 Reviewing 状态可执行审核操作",
        )

    # 目标 revision
    if req.revisionId:
        rev = await fetch_one(
            """
            SELECT revision_id, frozen_at::text, status FROM cases.case_revision
            WHERE case_id = $1 AND revision_id = $2
            """,
            case_id,
            req.revisionId,
        )
    else:
        rev = await fetch_one(
            """
            SELECT revision_id, frozen_at::text, status FROM cases.case_revision
            WHERE case_id = $1 AND status = 'reviewing'
            ORDER BY revision_no DESC LIMIT 1
            """,
            case_id,
        )

    if not rev:
        raise HTTPException(status_code=404, detail="无可审核的 Revision（未找到 reviewing 状态版本）")

    review_id = gen_id("RV")
    reviewer = req.reviewer or "human"
    categories = req.categories or []

    pool = await get_pool()
    async with pool.transaction():
        if req.decision == "approve":
            if rev["frozen_at"]:
                raise HTTPException(status_code=409, detail=f"Revision {rev['revision_id']} 已冻结，不可变更")

            upd = await fetch_one(
                """
                UPDATE cases.case_revision
                SET status = 'frozen', frozen_at = now(), updated_at = now()
                WHERE revision_id = $1 AND frozen_at IS NULL
                RETURNING revision_id
                """,
                rev["revision_id"],
            )
            if not upd:
                raise HTTPException(status_code=409, detail=f"Revision {rev['revision_id']} 已冻结，不可变更")

            await execute(
                """
                INSERT INTO cases.review_record
                  (review_id, case_id, revision_id, decision, reason, categories, reviewer)
                VALUES ($1, $2, $3, 'approve', $4, $5, $6)
                """,
                review_id,
                case_id,
                rev["revision_id"],
                req.reason or "",
                categories,
                reviewer,
            )
            await execute(
                'UPDATE cases."case" SET status = \'frozen\', updated_at = now() WHERE case_id = $1',
                case_id,
            )

            return {
                "caseId": case_id,
                "revisionId": rev["revision_id"],
                "decision": req.decision,
                "caseStatus": "frozen",
                "reviewId": review_id,
                "note": "Revision 已冻结；此后对该 Revision 的 UPDATE 将被拒绝，仅可追加 Observation",
            }

        elif req.decision == "request_changes":
            # 冻结当前 revision（不可变）
            frozen = await fetch_one(
                """
                UPDATE cases.case_revision
                SET status = 'frozen', frozen_at = now(), updated_at = now()
                WHERE revision_id = $1 AND frozen_at IS NULL
                RETURNING revision_id, revision_no
                """,
                rev["revision_id"],
            )
            if not frozen:
                raise HTTPException(status_code=409, detail=f"Revision {rev['revision_id']} 已冻结，不可变更")

            # 创建新 revision
            new_rev_no = frozen["revision_no"] + 1
            new_revision_id = f"{case_id}-R{new_rev_no}"
            await execute(
                """
                INSERT INTO cases.case_revision (revision_id, case_id, revision_no, status, created_by)
                VALUES ($1, $2, $3, 'draft', 'agent')
                """,
                new_revision_id,
                case_id,
                new_rev_no,
            )

            await execute(
                """
                INSERT INTO cases.review_record
                  (review_id, case_id, revision_id, decision, reason, categories, reviewer)
                VALUES ($1, $2, $3, 'request_changes', $4, $5, $6)
                """,
                review_id,
                case_id,
                frozen["revision_id"],
                req.reason,
                categories,
                reviewer,
            )
            await execute(
                'UPDATE cases."case" SET status = \'researching\', updated_at = now() WHERE case_id = $1',
                case_id,
            )

            return {
                "caseId": case_id,
                "frozenRevisionId": frozen["revision_id"],
                "frozenRevisionNo": frozen["revision_no"],
                "newRevisionId": new_revision_id,
                "newRevisionNo": new_rev_no,
                "decision": req.decision,
                "caseStatus": "researching",
                "reviewId": review_id,
                "note": "原 Revision 已冻结；新 Revision 已创建为 draft",
            }

        else:  # reject
            await execute(
                """
                INSERT INTO cases.review_record
                  (review_id, case_id, revision_id, decision, reason, categories, reviewer)
                VALUES ($1, $2, $3, 'reject', $4, $5, $6)
                """,
                review_id,
                case_id,
                rev["revision_id"],
                req.reason,
                categories,
                reviewer,
            )
            await execute(
                'UPDATE cases."case" SET status = \'rejected\', updated_at = now() WHERE case_id = $1',
                case_id,
            )

            return {
                "caseId": case_id,
                "revisionId": rev["revision_id"],
                "decision": req.decision,
                "caseStatus": "rejected",
                "reviewId": review_id,
            }


# ---------- POST /api/cases/{case_id}/observations ----------


@router.post("/cases/{case_id}/observations", status_code=201)
async def post_observation(case_id: str, req: ObservationRequest):
    """追加 Observation"""
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] not in ("frozen", "observing"):
        raise HTTPException(
            status_code=409,
            detail=f"Case 当前状态为 {c['status']}，仅 Frozen / Observing 状态可追加 Observation",
        )

    if not req.content or not req.content.strip():
        raise HTTPException(status_code=400, detail="观察内容为必填项")

    if req.outcome not in OUTCOMES:
        raise HTTPException(
            status_code=400,
            detail="outcome 必须是 support / oppose / mixed / no_change / indeterminate",
        )

    try:
        ws = datetime.fromisoformat(req.windowStart.replace("Z", "+00:00"))
        we = datetime.fromisoformat(req.windowEnd.replace("Z", "+00:00"))
        if we < ws:
            raise HTTPException(status_code=400, detail="观察窗口无效（结束不得早于开始）")
    except ValueError:
        raise HTTPException(status_code=400, detail="观察窗口时间格式无效")

    observation_id = gen_id("OB")

    pool = await get_pool()
    async with pool.transaction():
        await execute(
            """
            INSERT INTO cases.observation
              (observation_id, case_id, window_start, window_end, outcome, content, refs)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            observation_id,
            case_id,
            req.windowStart,
            req.windowEnd,
            req.outcome,
            req.content,
            req.refs,
        )

        if c["status"] == "frozen":
            await execute(
                'UPDATE cases."case" SET status = \'observing\', updated_at = now() WHERE case_id = $1',
                case_id,
            )
        else:
            await execute(
                'UPDATE cases."case" SET updated_at = now() WHERE case_id = $1',
                case_id,
            )

    return {
        "observationId": observation_id,
        "caseId": case_id,
        "caseStatus": "observing" if c["status"] == "frozen" else c["status"],
        "createdAt": now_iso(),
    }


# ---------- GET /api/runs ----------


@router.get("/runs")
async def run_list(status: Optional[str] = Query(None, description="状态筛选")):
    """查询 Agent Run 列表"""
    if status:
        rows = await fetch_all(
            """
            SELECT run_id, run_type, date_scope, stage, status,
                   started_at::text, finished_at::text,
                   processed_count, success_count, failed_count, error, retryable
            FROM cases.agent_run
            WHERE status = $1
            ORDER BY started_at DESC
            """,
            status,
        )
    else:
        rows = await fetch_all(
            """
            SELECT run_id, run_type, date_scope, stage, status,
                   started_at::text, finished_at::text,
                   processed_count, success_count, failed_count, error, retryable
            FROM cases.agent_run
            ORDER BY started_at DESC
            """
        )

    runs = [
        {
            "runId": r["run_id"],
            "runType": r["run_type"],
            "dateScope": r.get("date_scope"),
            "stage": r["stage"],
            "status": r["status"],
            "startedAt": r["started_at"],
            "finishedAt": r.get("finished_at"),
            "processedCount": r["processed_count"],
            "successCount": r["success_count"],
            "failedCount": r["failed_count"],
            "error": r.get("error"),
            "retryable": r["retryable"],
        }
        for r in rows
    ]

    return {
        "runs": runs,
        "footer": {
            "total": len(runs),
            "running": sum(1 for r in runs if r["status"] == "running"),
            "failed": sum(1 for r in runs if r["status"] == "failed"),
        },
    }


# ---------- GET /api/runs/{run_id} ----------


@router.get("/runs/{run_id}")
async def run_detail(run_id: str):
    """查询 Agent Run 详情"""
    r = await fetch_one(
        """
        SELECT run_id, run_type, date_scope, stage, status,
               started_at::text, finished_at::text,
               processed_count, success_count, failed_count, outputs, error, retryable
        FROM cases.agent_run
        WHERE run_id = $1
        """,
        run_id,
    )
    if not r:
        raise HTTPException(status_code=404, detail=f"Run 不存在：{run_id}")

    return {
        "run": {
            "runId": r["run_id"],
            "runType": r["run_type"],
            "dateScope": r.get("date_scope"),
            "stage": r["stage"],
            "status": r["status"],
            "startedAt": r["started_at"],
            "finishedAt": r.get("finished_at"),
            "processedCount": r["processed_count"],
            "successCount": r["success_count"],
            "failedCount": r["failed_count"],
            "outputs": r.get("outputs"),
            "error": r.get("error"),
            "retryable": r["retryable"],
        }
    }


# ---------- GET /api/search ----------


@router.get("/search")
async def search(q: str = Query(..., description="搜索关键词")):
    """全局搜索：涨停观察、Episode、Case、Run"""
    if not q or not q.strip():
        raise HTTPException(status_code=400, detail="搜索关键词为空")

    like = f"%{q}%"
    prefix_like = f"{q}%"

    # ① 涨停观察
    code_rows = await fetch_all(
        """
        SELECT DISTINCT ON (o.stock_code)
               o.stock_code, s.display_name, o.trade_date::text, o.change_pct::text, o.source_snapshot_id
        FROM research.market_limit_up_observation o
        LEFT JOIN LATERAL (
            SELECT display_name FROM ju.stocks js
            WHERE js.stock_code = o.stock_code
              AND js.start_date <= o.trade_date
              AND (js.end_date IS NULL OR js.end_date >= o.trade_date)
            LIMIT 1
        ) s ON true
        WHERE o.stock_code LIKE $1
        ORDER BY o.stock_code, o.trade_date DESC
        LIMIT 5
        """,
        prefix_like,
    )

    name_stocks = await fetch_all(
        "SELECT stock_code FROM ju.stocks WHERE display_name ILIKE $1 LIMIT 5",
        like,
    )

    name_rows = []
    if name_stocks:
        codes = [r["stock_code"] for r in name_stocks]
        name_rows = await fetch_all(
            """
            SELECT DISTINCT ON (o.stock_code)
                   o.stock_code, s.display_name, o.trade_date::text, o.change_pct::text, o.source_snapshot_id
            FROM research.market_limit_up_observation o
            LEFT JOIN LATERAL (
                SELECT display_name FROM ju.stocks js
                WHERE js.stock_code = o.stock_code
                  AND js.start_date <= o.trade_date
                  AND (js.end_date IS NULL OR js.end_date >= o.trade_date)
                LIMIT 1
            ) s ON true
            WHERE o.stock_code = ANY($1)
            ORDER BY o.stock_code, o.trade_date DESC
            LIMIT 5
            """,
            codes,
        )

    # 合并去重
    seen = set()
    observations = []
    for r in code_rows + name_rows:
        if r["stock_code"] not in seen:
            seen.add(r["stock_code"])
            observations.append({
                "stockCode": r["stock_code"],
                "name": r.get("display_name"),
                "date": r["trade_date"],
                "changePct": float(r["change_pct"]) if r["change_pct"] else None,
                "snapshotId": r["source_snapshot_id"],
            })
            if len(observations) >= 5:
                break

    # ② Episode
    ep_rows = await fetch_all(
        """
        SELECT e.episode_id::text, e.theme_id::text, t.theme_name, e.status::text,
               e.start_date::text, e.end_date::text
        FROM research.theme_episode e
        JOIN research.theme t ON t.theme_id = e.theme_id
        WHERE t.theme_name ILIKE $1 OR e.episode_id::text ILIKE $2
        ORDER BY e.start_date DESC
        LIMIT 5
        """,
        like,
        prefix_like,
    )

    # ③ Case
    case_rows = await fetch_all(
        """
        SELECT case_id, title, status, is_fixture
        FROM cases."case"
        WHERE case_id ILIKE $1 OR title ILIKE $1 OR research_question ILIKE $1
        ORDER BY updated_at DESC
        LIMIT 5
        """,
        like,
    )

    # ④ Run
    run_rows = await fetch_all(
        """
        SELECT run_id, run_type, status, started_at::text
        FROM cases.agent_run
        WHERE run_id ILIKE $1 OR run_type ILIKE $1 OR coalesce(error, '') ILIKE $1
        ORDER BY started_at DESC
        LIMIT 5
        """,
        like,
    )

    return {
        "query": q,
        "observations": observations,
        "episodes": [
            {
                "episodeId": e["episode_id"],
                "themeId": e["theme_id"],
                "themeName": e["theme_name"],
                "status": e["status"],
                "startDate": e["start_date"],
                "endDate": e["end_date"],
            }
            for e in ep_rows
        ],
        "cases": [
            {
                "caseId": c["case_id"],
                "title": c["title"],
                "status": c["status"],
                "isFixture": c["is_fixture"],
            }
            for c in case_rows
        ],
        "runs": [
            {
                "runId": r["run_id"],
                "runType": r["run_type"],
                "status": r["status"],
                "startedAt": r["started_at"],
            }
            for r in run_rows
        ],
    }
