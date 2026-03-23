# 天际线 Demo — 引擎实现规格

## 1. 目标

跑通"视+听+文三路并发"的核心交互引擎，用 Mock 数据验证前端并发调度 + 降级策略 + 频控逻辑。

## 2. 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 后端 | Python 3.10+ / FastAPI | SSE 流式输出 |
| 前端 | 原生 HTML/CSS/JS | 无框架依赖，调试最轻 |
| 通信 | Server-Sent Events (SSE) | text/event-stream |
| Mock | 后端内嵌 mock 逻辑 | 等真实模型接入后替换 adapter |

## 3. 协议（已锁死）

见 `docs/PROTOCOL.md`，核心事件流：

```
emotion_tag → chunk → chunk → ... → done / error
```

## 4. 情绪字典（Mock 版）

| Tag | 说明 | 视频文件 | 音频文件 |
|-----|------|---------|---------|
| neutral | 中立 | neutral.mp4 | neutral.mp3 |
| happy | 开心 | happy.mp4 | happy.mp3 |
| sad | 难过 | sad.mp4 | sad.mp3 |
| angry | 生气 | angry.mp4 | angry.mp3 |

## 5. 降级策略

| 等级 | 条件 | 行为 |
|------|------|------|
| 降级 A | confidence ∈ [0.5, 0.8) | 只播音频，不播视频 |
| 降级 B | confidence < 0.5 或资源缺失 | 纯文本 |
| 降级 C | 接口超时 > 10s | 显示重试 UI |

## 6. 频控规则

- 滑动窗口：60s 内最多 3 次"继续"
- 第 4 次触发阻断：按钮置灰 30s

## 7. 验收标准

- [ ] 前端能收到 SSE 流式响应
- [ ] 文本流式输出（打字机效果）
- [ ] 视频/音频并发播放
- [ ] 降级 A/B 正确触发
- [ ] 继续按钮频控生效
- [ ] 渲染成功率目测 > 95%

## 8. 目录结构

```
tianjixian/
├── SPEC.md              # 本文件
├── docs/
│   └── PROTOCOL.md      # 协议详细定义
├── backend/
│   ├── main.py          # FastAPI 入口
│   ├── mock_engine.py   # Mock LLM 引擎
│   ├── emotion.py       # 情绪字典 + mock 解析
│   └── requirements.txt
└── frontend/
    ├── index.html       # 主页面
    ├── style.css        # 样式
    └── app.js          # 核心逻辑
```
