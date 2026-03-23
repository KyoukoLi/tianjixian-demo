# Emotion_Tag SSE 流式协议

**版本**：v1.0
**状态**：已锁定，待模型接入后微调

---

## 1. 通信方式

- **协议**：Server-Sent Events (SSE)
- **端点**：`POST /chat`
- **Content-Type**：`text/event-stream`
- **字符编码**：UTF-8

---

## 2. 请求格式

```http
POST /chat
Content-Type: application/json

{
  "message": "你好呀*微笑*",
  "session_id": "s_abc123"
}
```

- `message`（必填）：用户输入，支持 `*动作*` 语法
- `session_id`（可选）：会话 ID，不传则后端生成

---

## 3. 响应事件流

每个事件格式：
```
event: <event_type>
data: <JSON>

```

### 3.1 emotion_tag 事件（首个事件）

后端解析完用户输入后，第一个发回。

```json
{
  "tag": "happy",
  "confidence": 0.94,
  "video_asset": "02_happy.mp4",
  "audio_url": "https://cdn.xxx/02_happy.m3u8",
  "suggested_delay_ms": 3200,
  "raw_parse": {
    "text": "你好呀",
    "action": "微笑",
    "detected": true
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| tag | string | 枚举：neutral / happy / sad / angry |
| confidence | float | 置信度 [0, 1]，< 0.5 触发降级 B |
| video_asset | string | 素材文件名，前端按需加载 |
| audio_url | string | 音频流地址 |
| suggested_delay_ms | int | 建议等待时间（毫秒） |
| raw_parse.text | string | 纯文本部分 |
| raw_parse.action | string | 检测到的动作语法内容 |
| raw_parse.detected | bool | 是否检测到动作语法 |

### 3.2 chunk 事件（中间多个）

流式文本片段。

```json
{
  "text": "缓缓抬起头，",
  "is_final": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| text | string | 文本片段（增量追加） |
| is_final | bool | false=增量追加，true=本轮最后一个片段 |

### 3.3 done 事件（最后一个）

```json
{
  "session_id": "s_abc123",
  "total_chunks": 24,
  "render_success": true,
  "emotion_tag": "happy",
  "full_text": "缓缓抬起头，嘴角微微上扬*微微一笑*，眼里闪着光。"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |
| total_chunks | int | 本轮总片段数 |
| render_success | bool | 前端渲染是否成功（客户端上报） |
| emotion_tag | string | 本轮情绪标签 |
| full_text | string | 完整回复文本 |

### 3.4 error 事件（异常时）

```json
{
  "code": "ASSET_MISSING",
  "message": "标签 happy 对应视频资源未找到",
  "fallback_tag": "neutral"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string | 错误码 |
| message | string | 人类可读描述 |
| fallback_tag | string | 建议的兜底情绪标签 |

---

## 4. 错误码

| code | 说明 | fallback_tag |
|------|------|-------------|
| ASSET_MISSING | 视频/音频资源未找到 | neutral |
| PARSE_ERROR | 动作语法解析失败 | neutral |
| TIMEOUT | 后端请求超时 | neutral |
| MODEL_ERROR | 模型调用异常 | neutral |
| SESSION_NOT_FOUND | session_id 无效 | - |

---

## 5. Mock 模式说明

后端在不接真实模型时，使用 `MockEngine` 内置逻辑：
- 根据输入关键词匹配情绪
- 动作语法用正则提取
- 文本流用预设模板 + 打字机延迟模拟

接入真实模型时，只需替换 `mock_engine.py` 中的 `generate()` 方法，接口契约不变。
