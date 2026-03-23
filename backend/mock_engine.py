"""
Mock LLM 引擎 — 支持 persona + story 配置
"""

import re
import asyncio
import random
from typing import AsyncGenerator, Dict, Any, Optional, List

from emotion import EMOTION_DICT

EMOTION_MAP = {
    "neutral": EMOTION_DICT["neutral"],
    "happy": EMOTION_DICT["happy"],
    "sad": EMOTION_DICT["sad"],
    "angry": EMOTION_DICT["angry"],
}

MOCK_RESPONSES = {
    "neutral": [
        "嗯，我听见了。", "是这样啊，我明白了。",
        "原来如此，继续说吧。", "你有什么想聊的？", "我在听，慢慢说。",
    ],
    "happy": [
        "太好了！*嘴角上扬* 听到这个我也很开心。",
        "哈哈！*眼睛弯成月牙* 真是让人心情愉悦呢。",
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

DEFAULT_RESPONSES = MOCK_RESPONSES["neutral"]


def get_mock_response(tag: str, persona: Optional[Dict] = None, story: Optional[Dict] = None) -> str:
    """根据 persona/story 定制回复"""
    pool = MOCK_RESPONSES.get(tag, DEFAULT_RESPONSES)
    base = random.choice(pool)

    # 根据角色语言风格微调
    if persona and persona.get("speaking_style"):
        style = persona["speaking_style"].lower()
        if "毒舌" in style or "毒舌" in persona.get("core_traits", ""):
            base = base.replace("太好了！", "切，还行吧。").replace("哈哈！", "哼。")

    # 根据故事背景微调
    if story and story.get("genre"):
        genre = story["genre"]
        if "古代" in genre or "宫廷" in genre:
            base = base.replace("好心情", "心情舒畅").replace("鼓掌", "击掌")

    return base


def build_system_prompt(persona: Optional[Dict] = None, story: Optional[Dict] = None) -> str:
    """构建系统提示词"""
    if not persona:
        return "你是天际线的 AI 助手，友善地回应用户。"

    name = persona.get("name", "助手")
    traits = persona.get("core_traits", "")
    style = persona.get("speaking_style", "")
    weight = persona.get("weight", 50)

    focus = "注重情感互动和细腻情绪描写" if weight > 60 else \
            "注重事件推进和冲突触发" if weight < 40 else \
            "平衡情感互动与剧情推进"

    prompt = f"你是「{name}」"
    if traits:
        prompt += f"\n性格：{traits}"
    if style:
        prompt += f"\n语言风格：{style}"
    prompt += f"\n\n{focus}"
    prompt += "\n\n规则：回复末尾标注情绪 [emotion:happy/neutral/sad/angry]，支持*动作*语法"

    if story and story.get("genre"):
        prompt += f"\n\n【故事框架】题材：{story['genre']}"
        if story.get("forbidden_elements"):
            prompt += f"\n禁区：{story['forbidden_elements']}"

    return prompt


def simulate_chunking(text: str) -> List[str]:
    if not text:
        return []
    chunks = []
    i = 0
    while i < len(text):
        remaining = len(text) - i
        if remaining <= 0:
            break
        lo = min(4, remaining)
        hi = min(7, remaining)
        size = random.randint(lo, max(lo, hi))
        chunks.append(text[i:i+size])
        i += size
    return chunks or [text]


from dataclasses import dataclass

@dataclass
class StreamEvent:
    event: str
    data: Any

async def generate(
    session_id: str,
    user_message: str,
    persona: Optional[Dict] = None,
    story: Optional[Dict] = None,
) -> AsyncGenerator[StreamEvent, None]:
    """
    Mock 生成器
    支持 persona + story 配置
    """

    # 情绪解析
    tag = "neutral"
    text_lower = user_message.lower()
    if any(w in text_lower for w in ["开心", "高兴", "哈哈", "笑", "棒", "好耶", "happy", "joy"]):
        tag = "happy"
    elif any(w in text_lower for w in ["难过", "伤心", "哭", "sad", "郁闷", "糟糕", "唉"]):
        tag = "sad"
    elif any(w in text_lower for w in ["生气", "愤怒", "angry", "furious", "气死了"]):
        tag = "angry"

    action_match = re.search(r'\*(.+?)\*', user_message)
    action = action_match.group(1) if action_match else None
    raw_parse = {
        "text": re.sub(r'\*(.+?)\*', '', user_message).strip(),
        "action": action,
        "detected": action is not None,
    }

    emotion = EMOTION_MAP.get(tag, EMOTION_MAP["neutral"])
    confidence = round(random.uniform(0.75, 0.95), 2)

    # emotion_tag
    yield StreamEvent(
        "emotion_tag",
        {
            "tag": tag,
            "confidence": confidence,
            "video_asset": emotion["video_asset"],
            "audio_url": emotion["audio_url"],
            "suggested_delay_ms": emotion["suggested_delay_ms"],
            "raw_parse": raw_parse,
        }
    )

    # 流式文本
    response_text = get_mock_response(tag, persona, story)
    chunks = simulate_chunking(response_text)

    for i, chunk in enumerate(chunks):
        yield StreamEvent(
            "chunk",
            {"text": chunk, "is_final": i == len(chunks) - 1}
        )
        await asyncio.sleep(random.uniform(0.05, 0.15))

    # done
    yield StreamEvent(
        "done",
        {
            "session_id": session_id,
            "emotion_tag": tag,
            "confidence": confidence,
            "video_asset": emotion["video_asset"],
            "audio_url": emotion["audio_url"],
            "suggested_delay_ms": emotion["suggested_delay_ms"],
            "raw_parse": raw_parse,
            "full_text": response_text,
            "total_chunks": len(chunks),
            "render_success": True,
        }
    )
