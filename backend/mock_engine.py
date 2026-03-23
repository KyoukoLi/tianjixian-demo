"""
Mock LLM 引擎
- 不依赖任何外部模型
- 流式输出预设文本
- 等真实模型接入后，整体替换 generate() 方法即可
"""

import re
import asyncio
import random
from typing import AsyncGenerator, Dict, Any, List
from dataclasses import dataclass

from emotion import parse_emotion_tag, EMOTION_DICT


@dataclass
class StreamEvent:
    """SSE 事件"""
    event: str
    data: Dict[str, Any]


# ─────────────────────────────────────────
# Mock 文本库（按情绪分类）
# 真实接入时替换为模型流式输出
# ─────────────────────────────────────────
MOCK_RESPONSES = {
    "neutral": [
        "嗯，我听见了。",
        "是这样啊，我明白了。",
        "原来如此，继续说吧。",
        "你有什么想聊的？",
        "我在听，慢慢说。",
    ],
    "happy": [
        "太好了！听到这个我也很开心。*嘴角上扬*",
        "哈哈，是吗？*眼睛弯成月牙* 真是让人心情愉悦呢。",
        "太棒了！*轻轻鼓掌* 继续保持这个好心情吧。",
        "哇，听起来真不错！*露出灿烂的笑容*",
        "太好了！*开心地点头* 这种感觉真好。",
    ],
    "sad": [
        "这样啊... *轻轻叹了口气* 我能理解你的感受。",
        "嗯，听起来确实让人难过。*眉头微蹙*",
        "*眉头紧锁* 这确实不容易，我懂。",
        "嗯... *声音低沉* 慢慢来，不着急。",
        "*眼眶微微泛红* 别太难过，会好起来的。",
    ],
    "angry": [
        "*深吸一口气* 好了，我冷静一下再继续。",
        "*眉头紧锁* 这确实让人很恼火... *长叹*",
        "*拳头微微握紧* ...我尽量控制一下情绪。",
        "*转过身去* 算了，不说这个了。",
        "*压低声音* 行吧，我们换个话题。",
    ],
}


def get_mock_response(tag: str) -> str:
    """从情绪对应的文本库中随机选一条"""
    pool = MOCK_RESPONSES.get(tag, MOCK_RESPONSES["neutral"])
    return random.choice(pool)


def simulate_chunking(text: str, chunk_size: int = 5) -> List[str]:
    """
    将文本切分为小块，模拟流式输出
    chunk_size: 每块字符数
    """
    chunks = []
    i = 0
    while i < len(text):
        # 随机块大小，模拟真实模型的变长输出
        size = random.randint(max(1, chunk_size - 3), chunk_size + 2)
        chunk = text[i:i+size]
        chunks.append(chunk)
        i += size
    return chunks


async def generate(session_id: str, user_message: str) -> AsyncGenerator[StreamEvent, None]:
    """
    Mock 生成器（等真实模型接入后替换整个方法）

    流程：
    1. 解析情绪标签 + 置信度
    2. 发送 emotion_tag 事件
    3. 发送多个 chunk 事件（流式文本）
    4. 发送 done 或 error 事件
    """
    # Step 1: 解析情绪
    parse_result = parse_emotion_tag(user_message)

    # Step 2: 发送 emotion_tag 事件
    yield StreamEvent(
        event="emotion_tag",
        data={
            "tag": parse_result.tag,
            "confidence": parse_result.confidence,
            "video_asset": parse_result.video_asset,
            "audio_url": parse_result.audio_url,
            "suggested_delay_ms": parse_result.suggested_delay_ms,
            "raw_parse": {
                "text": parse_result.raw_text,
                "action": parse_result.action,
                "detected": parse_result.action_detected,
            }
        }
    )

    # Step 3: 流式发送文本
    response_text = get_mock_response(parse_result.tag)
    chunks = simulate_chunking(response_text)

    for i, chunk in enumerate(chunks):
        is_final = (i == len(chunks) - 1)
        yield StreamEvent(
            event="chunk",
            data={
                "text": chunk,
                "is_final": is_final,
            }
        )
        # 模拟打字机延迟（50-150ms 每字符组）
        await asyncio.sleep(random.uniform(0.05, 0.15))

    # Step 4: 发送 done 事件
    yield StreamEvent(
        event="done",
        data={
            "session_id": session_id,
            "total_chunks": len(chunks),
            "render_success": True,
            "emotion_tag": parse_result.tag,
            "confidence": parse_result.confidence,
            "full_text": response_text,
        }
    )
