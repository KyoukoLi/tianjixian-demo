# 天际线 Demo — 实现规格

## 当前状态

| 模块 | 状态 | 说明 |
|------|------|------|
| 前端 UI | ✅ | 深色主题、情绪卡片、聊天气泡、快速情绪按钮 |
| 后端 API | ✅ | FastAPI + Railway 托管 |
| 通信模式 | ✅ | 轮询（/chat/poll），SSE 备选 |
| 真实 AI | ✅ | MiniMax-M2.5-highspeed |
| 情绪识别 | ✅ | 预判 + 关键词兜底 + [emotion:xxx] 格式 |
| 会话记忆 | ✅ | 最近 6 轮对话上下文 |
| 频控 | ✅ | 60s 窗口内最多 3 次继续 |
| 降级策略 | ✅ | 置信度 < 0.5 → 纯文本 |

## 架构

```
用户输入 → 前端 → POST /chat/poll
                        ↓
                  MiniMax-M2.5-highspeed
                        ↓
                  后端解析情绪 + 文本
                        ↓
                  JSON 响应（多个事件）
                        ↓
                  前端渲染：情绪卡片 + 气泡 + 诊断面板
```

## 接口

- `POST /chat/poll` — 轮询聊天（生产用）
- `POST /chat` — SSE 流式（备选）
- `GET /health` — 健康检查

## 部署

- 前端 + 后端：Railway（自动 GitHub 监听）
- 实时 Demo：https://tianjixian-demo-production.up.railway.app/

## 待接入

- [ ] 真实视频/音频素材（当前 Mock 跳过）
- [ ] SSE 替代轮询（解决 Railway 代理缓冲问题）
- [ ] Redis 会话存储（当前用内存字典，容器重启丢失）
