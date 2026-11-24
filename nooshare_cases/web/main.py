"""
Cases Web UI - FastAPI 应用入口
职责：API 路由挂载、静态文件服务、SPA fallback
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from contextlib import asynccontextmanager

from .endpoints import discovery_router, limitup_router, cases_router, case_lifecycle_router
from .db import close_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await close_pool()


app = FastAPI(title="nooshare-cases", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载 API 路由
app.include_router(discovery_router, prefix="/api/discovery")
app.include_router(limitup_router, prefix="/api/limitup")
app.include_router(cases_router, prefix="/api")
app.include_router(case_lifecycle_router, prefix="/api")

# 静态文件服务
dist_path = Path(__file__).parent.parent.parent / "web" / "dist" / "client"


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    index_path = dist_path / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": "nooshare-cases API", "docs": "/docs"}


# SPA fallback：所有非 /api 路径返回 index.html
@app.get("/{path:path}")
async def spa_fallback(path: str):
    # 先尝试静态文件
    file_path = dist_path / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    # 否则返回 index.html（前端路由接管）
    index_path = dist_path / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    raise HTTPException(status_code=404, detail="静态资源未构建（先执行 bun run build）")
