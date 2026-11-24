import pytest_asyncio
from nooshare_cases.web import db


@pytest_asyncio.fixture(autouse=True)
async def reset_db_pool():
    if db._pool is not None:
        try:
            await db._pool.close()
        except Exception:
            pass
        db._pool = None

    yield

    if db._pool is not None:
        try:
            await db._pool.close()
        except Exception:
            pass
        db._pool = None
