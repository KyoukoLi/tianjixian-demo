"""
天际线 Demo — FastAPI 后端
提供 SSE 流式接口 + 轮询接口 + 前端静态页面
启动：uvicorn main:app --reload --port 8000
"""

import asyncio
import json
import os
import uuid
from typing import Optional, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from mock_engine import generate, StreamEvent

app = FastAPI(title="天际线 Demo API", version="0.1.0")

# 挂载静态文件目录
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# CORS
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
    json_data = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\ndata: {json_data}\n\n"


async def sse_generator(session_id: str, user_message: str):
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
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            content = f.read()
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
            "POST /chat": "流式聊天接口（SSE）",
            "POST /chat/poll": "轮询聊天接口（JSON，适合被代理阻断 SSE 的环境）",
            "GET  /health": "健康检查",
        }
    }


@app.get("/health")
async def health():
    return {"status": "ok"}


# ─────────────────────────────────────────
# SSE 流式接口（优先）
# ─────────────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
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
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Accel-Expires": "0",
        }
    )


# ─────────────────────────────────────────
# 轮询接口（备选，SSE 不通时使用）
# ─────────────────────────────────────────
@app.post("/chat/poll")
async def chat_poll(req: ChatRequest):
    """
    轮询版聊天接口：一次性返回所有事件（JSON 数组）
    用于 SSE 被代理阻断的场景（如 Railway 免费层）
    """
    if not req.message or not req.message.strip():
        return {
            "events": [
                {"type": "error", "data": {"code": "EMPTY_MESSAGE", "message": "消息不能为空"}}
            ]
        }

    session_id = req.session_id or str(uuid.uuid4())
    user_message = req.message.strip()

    events = []
    async for event in generate(session_id, user_message):
        events.append({
            "type": event.event,
            "data": event.data,
        })

    return {
        "session_id": session_id,
        "events": events,
        "mode": "poll",
    }


# ─────────────────────────────────────────
# 启动
# ─────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
