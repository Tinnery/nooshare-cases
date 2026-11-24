"""Case 生命周期 API 端点 — Batch 1

实现完整的 Case 研究闭环：
- 开始研究（candidate → researching）
- 编辑 Revision（input_manifest、judgment）
- 管理 Companies（增删改）
- 管理 Evidence（增删改）
- 提交 Revision 进入审核
- 创建新 Revision（request_changes 时）
"""

from fastapi import APIRouter, HTTPException
from typing import Optional, List, Any, Dict
from datetime import datetime, date
from ..utils_time import parse_to_shanghai
from pydantic import BaseModel
import uuid
import time

from ..db import fetch_all, fetch_one, execute, get_pool

router = APIRouter()


def gen_id(prefix: str) -> str:
    ts = int(time.time() * 1000)
    rand = uuid.uuid4().hex[:6]
    return f"{prefix}-{ts:x}-{rand}"


def now_iso() -> str:
    return datetime.utcnow().isoformat()


# ---------- Models ----------


class RevisionUpdateRequest(BaseModel):
    inputManifest: Optional[Dict[str, Any]] = None
    judgment: Optional[Dict[str, Any]] = None


class CompanyRequest(BaseModel):
    stockCode: str
    companyName: str
    role: str
    rationale: str = ""
    evidenceRefs: List[str] = []
    marketResponseStatus: Optional[str] = None


class EvidenceRequest(BaseModel):
    upstreamType: str
    upstreamId: str
    locator: str
    summary: str = ""
    publishedAt: Optional[str] = None
    availabilityAt: Optional[str] = None
    pitStatus: str = "unverified"
    pitNote: Optional[str] = None
    revisionId: Optional[str] = None


# ---------- POST /api/cases/{case_id}/start_research ----------


@router.post("/cases/{case_id}/start_research")
async def start_research(case_id: str):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] != "candidate":
        raise HTTPException(
            status_code=409,
            detail=f"Case 当前状态为 {c['status']}，仅 candidate 状态可开始研究",
        )

    await execute(
        "UPDATE cases.\"case\" SET status = 'researching', updated_at = now() WHERE case_id = $1",
        case_id,
    )

    return {"caseId": case_id, "status": "researching", "message": "Case 已进入研究阶段"}


# ---------- PUT /api/cases/{case_id}/revisions/{revision_id} ----------


@router.put("/cases/{case_id}/revisions/{revision_id}")
async def update_revision(case_id: str, revision_id: str, req: RevisionUpdateRequest):
    rev = await fetch_one(
        "SELECT status, frozen_at FROM cases.case_revision WHERE revision_id = $1 AND case_id = $2",
        revision_id, case_id,
    )
    if not rev:
        raise HTTPException(status_code=404, detail=f"Revision 不存在：{revision_id}")
    if rev["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Revision 当前状态为 {rev['status']}，仅 draft 状态可编辑")
    if rev["frozen_at"] is not None:
        raise HTTPException(status_code=409, detail="Revision 已冻结，不可修改")

    updates = []
    params = []
    param_idx = 1

    if req.inputManifest is not None:
        updates.append(f"input_manifest = ${param_idx}")
        params.append(req.inputManifest)
        param_idx += 1

    if req.judgment is not None:
        updates.append(f"judgment = ${param_idx}")
        params.append(req.judgment)
        param_idx += 1

    if not updates:
        raise HTTPException(status_code=400, detail="未提供任何更新字段")

    updates.append("updated_at = now()")
    params.extend([revision_id, case_id])

    await execute(
        f"UPDATE cases.case_revision SET {', '.join(updates)} WHERE revision_id = ${param_idx} AND case_id = ${param_idx + 1}",
        *params,
    )

    return {"caseId": case_id, "revisionId": revision_id, "status": "draft", "message": "Revision 已更新"}


# ---------- POST /api/cases/{case_id}/revisions/{revision_id}/submit ----------


@router.post("/cases/{case_id}/revisions/{revision_id}/submit")
async def submit_revision(case_id: str, revision_id: str):
    rev = await fetch_one(
        "SELECT status, frozen_at FROM cases.case_revision WHERE revision_id = $1 AND case_id = $2",
        revision_id, case_id,
    )
    if not rev:
        raise HTTPException(status_code=404, detail=f"Revision 不存在：{revision_id}")
    if rev["status"] != "draft":
        raise HTTPException(status_code=409, detail=f"Revision 当前状态为 {rev['status']}，仅 draft 状态可提交审核")

    await execute("UPDATE cases.case_revision SET status = 'reviewing', updated_at = now() WHERE revision_id = $1", revision_id)
    await execute("UPDATE cases.\"case\" SET status = 'reviewing', updated_at = now() WHERE case_id = $1", case_id)

    return {"caseId": case_id, "revisionId": revision_id, "status": "reviewing", "message": "Revision 已提交审核"}


# ---------- POST /api/cases/{case_id}/companies ----------


@router.post("/cases/{case_id}/companies", status_code=201)
async def add_company(case_id: str, req: CompanyRequest):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] not in ("candidate", "researching"):
        raise HTTPException(status_code=409, detail=f"Case 当前状态为 {c['status']}，仅 candidate/researching 状态可添加企业")

    valid_roles = ["seed", "directly_related", "similar", "potential_beneficiary", "non_responder", "counterexample", "excluded"]
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"role 必须是 {valid_roles} 之一")

    existing = await fetch_one(
        "SELECT stock_code FROM cases.company_participation WHERE case_id = $1 AND stock_code = $2",
        case_id, req.stockCode,
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"企业 {req.stockCode} 已存在")

    await execute(
        "INSERT INTO cases.company_participation (case_id, stock_code, company_name, role, rationale, evidence_refs, market_response_status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        case_id, req.stockCode, req.companyName, req.role, req.rationale, req.evidenceRefs, req.marketResponseStatus,
    )

    return {"caseId": case_id, "stockCode": req.stockCode, "companyName": req.companyName, "role": req.role, "message": "企业参与样本已添加"}


# ---------- PUT /api/cases/{case_id}/companies/{stock_code} ----------


@router.put("/cases/{case_id}/companies/{stock_code}")
async def update_company(case_id: str, stock_code: str, req: CompanyRequest):
    existing = await fetch_one(
        "SELECT stock_code FROM cases.company_participation WHERE case_id = $1 AND stock_code = $2",
        case_id, stock_code,
    )
    if not existing:
        raise HTTPException(status_code=404, detail=f"企业 {stock_code} 不存在")

    valid_roles = ["seed", "directly_related", "similar", "potential_beneficiary", "non_responder", "counterexample", "excluded"]
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"role 必须是 {valid_roles} 之一")

    await execute(
        "UPDATE cases.company_participation SET company_name = $1, role = $2, rationale = $3, evidence_refs = $4, market_response_status = $5, updated_at = now() WHERE case_id = $6 AND stock_code = $7",
        req.companyName, req.role, req.rationale, req.evidenceRefs, req.marketResponseStatus, case_id, stock_code,
    )

    return {"caseId": case_id, "stockCode": stock_code, "message": "企业参与样本已更新"}


# ---------- DELETE /api/cases/{case_id}/companies/{stock_code} ----------


@router.delete("/cases/{case_id}/companies/{stock_code}")
async def delete_company(case_id: str, stock_code: str):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] not in ("candidate", "researching"):
        raise HTTPException(status_code=409, detail=f"Case 当前状态为 {c['status']}，仅 candidate/researching 状态可删除企业")

    await execute("DELETE FROM cases.company_participation WHERE case_id = $1 AND stock_code = $2", case_id, stock_code)

    return {"caseId": case_id, "stockCode": stock_code, "message": "企业参与样本已删除"}


# ---------- POST /api/cases/{case_id}/evidence ----------


@router.post("/cases/{case_id}/evidence", status_code=201)
async def add_evidence(case_id: str, req: EvidenceRequest):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] not in ("candidate", "researching"):
        raise HTTPException(status_code=409, detail=f"Case 当前状态为 {c['status']}，仅 candidate/researching 状态可添加证据")

    # G3 PIT 约束：查询 case 的 info_cutoff
    case_info = await fetch_one(
        'SELECT info_cutoff FROM cases."case" WHERE case_id = $1',
        case_id
    )
    info_cutoff = case_info.get("info_cutoff") if case_info else None
    
    # G3 PIT 约束：如果 availability_at 晚于 info_cutoff，拒绝或标记为 unverified
    if req.availabilityAt and info_cutoff:
        try:
            from datetime import datetime
            avail_at = parse_to_shanghai(req.availabilityAt)
            cutoff = parse_to_shanghai(info_cutoff) if isinstance(info_cutoff, str) else info_cutoff
            if avail_at > cutoff:
                # 强制标记为 unverified，并在 pit_note 中说明
                if req.pitStatus == "verified":
                    raise HTTPException(
                        status_code=400,
                        detail=f"证据 availability_at ({req.availabilityAt}) 晚于 info_cutoff ({info_cutoff})，不能标记为 verified"
                    )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"日期格式无效: {e}")

    valid_types = ["document", "frame", "business_fact", "market_observation", "other"]
    if req.upstreamType not in valid_types:
        raise HTTPException(status_code=400, detail=f"upstreamType 必须是 {valid_types} 之一")

    valid_statuses = ["verified", "unverified", "unresolved", "unavailable"]
    if req.pitStatus not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"pitStatus 必须是 {valid_statuses} 之一")

    evidence_id = gen_id("E")

    await execute(
        "INSERT INTO cases.evidence_reference (evidence_id, case_id, revision_id, upstream_type, upstream_id, locator, summary, published_at, availability_at, pit_status, pit_note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        evidence_id, case_id, req.revisionId, req.upstreamType, req.upstreamId, req.locator, req.summary, req.publishedAt, req.availabilityAt, req.pitStatus, req.pitNote,
    )

    return {"evidenceId": evidence_id, "caseId": case_id, "message": "证据引用已添加"}


# ---------- PUT /api/cases/{case_id}/evidence/{evidence_id} ----------


@router.put("/cases/{case_id}/evidence/{evidence_id}")
async def update_evidence(case_id: str, evidence_id: str, req: EvidenceRequest):
    ev = await fetch_one(
        "SELECT evidence_id FROM cases.evidence_reference WHERE evidence_id = $1 AND case_id = $2",
        evidence_id, case_id,
    )
    if not ev:
        raise HTTPException(status_code=404, detail=f"证据 {evidence_id} 不存在")

    valid_types = ["document", "frame", "business_fact", "market_observation", "other"]
    if req.upstreamType not in valid_types:
        raise HTTPException(status_code=400, detail=f"upstreamType 必须是 {valid_types} 之一")

    valid_statuses = ["verified", "unverified", "unresolved", "unavailable"]
    if req.pitStatus not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"pitStatus 必须是 {valid_statuses} 之一")

    # G3 PIT 约束：查询 case 的 info_cutoff
    case_info = await fetch_one(
        'SELECT info_cutoff FROM cases."case" WHERE case_id = ',
        case_id
    )
    info_cutoff = case_info.get("info_cutoff") if case_info else None
    
    # G3 PIT 约束：如果 availability_at 晚于 info_cutoff，拒绝或标记为 unverified
    if req.availabilityAt and info_cutoff:
        try:
            from datetime import datetime
            avail_at = parse_to_shanghai(req.availabilityAt)
            cutoff = parse_to_shanghai(info_cutoff) if isinstance(info_cutoff, str) else info_cutoff
            if avail_at > cutoff:
                # 强制标记为 unverified，并在 pit_note 中说明
                if req.pitStatus == "verified":
                    raise HTTPException(
                        status_code=400,
                        detail=f"证据 availability_at ({req.availabilityAt}) 晚于 info_cutoff ({info_cutoff})，不能标记为 verified"
                    )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"日期格式无效: {e}")

    await execute(
        "UPDATE cases.evidence_reference SET revision_id = $1, upstream_type = $2, upstream_id = $3, locator = $4, summary = $5, published_at = $6, availability_at = $7, pit_status = $8, pit_note = $9, updated_at = now() WHERE evidence_id = $10 AND case_id = $11",
        req.revisionId, req.upstreamType, req.upstreamId, req.locator, req.summary, req.publishedAt, req.availabilityAt, req.pitStatus, req.pitNote, evidence_id, case_id,
    )

    return {"evidenceId": evidence_id, "caseId": case_id, "message": "证据引用已更新"}


# ---------- DELETE /api/cases/{case_id}/evidence/{evidence_id} ----------


@router.delete("/cases/{case_id}/evidence/{evidence_id}")
async def delete_evidence(case_id: str, evidence_id: str):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] not in ("candidate", "researching"):
        raise HTTPException(status_code=409, detail=f"Case 当前状态为 {c['status']}，仅 candidate/researching 状态可删除证据")

    await execute("DELETE FROM cases.evidence_reference WHERE evidence_id = $1 AND case_id = $2", evidence_id, case_id)

    return {"evidenceId": evidence_id, "caseId": case_id, "message": "证据引用已删除"}


# ---------- POST /api/cases/{case_id}/revisions ----------


@router.post("/cases/{case_id}/revisions", status_code=201)
async def create_revision(case_id: str):
    c = await fetch_one('SELECT status FROM cases."case" WHERE case_id = $1', case_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Case 不存在：{case_id}")
    if c["status"] != "researching":
        raise HTTPException(status_code=409, detail=f"Case 当前状态为 {c['status']}，仅 researching 状态可创建新 Revision")

    max_rev = await fetch_one(
        "SELECT MAX(revision_no) as max_no FROM cases.case_revision WHERE case_id = $1",
        case_id,
    )
    new_no = (max_rev["max_no"] or 0) + 1
    revision_id = f"{case_id}-R{new_no}"

    await execute(
        "INSERT INTO cases.case_revision (revision_id, case_id, revision_no, input_manifest, judgment, status) VALUES ($1, $2, $3, '{}', '{}', 'draft')",
        revision_id, case_id, new_no,
    )

    await execute("UPDATE cases.\"case\" SET updated_at = now() WHERE case_id = $1", case_id)

    return {"caseId": case_id, "revisionId": revision_id, "revisionNo": new_no, "status": "draft", "message": f"Revision R{new_no} 已创建"}
