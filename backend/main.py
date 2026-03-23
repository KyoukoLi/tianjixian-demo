"""
天际线 Demo — FastAPI 后端
提供 SSE 流式接口 + 轮询接口 + 前端静态页面
静态文件从内嵌 zip 解压到内存，确保每次部署都是最新版本
"""

import asyncio
import json
import os
import uuid
import zipfile
import io
from typing import Optional, Dict, Any, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel

from static_assets import STATIC_ZIP
import base64

app = FastAPI(title="天际线 Demo API", version="0.4.0")

# 解压静态文件到内存 dict: {路径: 内容}
STATIC_FILES: Dict[str, bytes] = {}
try:
    zip_data = base64.b64decode(STATIC_ZIP)
    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        for name in zf.namelist():
            if not name.endswith('/'):
                STATIC_FILES['/' + name] = zf.read(name)
    print(f"[天际线] Loaded {len(STATIC_FILES)} static files from embedded zip")
except Exception as e:
    print(f"[天际线] WARNING: Failed to load embedded static files: {e}")
    STATIC_FILES = {}

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


def format_sse(event_type: str, data: Dict) -> str:
    json_data = json.dumps(data, ensure_ascii=False)
    return f"event: {event_type}\ndata: {json_data}\n\n"


async def sse_generator(session_id: str, user_message: str, persona=None, story=None):
    try:
        async for ev in minimax_generate(session_id, user_message, persona, story):
            yield format_sse(ev["event"], ev["data"])
            await asyncio.sleep(0.001)
    except Exception as e:
        yield format_sse("error", {
            "code": "MODEL_ERROR",
            "message": str(e),
            "fallback_tag": "neutral",
        })


async def minimax_generate(session_id: str, user_message: str, persona=None, story=None):
    """根据环境变量选择 MiniMax 引擎或 Mock 引擎"""
    proxy_url = os.environ.get("MINIMAX_PROXY_URL", "")
    api_key = os.environ.get("MINIMAX_API_KEY", "")

    if proxy_url and api_key:
        from minimax_engine import generate as minimax_gen
        async for ev in minimax_gen(session_id, user_message, persona, story):
            yield ev
    else:
        from mock_engine import generate as mock_gen
        async for ev in mock_gen(session_id, user_message, persona, story):
            yield ev


@app.get("/")
async def index():
    content = STATIC_FILES.get('/static/index.html') or STATIC_FILES.get('/index.html', b'')
    return HTMLResponse(content=content, headers={"Cache-Control": "no-cache"})


@app.get("/index.html")
async def index_html():
    return await index()


@app.get("/api")
async def api_info():
    proxy = os.environ.get("MINIMAX_PROXY_URL", "")
    api_key = os.environ.get("MINIMAX_API_KEY", "")
    return {
        "service": "天际线 Demo API",
        "version": "0.4.0",
        "static_files": len(STATIC_FILES),
        "engine": "minimax" if (proxy and api_key) else "mock",
        "proxy": proxy[:30] + "..." if proxy else "(未配置)",
    }


@app.get("/health")
async def health():
    proxy = os.environ.get("MINIMAX_PROXY_URL", "")
    return {
        "status": "ok",
        "version": "0.4.0",
        "static": len(STATIC_FILES),
        "engine": "minimax" if os.environ.get("MINIMAX_API_KEY") else "mock",
    }


@app.get("/static/{path:path}")
async def serve_static(path: str):
    file_path = f'/static/{path}'
    if file_path in STATIC_FILES:
        content = STATIC_FILES[file_path]
        if path.endswith('.js'):
            return HTMLResponse(content=content, media_type="application/javascript", headers={"Cache-Control": "no-cache"})
        elif path.endswith('.css'):
            return HTMLResponse(content=content, media_type="text/css", headers={"Cache-Control": "no-cache"})
        elif path.endswith('.html'):
            return HTMLResponse(content=content, headers={"Cache-Control": "no-cache"})
        else:
            return HTMLResponse(content=content, headers={"Cache-Control": "no-cache"})
    return HTMLResponse(content="Not found", status_code=404)


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.message or not req.message.strip():
        return StreamingResponse(
            iter([format_sse("error", {
                "code": "EMPTY_MESSAGE",
                "message": "消息不能为空",
                "fallback_tag": "neutral",
            })]),
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
    async for ev in minimax_generate(session_id, user_message, req.persona, req.story):
        events.append({"type": ev["type"], "data": ev["data"]})

    return {
        "session_id": session_id,
        "events": events,
        "mode": "poll",
        "has_persona": req.persona is not None,
        "has_story": req.story is not None,
        "version": "0.4.0",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
