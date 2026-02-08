# -*- coding: utf-8 -*-
"""
DS2API - DeepSeek to OpenAI API 转换服务

支持:
- OpenAI 兼容接口: /v1/chat/completions, /v1/models
- Claude 兼容接口: /anthropic/v1/messages, /anthropic/v1/models

使用方法:
    本地开发: python dev.py
    生产环境: uvicorn app:app --host 0.0.0.0 --port 5001
    Vercel: 自动部署
"""
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import IS_VERCEL, logger

# 创建 FastAPI 应用
app = FastAPI(
    title="DS2API",
    description="DeepSeek to OpenAI/Claude API",
    version="1.0.0",
)


# 全局异常处理
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"[unhandled_exception] {request.method} {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": {"type": "api_error", "message": "Internal Server Error"}},
    )


# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# 注册路由
from routes.openai import router as openai_router
from routes.claude import router as claude_router
from routes.home import router as home_router
from routes.admin import router as admin_router

app.include_router(openai_router)
app.include_router(claude_router)
# admin_router 必须在 home_router 之前，否则 home.py 的 /admin/{path:path} 会拦截 admin API
app.include_router(admin_router)
app.include_router(home_router)


# ----------------------------------------------------------------------
# 本地运行入口
# ----------------------------------------------------------------------
if __name__ == "__main__" and not IS_VERCEL:
    import uvicorn

    port = int(os.getenv("PORT", "5001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
