"""
MiniMax 引擎 — 通过 Cloudflare Workers 代理访问
Railway 无法直接访问 api.minimax.chat，需通过 Cloudflare Worker 中转
"""

import os
import json
import asyncio
import random
from typing import AsyncGenerator, Dict, Any, Optional, List

import httpx

MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "").strip()
MINIMAX_GROUP_ID = os.environ.get("MINIMAX_GROUP_ID", "").strip()
# Cloudflare Worker 代理地址（如: https://tianjixian-demo.lizhenyue66.workers.dev）
MINIMAX_PROXY_URL = os.environ.get("MINIMAX_PROXY_URL", "").strip().rstrip("/")

EMOTION_MAP = {
    "neutral": "neutral",
    "happy": "happy",
    "sad": "sad",
    "angry": "angry",
}


def build_system_prompt(persona: Optional[Dict] = None, story: Optional[Dict] = None) -> str:
    """构建系统提示词"""
    from prompt_builder import PersonaPrompt, StoryPrompt
    if persona:
        pp = PersonaPrompt(persona)
        system = pp.build_system_prompt()
    else:
        system = "你是天际线的 AI 助手，友善地回应用户。"

    if story:
        sp = StoryPrompt(story)
        system = pp.merge_story(sp) if persona else sp.build_constraint_fragment()

    return system


async def generate(
    session_id: str,
    user_message: str,
    persona: Optional[Dict] = None,
    story: Optional[Dict] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    MiniMax 实时生成器（通过 Cloudflare Worker 代理）
    """
    from dataclasses import dataclass

    class StreamEvent:
        def __init__(self, event, data):
            self.event = event
            self.data = data

    # 解析用户输入中的动作和情绪
    import re
    action_match = re.search(r'\*(.+?)\*', user_message)
    action = action_match.group(1) if action_match else None
    raw_parse = {
        "text": re.sub(r'\*(.+?)\*', '', user_message).strip(),
        "action": action,
        "detected": action is not None,
    }

    # 从用户消息推断情绪
    tag = "neutral"
    text_lower = user_message.lower()
    if any(w in text_lower for w in ["开心", "高兴", "哈哈", "笑", "棒", "好耶", "happy", "joy", "太好了", "太棒了"]):
        tag = "happy"
    elif any(w in text_lower for w in ["难过", "伤心", "哭", "sad", "郁闷", "糟糕", "唉", "累", "困"]):
        tag = "sad"
    elif any(w in text_lower for w in ["生气", "愤怒", "angry", "furious", "气死了", "烦", "讨厌"]):
        tag = "angry"

    confidence = round(random.uniform(0.80, 0.95), 2)

    # emotion_tag 事件
    yield {"type": "emotion_tag", "event": "emotion_tag", "data": {
        "tag": tag,
        "confidence": confidence,
        "video_asset": f"{tag}.mp4",
        "audio_url": f"https://cdn.example.com/audio/{tag}.mp3",
        "suggested_delay_ms": 2500,
        "raw_parse": raw_parse,
    }}

    if not MINIMAX_API_KEY:
        # 无 API Key，降级到 mock
        async for ev in mock_fallback(tag, session_id, user_message):
            yield ev
        return

    if not MINIMAX_PROXY_URL:
        # 无代理，降级到 mock
        yield {"type": "error", "event": "error", "data": {
            "code": "NO_PROXY",
            "message": "未配置 MINIMAX_PROXY_URL，使用 Mock 引擎",
            "fallback_tag": tag,
        }}
        async for ev in mock_fallback(tag, session_id, user_message):
            yield ev
        return

    # 构建消息
    system_prompt = build_system_prompt(persona, story)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]

    # 调用 MiniMax API（通过 Cloudflare Worker 代理）
    url = f"{MINIMAX_PROXY_URL}/v1/text/chatcompletion_v2?GroupId={MINIMAX_GROUP_ID}"
    headers = {
        "Authorization": f"Bearer {MINIMAX_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": "MiniMax-Text-01",
        "messages": messages,
        "max_tokens": 256,
        "temperature": 0.9,
        "stream": True,
    }

    full_text = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as resp:
                if resp.status_code != 200:
                    err_text = await resp.text()
                    yield {"type": "error", "event": "error", "data": {
                        "code": f"HTTP_{resp.status_code}",
                        "message": f"MiniMax API 错误: {err_text[:200]}",
                        "fallback_tag": tag,
                    }}
                    async for ev in mock_fallback(tag, session_id, user_message):
                        yield ev
                    return

                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        choices = chunk.get("choices", [])
                        if choices:
                            delta = choices[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                full_text += content
                                yield {
                                    "type": "chunk",
                                    "event": "chunk",
                                    "data": {"text": content, "is_final": False},
                                }
                    except json.JSONDecodeError:
                        continue

    except Exception as e:
        yield {"type": "error", "event": "error", "data": {
            "code": "NETWORK_ERROR",
            "message": f"网络错误: {str(e)}",
            "fallback_tag": tag,
        }}
        async for ev in mock_fallback(tag, session_id, user_message):
            yield ev
        return

    # done
    if not full_text:
        full_text = "（模型未返回内容）"
    yield {"type": "done", "event": "done", "data": {
        "session_id": session_id,
        "emotion_tag": tag,
        "confidence": confidence,
        "video_asset": f"{tag}.mp4",
        "audio_url": f"https://cdn.example.com/audio/{tag}.mp3",
        "suggested_delay_ms": 2500,
        "raw_parse": raw_parse,
        "full_text": full_text,
        "total_chunks": len(full_text),
        "render_success": True,
    }}


async def mock_fallback(tag: str, session_id: str, user_message: str):
    """Mock 降级"""
    import random
    RESPONSES = {
        "neutral": ["嗯，我听着呢。", "继续说吧。", "是这样啊。", "我明白了。"],
        "happy": ["太好了！*眼睛弯成月牙*", "哈哈！真开心。", "太棒了！*开心地点头*"],
        "sad": ["这样啊... *轻轻叹了口气*", "*眉头微蹙* 我能理解。", "嗯，听起来让人难过。"],
        "angry": ["*深吸一口气* ...好吧。", "*拳头微微握紧* ...算了。", "*转过身去* 不说了。"],
    }
    pool = RESPONSES.get(tag, RESPONSES["neutral"])
    text = random.choice(pool)
    full_text = text
    chunks = []
    i = 0
    while i < len(text):
        sz = random.randint(2, min(6, len(text) - i))
        chunks.append(text[i:i+sz])
        i += sz

    for chunk in chunks:
        yield {"type": "chunk", "event": "chunk", "data": {"text": chunk, "is_final": False}}
        await asyncio.sleep(0.05)

    yield {"type": "done", "event": "done", "data": {
        "session_id": session_id,
        "emotion_tag": tag,
        "confidence": 0.5,
        "video_asset": f"{tag}.mp4",
        "audio_url": f"https://cdn.example.com/audio/{tag}.mp3",
        "suggested_delay_ms": 2500,
        "raw_parse": {"text": user_message, "action": None, "detected": False},
        "full_text": full_text,
        "total_chunks": len(chunks),
        "render_success": True,
        "is_mock": True,
    }}
