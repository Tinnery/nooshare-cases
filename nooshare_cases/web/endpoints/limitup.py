"""涨停数据 API 端点"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, field_serializer

from ..db import fetch_all, fetch_one

router = APIRouter()


def _clean_decimals(obj):
    """Recursively convert Decimal to float/int in nested dicts/lists."""
    if isinstance(obj, Decimal):
        return float(obj) if obj % 1 != 0 else int(obj)
    elif isinstance(obj, dict):
        return {k: _clean_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_clean_decimals(v) for v in obj]
    return obj



class LimitUpStock(BaseModel):
    stock_code: str
    stock_name: Optional[str] = None
    trade_date: date
    latest_price: Optional[float] = None
    change_pct: Optional[float] = None
    limit_up_status: Optional[str] = None
    limit_up_type: Optional[str] = None
    limit_up_seal_amount: Optional[float] = None
    limit_up_seal_volume: Optional[float] = None
    first_limit_up_time: Optional[str] = None
    continuous_days: Optional[int] = None
    limit_up_open_count: Optional[int] = None
    limit_up_reason: Optional[str] = None
    days_boards: Optional[str] = None
    market_type: Optional[str] = None
    circulating_market_cap: Optional[float] = None
    seal_vol_ratio: Optional[float] = None
    seal_cap_ratio: Optional[float] = None


class DailyLimitUpSummary(BaseModel):
    trade_date: date
    total_count: int
    continuous_count: int  # 连板股数量（>=2板）
    max_continuous_days: int  # 最高连板天数
    top_leaders: List[LimitUpStock]  # 龙头股（连板天数最多的前5只）


@router.get("/daily")
async def get_daily_limit_up(
    trade_date: Optional[date] = Query(None, description="交易日期，不传则返回最新日期"),
):
    """
    获取指定日期的涨停数据
    
    返回：
    - 当日涨停统计（总数、连板数、最高连板）
    - 龙头股列表（按连板天数排序）
    - 全部涨停股列表
    """
    # 如果没指定日期，获取最新日期
    if trade_date is None:
        row = await fetch_one(
            "SELECT MAX(trade_date) as latest_date FROM iwen.limit_up"
        )
        if not row or not row["latest_date"]:
            raise HTTPException(status_code=404, detail="无涨停数据")
        trade_date = row["latest_date"]
    
    # 获取当日所有涨停股
    rows = await fetch_all(
        """
        SELECT 
            stock_code, stock_name, trade_date, latest_price, change_pct,
            limit_up_status, limit_up_type, limit_up_seal_amount, 
            limit_up_seal_volume, first_limit_up_time, continuous_days,
            limit_up_open_count, limit_up_reason, days_boards, market_type,
            circulating_market_cap, seal_vol_ratio, seal_cap_ratio
        FROM iwen.limit_up
        WHERE trade_date = $1
        ORDER BY continuous_days DESC NULLS LAST, stock_code
        """,
        trade_date,
    )
    
    if not rows:
        raise HTTPException(status_code=404, detail=f"{trade_date} 无涨停数据")
    
    # 统计
    total_count = len(rows)
    continuous_count = sum(1 for r in rows if r.get("continuous_days") and int(r["continuous_days"]) >= 2)
    max_continuous_days = max((int(r.get("continuous_days") or 0)) for r in rows)
    
    # 龙头股（连板天数最多的前5只）
    top_leaders = [
        LimitUpStock(**r)
        for r in rows[:5]
        if r.get("continuous_days") and r["continuous_days"] >= 2
    ]
    
    # 全部涨停股
    all_stocks = [LimitUpStock(**r) for r in rows]
    
    return _clean_decimals({
        "trade_date": trade_date,
        "total_count": total_count,
        "continuous_count": continuous_count,
        "max_continuous_days": max_continuous_days,
        "top_leaders": [r.model_dump() for r in top_leaders],
        "all_stocks": [r.model_dump() for r in all_stocks],
    })


@router.get("/dates")
async def get_limit_up_dates(
    limit: int = Query(30, ge=1, le=365, description="返回数量"),
):
    """
    获取有涨停数据的交易日期列表（最近N个）
    """
    rows = await fetch_all(
        """
        SELECT 
            trade_date,
            COUNT(*) as stock_count,
            COUNT(CASE WHEN continuous_days >= 2 THEN 1 END) as continuous_count,
            MAX(continuous_days) as max_continuous_days
        FROM iwen.limit_up
        GROUP BY trade_date
        ORDER BY trade_date DESC
        LIMIT $1
        """,
        limit,
    )
    
    return _clean_decimals([
        {
            "trade_date": r["trade_date"],
            "stock_count": int(r["stock_count"]),
            "continuous_count": int(r["continuous_count"]),
            "max_continuous_days": int(r["max_continuous_days"]),
        }
        for r in rows
    ])


@router.get("/stock/{stock_code}")
async def get_stock_limit_up_history(
    stock_code: str,
    start_date: Optional[date] = Query(None, description="开始日期"),
    end_date: Optional[date] = Query(None, description="结束日期"),
):
    """
    获取某只股票的涨停历史
    """
    sql = """
        SELECT 
            stock_code, stock_name, trade_date, latest_price, change_pct,
            limit_up_status, limit_up_type, limit_up_seal_amount, 
            limit_up_seal_volume, first_limit_up_time, continuous_days,
            limit_up_open_count, limit_up_reason, days_boards, market_type,
            circulating_market_cap, seal_vol_ratio, seal_cap_ratio
        FROM iwen.limit_up
        WHERE stock_code = $1
    """
    params = [stock_code]
    
    if start_date:
        sql += " AND trade_date >= $2"
        params.append(start_date)
    
    if end_date:
        param_idx = len(params) + 1
        sql += f" AND trade_date <= ${param_idx}"
        params.append(end_date)
    
    sql += " ORDER BY trade_date DESC"
    
    rows = await fetch_all(sql, *params)
    
    if not rows:
        raise HTTPException(status_code=404, detail=f"股票 {stock_code} 无涨停记录")
    
    return _clean_decimals({
        "stock_code": stock_code,
        "records": [LimitUpStock(**r).model_dump() for r in rows],
    })


@router.get("/leaders")
async def get_leaders(
    trade_date: Optional[date] = Query(None, description="交易日期，不传则返回最新日期"),
    top_n: int = Query(10, ge=1, le=50, description="返回前N名龙头股"),
):
    """
    获取龙头股排行
    
    龙头股评分维度：
    - 连板高度（40%权重）
    - 板块效应（25%权重）- 暂用涨停原因分类替代
    - 封板质量（20%权重）
    - 市场认可度（15%权重）- 暂用首次封板时间替代
    """
    # 如果没指定日期，获取最新日期
    if trade_date is None:
        row = await fetch_one(
            "SELECT MAX(trade_date) as latest_date FROM iwen.limit_up"
        )
        if not row or not row["latest_date"]:
            raise HTTPException(status_code=404, detail="无涨停数据")
        trade_date = row["latest_date"]
    
    # 获取当日涨停股（至少2板以上）
    rows = await fetch_all(
        """
        SELECT 
            stock_code, stock_name, trade_date, latest_price, change_pct,
            limit_up_status, limit_up_type, limit_up_seal_amount, 
            limit_up_seal_volume, first_limit_up_time, continuous_days,
            limit_up_open_count, limit_up_reason, days_boards, market_type,
            circulating_market_cap, seal_vol_ratio, seal_cap_ratio
        FROM iwen.limit_up
        WHERE trade_date = $1 AND continuous_days >= 2
        ORDER BY continuous_days DESC NULLS LAST, 
                 limit_up_seal_amount DESC NULLS LAST,
                 stock_code
        LIMIT $2
        """,
        trade_date,
        top_n,
    )
    
    if not rows:
        return {
            "trade_date": trade_date,
            "leaders": [],
        }
    
    # 计算龙头得分（简化版）
    leaders = []
    for r in rows:
        continuous_days = int(r.get("continuous_days") or 0)
        
        # 连板高度得分（0-100）
        if continuous_days <= 1:
            height_score = 0
        elif continuous_days == 2:
            height_score = 40
        elif continuous_days == 3:
            height_score = 70
        else:
            height_score = 100
        
        # 封板质量得分（简化：基于封单额）
        seal_amount = float(r.get("limit_up_seal_amount") or 0)
        seal_score = min(seal_amount / 10000000, 100)  # 封单额/1000万，上限100
        
        # 时间衰减权重（首次封板时间越早越好）
        first_time = r.get("first_limit_up_time") or "15:00"
        try:
            hour = int(first_time.split(":")[0])
            minute = int(first_time.split(":")[1]) if len(first_time.split(":")) > 1 else 0
            hour_float = hour + minute / 60.0
            
            if hour_float <= 10.0:
                time_weight = 1.0
            elif hour_float >= 14.5:
                time_weight = 0.3
            else:
                time_weight = 1.0 - (hour_float - 10.0) / 4.5 * 0.7
        except:
            time_weight = 0.5
        
        # 综合得分
        leader_score = float(
            height_score * 0.40 +
            seal_score * 0.20 +
            time_weight * 100 * 0.15
        )
        
        leaders.append({
            **r,
            "leader_score": round(leader_score, 2),
            "height_score": height_score,
            "seal_score": round(seal_score, 2),
            "time_weight": round(time_weight, 2),
        })
    
    # 按龙头得分排序
    leaders.sort(key=lambda x: x["leader_score"], reverse=True)
    
    return _clean_decimals({
        "trade_date": trade_date,
        "leaders": leaders,
    })
