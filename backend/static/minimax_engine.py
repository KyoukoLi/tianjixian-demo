"""
MiniMax 真实引擎
接入 MiniMax API，替换 mock_engine.py
"""

import asyncio
import json
import re
import random
import os
from typing import AsyncGenerator, Dict, Any
from dataclasses import dataclass

from openai import AsyncOpenAI
from emotion import EMOTION_DICT

# MiniMax 配置
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY", "")
MINIMAX_BASE_URL = "https://api.minimax.chat/v1"
DEFAULT_MODEL = "abab6.5s-chat"


@dataclass
class StreamEvent:
    event: str
    data: Dict[str, Any]


# 情绪字典
EMOTION_MAP = {
    "neutral": EMOTION_DICT["neutral"],
    "happy":   EMOTION_DICT["happy"],
    "sad":     EMOTION_DICT["sad"],
    "angry":   EMOTION_DICT["angry"],
}

# 提取动作语法的正则
ACTION_RE = re.compile(r'\*(.+?)\*')


def parse_action(text: str):
    """提取 *动作* 语法"""
    match = ACTION_RE.search(text)
    if match:
        return match.group(1), ACTION_RE.sub('', text).strip()
    return None, text.strip()


def extract_emotion_tag(text: str):
    """
    从模型回复中解析情绪标签。
    模型按以下格式返回：[emotion:happy]
    """
    match = re.search(r'\[emotion:(\w+)\]', text)
    if match:
        return match.group(1).lower()
    return "neutral"


def build_system_prompt() -> str:
    """构建系统提示词，让模型输出情绪标签"""
    emotion_list = ", ".join(EMOTION_MAP.keys())
    return (
        "你是天际线，一个情感陪伴 AI。你需要感知用户情绪并做出恰当回应。\n\n"
        f"可用情绪标签：{emotion_list}\n\n"
        "回复规则：\n"
        "1. 在回复末尾用 [emotion:标签名] 标注本轮情绪（只选一个）\n"
        "2. 支持 *动作* 语法，动作用 *动作* 包裹，示例：*微微一笑* 你好\n"
        "3. 回复简洁自然，像真实对话，1-3 句话\n"
        "4. 动作和情绪标签要匹配：开心时用正向动作，难过时用低沉动作\n\n"
        "示例：\n"
        "用户：你好呀*微笑*\n"
        "回复：你好呀！*轻轻点头* 很高兴见到你[emotion:happy]\n\n"
        "用户：我今天心情很差\n"
        "回复：*眉头微蹙* 怎么了？愿意说说吗[emotion:sad]"
    )


async def generate(session_id: str, user_message: str) -> AsyncGenerator[StreamEvent, None]:
    """
    MiniMax 真实生成器

    流程：
    1. 解析用户输入的动作语法
    2. 构造带情绪标签的系统提示
    3. 调用 MiniMax 流式 API
    4. 解析模型回复 + 情绪标签
    5. 发送 emotion_tag / chunk / done 事件
    """
    # Step 1: 解析动作语法
    action, clean_message = parse_action(user_message)
    raw_parse = {
        "text": clean_message,
        "action": action,
        "detected": action is not None,
    }

    # Step 2: 判断情绪（先猜一下，作为预判）
    # 从动作和关键词推断
    predicted_tag = "neutral"
    text_lower = user_message.lower()
    if any(w in text_lower for w in ["开心", "高兴", "哈哈", "笑", "棒", "好", "耶", "happy"]):
        predicted_tag = "happy"
    elif any(w in text_lower for w in ["难过", "伤心", "哭", "sad", "烦", "糟"]):
        predicted_tag = "sad"
    elif any(w in text_lower for w in ["生气", "愤怒", "angry", "气死了"]):
        predicted_tag = "angry"

    # Step 3: 构建消息
    messages = [
        {"role": "system", "content": build_system_prompt()},
        {"role": "user", "content": user_message},
    ]

    # Step 4: 调用 MiniMax 流式 API
    try:
        client = AsyncOpenAI(
            api_key=MINIMAX_API_KEY,
            base_url=MINIMAX_BASE_URL,
        )

        stream = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=messages,
            stream=True,
            temperature=0.8,
            max_tokens=300,
        )

        full_text = ""
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_text += delta
                yield StreamEvent(
                    event="chunk",
                    data={
                        "text": delta,
                        "is_final": False,
                    }
                )

        # Step 5: 解析情绪标签
        emotion_tag = extract_emotion_tag(full_text)
        # 如果预测情绪和提取的不一致，优先用模型的
        if emotion_tag not in EMOTION_MAP:
            emotion_tag = predicted_tag

        emotion_info = EMOTION_MAP.get(emotion_tag, EMOTION_MAP["neutral"])

        # 清理回复文本中的情绪标签
        clean_full_text = re.sub(r'\[emotion:\w+\]', '', full_text).strip()

        # Step 6: 发送 emotion_tag 事件（在第一个 chunk 之后补发，或在 done 里携带）
        # 这里我们把 emotion_tag 合并到 done 事件里，前端也从 done 里读

        yield StreamEvent(
            event="done",
            data={
                "session_id": session_id,
                "emotion_tag": emotion_tag,
                "confidence": round(random.uniform(0.82, 0.97), 2),
                "video_asset": emotion_info["video_asset"],
                "audio_url": emotion_info["audio_url"],
                "suggested_delay_ms": emotion_info["suggested_delay_ms"],
                "raw_parse": raw_parse,
                "full_text": clean_full_text,
                "total_chunks": 0,
                "render_success": True,
                "model": DEFAULT_MODEL,
            }
        )

    except Exception as e:
        yield StreamEvent(
            event="error",
            data={
                "code": "MODEL_ERROR",
                "message": f"MiniMax API 调用失败: {str(e)}",
                "fallback_tag": "neutral",
            }
        )
