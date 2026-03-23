"""
天际线 Demo — FastAPI 后端
提供 SSE 流式聊天接口 + 前端静态页面
启动：uvicorn main:app --reload --port 8000
"""

import asyncio
import json
import os
import uuid
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    StreamingResponse,
    HTMLResponse,
    FileResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from mock_engine import generate, StreamEvent

app = FastAPI(title="天际线 Demo API", version="0.1.0")

# 挂载静态文件目录
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# CORS：允许前端任意来源访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────
# 请求/响应模型
# ─────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


# ─────────────────────────────────────────
# SSE 事件格式化
# ─────────────────────────────────────────
def format_sse(event: StreamEvent) -> str:
    """将 StreamEvent 格式化为 SSE 格式字符串"""
    json_data = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\ndata: {json_data}\n\n"


async def sse_generator(session_id: str, user_message: str):
    """包装 generate() 为 SSE 格式的异步生成器"""
    try:
        async for event in generate(session_id, user_message):
            yield format_sse(event)
            await asyncio.sleep(0.001)
    except Exception as e:
        error_event = StreamEvent(
            event="error",
            data={
                "code": "MODEL_ERROR",
                "message": str(e),
                "fallback_tag": "neutral",
            }
        )
        yield format_sse(error_event)


# ─────────────────────────────────────────
# 接口
# ─────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def index():
    """返回前端页面"""
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            content = f.read()
        # 注入：API 地址使用当前请求的 origin（同源，无跨域）
        content = content.replace(
            "const getApiBase = () => {",
            "const getApiBase = () => { return window.location.origin;"
        )
        return HTMLResponse(content=content)
    return {"error": "index.html not found"}


@app.get("/api")
async def api_info():
    return {
        "service": "天际线 Demo API",
        "version": "0.1.0",
        "endpoints": {
            "POST /chat": "流式聊天接口（返回 SSE）",
            "GET  /health": "健康检查",
        }
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest):
    """
    流式聊天接口

    请求：
    POST /chat
    {
      "message": "你好呀*微笑*",
      "session_id": "s_abc123"   // 可选，不传则自动生成
    }

    响应：text/event-stream
    """
    if not req.message or not req.message.strip():
        return StreamingResponse(
            iter([format_sse(StreamEvent(
                event="error",
                data={"code": "EMPTY_MESSAGE", "message": "消息不能为空", "fallback_tag": "neutral"}
            ))]),
            media_type="text/event-stream",
        )

    session_id = req.session_id or str(uuid.uuid4())
    user_message = req.message.strip()

    return StreamingResponse(
        sse_generator(session_id, user_message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ─────────────────────────────────────────
# 启动
# ─────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
