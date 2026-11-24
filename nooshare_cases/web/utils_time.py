"""
G3: 时区与交易日历工具
施工手册 5.4 节：中国 A 股交易日统一使用 Asia/Shanghai 时区
"""
from datetime import datetime, date, timezone, timedelta
from typing import Optional

# Asia/Shanghai 时区定义（UTC+8）
SHANGHAI_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")


def now_shanghai() -> datetime:
    """返回当前 Asia/Shanghai 时区的 datetime"""
    return datetime.now(SHANGHAI_TZ)


def parse_to_shanghai(dt_str: str) -> datetime:
    """
    解析时间字符串并转换为 Asia/Shanghai 时区
    支持格式：
    - 2025-12-31T15:00:00+08:00
    - 2025-12-31T15:00:00Z (UTC)
    - 2025-12-31T15:00:00 (无时区，假定 Asia/Shanghai)
    """
    if not dt_str:
        raise ValueError("时间字符串不能为空")
    
    # 处理 Z 后缀
    dt_str = dt_str.replace("Z", "+00:00")
    
    try:
        dt = datetime.fromisoformat(dt_str)
    except ValueError as e:
        raise ValueError(f"无法解析时间字符串: {dt_str}, 错误: {e}")
    
    # 如果无时区信息，假定 Asia/Shanghai
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SHANGHAI_TZ)
    else:
        # 转换为 Asia/Shanghai
        dt = dt.astimezone(SHANGHAI_TZ)
    
    return dt


def format_shanghai(dt: datetime) -> str:
    """格式化 datetime 为 Asia/Shanghai 时区字符串"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=SHANGHAI_TZ)
    else:
        dt = dt.astimezone(SHANGHAI_TZ)
    return dt.isoformat()


# 简易交易日历（2025-12-28 至 2026-01-05）
# 实际生产环境应从数据库或 API 加载完整交易日历
_TRADING_DAYS_2025_2026 = {
    # 2025-12 月最后几个交易日
    "2025-12-29", "2025-12-30", "2025-12-31",
    # 2026-01 月前几个交易日（元旦假期后）
    "2026-01-02", "2026-01-05",
}


def is_trading_day(d: date) -> bool:
    """
    判断是否为 A 股交易日
    当前为简易实现，覆盖 2025-12-28 至 2026-01-05
    周末和元旦假期不是交易日
    """
    return d.isoformat() in _TRADING_DAYS_2025_2026


def validate_trading_day(d: date, field_name: str = "日期") -> None:
    """
    校验日期是否为交易日，如果不是则抛出 ValueError
    """
    if not is_trading_day(d):
        weekday_names = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
        weekday = weekday_names[d.weekday()]
        raise ValueError(
            f"{field_name} {d.isoformat()} 不是 A 股交易日（{weekday}）。"
            f"研究时点和 info_cutoff 必须对齐到交易日。"
        )
