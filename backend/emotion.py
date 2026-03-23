"""
情绪字典 + Mock 解析器
等算法侧接入后，替换 parse() 方法即可
"""

import re
import random
from dataclasses import dataclass
from typing import Optional

# ─────────────────────────────────────────
# 情绪字典（等美术和算法对齐后扩充）
# ─────────────────────────────────────────
EMOTION_DICT = {
    "neutral": {
        "label": "中立",
        "video_asset": "neutral.mp4",
        "audio_url": "https://cdn.example.com/audio/neutral.mp3",
        "suggested_delay_ms": 2500,
    },
    "happy": {
        "label": "开心",
        "video_asset": "happy.mp4",
        "audio_url": "https://cdn.example.com/audio/happy.mp3",
        "suggested_delay_ms": 3200,
    },
    "sad": {
        "label": "难过",
        "video_asset": "sad.mp4",
        "audio_url": "https://cdn.example.com/audio/sad.mp3",
        "suggested_delay_ms": 4000,
    },
    "angry": {
        "label": "生气",
        "video_asset": "angry.mp4",
        "audio_url": "https://cdn.example.com/audio/angry.mp3",
        "suggested_delay_ms": 3500,
    },
}


@dataclass
class ParseResult:
    """解析结果"""
    tag: str
    confidence: float
    video_asset: str
    audio_url: str
    suggested_delay_ms: int
    raw_text: str
    action: Optional[str]
    action_detected: bool
    fallback_tag: Optional[str] = None
    error_code: Optional[str] = None


# ─────────────────────────────────────────
# Mock 解析器（关键词匹配）
# 真实接入时替换为模型调用
# ─────────────────────────────────────────
def parse_emotion_tag(text: str) -> ParseResult:
    """
    Mock 解析：根据关键词推断情绪标签
    真实接入：调用 LLM API，让模型输出 tag + confidence
    """
    text_lower = text.lower()

    # 动作语法提取
    action_match = re.search(r'\*(.+?)\*', text)
    action = action_match.group(1) if action_match else None

    # 关键词 → 情绪映射
    keyword_map = {
        "happy": ["开心", "高兴", "哈哈", "笑", "happy", "joy", "smile", "棒", "好耶", "耶"],
        "sad":   ["难过", "伤心", "哭", "sad", "cry", "郁闷", "糟糕", "唉", "惆怅"],
        "angry": ["生气", "愤怒", "恼火", "angry", "furious", "烦", "气死了"],
    }

    detected_tag = "neutral"
    for tag, keywords in keyword_map.items():
        if any(kw in text_lower for kw in keywords):
            detected_tag = tag
            break

    # Mock 置信度（带一点随机波动，模拟真实模型）
    base_confidence = {
        "neutral": 0.85,
        "happy": 0.82,
        "sad": 0.78,
        "angry": 0.75,
    }.get(detected_tag, 0.80)
    confidence = round(base_confidence + random.uniform(-0.1, 0.08), 2)
    confidence = max(0.3, min(0.99, confidence))

    emotion = EMOTION_DICT.get(detected_tag, EMOTION_DICT["neutral"])

    return ParseResult(
        tag=detected_tag,
        confidence=confidence,
        video_asset=emotion["video_asset"],
        audio_url=emotion["audio_url"],
        suggested_delay_ms=emotion["suggested_delay_ms"],
        raw_text=text,
        action=action,
        action_detected=action is not None,
    )
