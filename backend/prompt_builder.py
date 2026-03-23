"""
天际线 — 角色 Prompt 构建器
根据用户配置的角色 + 故事，组装系统 Prompt
"""

import json
from typing import Dict, Any, List, Optional

# 默认角色模板
DEFAULT_PERSONA = {
    "name": "天际线助手",
    "age": "",
    "gender": "",
    "appearance": "",
    "backstory": "一个情感陪伴 AI，能够感知用户情绪并做出恰当回应。",
    "core_traits": "温暖、真诚、善于倾听",
    "speaking_style": "亲切、自然、简洁",
    "likes": "",
    "dislikes": "",
    "goals": "陪伴用户，帮助用户",
    "forbidden_topics": "",
    "dialogue_examples": "",
    "weight": 50,
}

# 默认故事模板
DEFAULT_STORY = {
    "genre": "现代都市",
    "setting": "当代城市",
    "timeline": "",
    "endings": [],
    "core_conflict": "",
    "key_events": "",
    "forbidden_elements": "",
}

# 情绪标签
EMOTIONS = ["neutral", "happy", "sad", "angry"]


class PersonaPrompt:
    """角色 Prompt 构建器"""

    def __init__(self, persona: Dict[str, Any]):
        self.p = {**DEFAULT_PERSONA, **persona}
        self._validate()

    def _validate(self):
        if not self.p.get("name"):
            raise ValueError("角色名称不能为空")

    def build_system_prompt(self) -> str:
        """构建完整的系统提示词"""
        lines = []

        # 角色人设
        lines.append("【角色人设】")
        lines.append(f"你是「{self.p['name']}」")
        if self.p.get("age"):
            lines.append(f"年龄：{self.p['age']}")
        if self.p.get("gender"):
            lines.append(f"性别：{self.p['gender']}")
        if self.p.get("appearance"):
            lines.append(f"外貌：{self.p['appearance']}")
        if self.p.get("backstory"):
            lines.append(f"背景：{self.p['backstory']}")
        if self.p.get("core_traits"):
            lines.append(f"性格：{self.p['core_traits']}")
        if self.p.get("speaking_style"):
            lines.append(f"语言风格：{self.p['speaking_style']}")
        if self.p.get("likes"):
            lines.append(f"喜好：{self.p['likes']}")
        if self.p.get("dislikes"):
            lines.append(f"厌恶：{self.p['dislikes']}")
        if self.p.get("goals"):
            lines.append(f"核心目标：{self.p['goals']}")
        if self.p.get("forbidden_topics"):
            lines.append(f"禁忌话题：{self.p['forbidden_topics']}（禁止主动提及）")

        # 叙事风格
        weight = self.p.get("weight", 50)
        if weight > 60:
            style = "注重情感互动和细腻情绪描写，深入角色的内心世界。"
        elif weight < 40:
            style = "注重事件推进和冲突触发，推进故事主线。"
        else:
            style = "平衡情感互动与剧情推进，沉浸式叙事。"
        lines.append(f"\n【叙事风格】\n{style}")

        # 核心规则
        lines.append("\n【核心规则】")
        lines.append("1. 回复末尾必须标注情绪：[emotion:happy/neutral/sad/angry]")
        lines.append("2. 支持*动作*语法，动作用*动作*包裹，如：*微微一笑* 你好")
        lines.append("3. 回复简洁自然，1-3句话，像真实对话")
        lines.append("4. 禁止：承认自己是AI、跳出角色、提及禁忌话题")

        # 对话示例
        if self.p.get("dialogue_examples"):
            lines.append(f"\n【对话示例】\n{self.p['dialogue_examples']}")

        return "\n".join(lines)

    def build_messages(self, history: List[Dict], user_message: str) -> List[Dict]:
        """构建发送给模型的 messages 列表"""
        messages = [
            {"role": "system", "content": self.build_system_prompt()},
        ]
        # 最近 6 轮历史
        for turn in history[-6:]:
            if turn.get("user"):
                messages.append({"role": "user", "content": turn["user"]})
            if turn.get("assistant"):
                messages.append({"role": "assistant", "content": turn["assistant"]})
        messages.append({"role": "user", "content": user_message})
        return messages


class StoryPrompt:
    """故事框架 Prompt 构建器"""

    def __init__(self, story: Dict[str, Any]):
        self.s = {**DEFAULT_STORY, **story}

    def build_constraint_prompt(self) -> str:
        """构建故事约束片段（拼接到系统提示词）"""
        if not self.s.get("genre") and not self.s.get("setting"):
            return ""

        lines = ["\n【故事框架】"]
        if self.s.get("genre"):
            lines.append(f"题材：{self.s['genre']}")
        if self.s.get("setting"):
            lines.append(f"世界观：{self.s['setting']}")
        if self.s.get("timeline"):
            lines.append(f"时间线：{self.s['timeline']}")
        if self.s.get("endings"):
            lines.append(f"结局方向：{', '.join(self.s['endings'])}")
        if self.s.get("core_conflict"):
            lines.append(f"核心冲突：{self.s['core_conflict']}")
        if self.s.get("key_events"):
            events = self.s["key_events"].strip().split("\n")
            lines.append("关键事件：")
            for e in events:
                if e.strip():
                    lines.append(f"  - {e.strip()}")
        if self.s.get("forbidden_elements"):
            lines.append("禁区（严禁出现）：")
            forbidden = self.s["forbidden_elements"].strip().split("\n")
            for f in forbidden:
                if f.strip():
                    lines.append(f"  - {f.strip()}")

        return "\n".join(lines)

    def merge(self, system_prompt: str) -> str:
        """将故事约束合并到系统提示词"""
        constraint = self.build_constraint_prompt()
        if constraint:
            return system_prompt + "\n" + constraint
        return system_prompt


def build_chat_prompt(persona: Dict, story: Dict) -> str:
    """
    快捷函数：合并 persona + story 生成完整系统提示词
    """
    persona_obj = PersonaPrompt(persona)
    system_prompt = persona_obj.build_system_prompt()
    story_obj = StoryPrompt(story)
    return story_obj.merge(system_prompt)


# ── 测试 ──
if __name__ == "__main__":
    persona = {
        "name": "顾深",
        "age": "28",
        "gender": "男",
        "backstory": "单亲家庭，凭自己成为公司高管",
        "core_traits": "外冷内热、毒舌、责任感强",
        "speaking_style": "说话简洁，关键时刻才开口",
        "forbidden_topics": "不主动提家庭和前任",
        "dialogue_examples": "被夸奖时 -> *轻咳一声* ...还行吧。",
        "weight": 70,
    }
    story = {
        "genre": "现代都市",
        "setting": "上海，2024年，公司高管与新人相遇",
        "core_conflict": "家族利益 vs 真心",
        "forbidden_elements": "不出现超自然元素",
        "key_events": "初遇\n误解\n和解\n表白",
    }

    print(build_chat_prompt(persona, story))
