"""
天际线 Demo — FastAPI 后端
提供 SSE 流式接口 + 轮询接口 + 前端静态页面
"""

import asyncio
import json
import os
import uuid
from typing import Optional, Dict, Any, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from mock_engine import generate as mock_generate, StreamEvent

app = FastAPI(title="天际线 Demo API", version="0.2.0")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    persona: Optional[Dict[str, Any]] = None
    story: Optional[Dict[str, Any]] = None


def format_sse(event: StreamEvent) -> str:
    json_data = json.dumps(event.data, ensure_ascii=False)
    return f"event: {event.event}\ndata: {json_data}\n\n"


async def sse_generator(session_id: str, user_message: str, persona=None, story=None):
    try:
        async for event in mock_generate(session_id, user_message, persona, story):
            yield format_sse(event)
            await asyncio.sleep(0.001)
    except Exception as e:
        yield format_sse(StreamEvent(
            event="error",
            data={"code": "MODEL_ERROR", "message": str(e), "fallback_tag": "neutral"}
        ))


@app.get("/")
async def index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), headers={"Cache-Control": "no-cache"})
    return {"error": "index.html not found"}


@app.get("/api")
async def api_info():
    return {"service": "天际线 Demo API", "version": "0.2.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


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
        sse_generator(session_id, user_message, req.persona, req.story),
        media_type="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
        }
    )


@app.post("/chat/poll")
async def chat_poll(req: ChatRequest):
    if not req.message or not req.message.strip():
        return {"events": [{"type": "error", "data": {"code": "EMPTY_MESSAGE", "message": "消息不能为空"}}]}

    session_id = req.session_id or str(uuid.uuid4())
    user_message = req.message.strip()

    events = []
    async for event in mock_generate(session_id, user_message, req.persona, req.story):
        events.append({"type": event.event, "data": event.data})

    return {
        "session_id": session_id,
        "events": events,
        "mode": "poll",
        "has_persona": req.persona is not None,
        "has_story": req.story is not None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
