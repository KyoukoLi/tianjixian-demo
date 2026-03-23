# 天际线 Demo — 快速启动

## 环境要求

- Python 3.10+
- 现代浏览器（Chrome / Firefox / Safari）
- 无需真实 AI 模型（Mock 模式即可运行）

---

## 启动步骤

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

后端启动后访问 `http://localhost:8000` 确认返回 JSON。

### 2. 启动前端

直接用浏览器打开 `frontend/index.html` 即可。

> 如果跨域问题，Chrome 可以加参数：
> `open -a Google\ Chrome --args --disable-web-security`

---

## 测试流程

1. 输入任意文字，观察 SSE 流式文本输出
2. 尝试带动作语法：`你好*微笑*` / `难过*叹气*` / `生气*愤怒*`
3. 观察情绪标签变化（右上角 badge）
4. 多次点击"继续"按钮，测试频控（3次后阻断）
5. 打开诊断面板，查看完整事件流

---

## 架构说明

```
用户输入 → FastAPI (SSE) → mock_engine.py → emotion.py
                                     ↓
                              事件流 (emotion_tag / chunk / done)
                                     ↓
前端 (index.html) ← EventSource ← SSE stream
    ├── 视频并发调度
    ├── 音频并发调度
    ├── 降级策略（置信度 < 0.5 → 纯文本）
    └── 继续按钮频控（60s/3次）
```

---

## 接入真实模型

只需修改一个文件：`backend/mock_engine.py`

将 `generate()` 方法替换为真实模型调用，保持 `StreamEvent` 接口不变即可。

协议文档：`docs/PROTOCOL.md`

---

## 接入真实资产

当视频/音频素材就绪后，更新 `frontend/app.js` 中的 `CONFIG.API_BASE` 和资源 URL 即可。

Mock 模式下，视频/音频会自动跳过（因为 `cdn.example.com` 是假地址）。
