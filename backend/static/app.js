/**
 * 天际线 Demo — 前端核心逻辑
 * 负责：SSE 连接 / 并发调度 / 降级策略 / 频控 / UI 渲染
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────
  // 优先读 URL 参数（本地开发），其次同源
  const getApiBase = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('api')) return params.get('api');
    return window.location.origin;
  };

  const CONFIG = {
    API_BASE: getApiBase(),
    CONTINUE_WINDOW_MS: 60_000,   // 60s 滑动窗口
    CONTINUE_LIMIT: 3,            // 最多 3 次
    CONTINUE_COOLDOWN_MS: 30_000,  // 阻断后冷却 30s
    DEBOUNCE_MS: 500,             // 发送按钮防抖
    FALLBACK_A_THRESHOLD: 0.5,    // confidence < 0.5 → 降级 A
    FALLBACK_B_THRESHOLD: 0.5,    // confidence < 0.5 → 降级 B
    CHUNK_DELAY_MS: 60,           // 打字机最小延迟
  };

  // ─────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────
  const state = {
    sessionId: crypto.randomUUID(),
    isStreaming: false,
    continueCount: 0,
    continueTimestamps: [],  // 滑动窗口内的时间戳
    continueBlocked: false,
    cooldownTimer: null,
    currentEmotion: null,
    currentConfidence: 0,
    currentVideoAsset: null,
    currentAudioUrl: null,
    renderMode: 'full',  // 'full' | 'audio_only' | 'text_only'
    debugEnabled: true,
  };

  // ─────────────────────────────────────────
  // DOM refs
  // ─────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const dom = {
    messageInput:  $('messageInput'),
    sendBtn:       $('sendBtn'),
    continueBtn:   $('continueBtn'),
    chatMessages:  $('chatMessages'),
    statusDot:     $('statusDot'),
    freqCounter:   $('freqCounter'),
    debugLog:      $('debugLog'),
    videoPlayer:   $('videoPlayer'),
    videoPlaceholder: $('videoPlaceholder'),
    emotionBadge:  $('emotionBadge'),
    fallbackIndicator: $('fallbackIndicator'),
    statusText:    $('statusText'),
  };

  // ─────────────────────────────────────────
  // 工具函数
  // ─────────────────────────────────────────
  const log = (msg, type = 'info') => {
    if (!dom.debugLog) return;
    const line = document.createElement('div');
    line.className = `debug-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    dom.debugLog.appendChild(line);
    dom.debugLog.scrollTop = dom.debugLog.scrollHeight;
  };

  const scrollToBottom = () => {
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  };

  const setStatus = (text, type = 'default') => {
    dom.statusDot.className = `status-dot ${type}`;
    if (dom.statusText) dom.statusText.textContent = text;
  };

  const escapeHtml = (str) =>
    str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ─────────────────────────────────────────
  // 消息渲染
  // ─────────────────────────────────────────
  function addMessage(role, content, isStreaming = false) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}${isStreaming ? ' streaming' : ''}`;
    msgEl.innerHTML = `
      <div class="message-label">${role === 'user' ? '你' : '天际线'}</div>
      <div class="message-bubble">${escapeHtml(content)}</div>
    `;
    dom.chatMessages.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  function updateStreamingMessage(msgEl, content) {
    const bubble = msgEl.querySelector('.message-bubble');
    bubble.textContent = content;
    scrollToBottom();
  }

  function finalizeMessage(msgEl) {
    msgEl.classList.remove('streaming');
  }

  // ─────────────────────────────────────────
  // 视频 / 音频并发调度
  // ─────────────────────────────────────────
  function preloadAndPlay(assetUrl, isVideo = true) {
    return new Promise((resolve, reject) => {
      if (!assetUrl || assetUrl.startsWith('https://cdn.example.com')) {
        // Mock URL，真实资产未就绪，跳过
        log(`[跳过] ${isVideo ? '视频' : '音频'} 资源未就绪（Mock URL）`, 'tag');
        resolve('skipped');
        return;
      }

      const el = isVideo ? dom.videoPlayer : new Audio();
      const url = assetUrl;

      el.addEventListener(canPlayEvent(el), () => {
        log(`[播放] ${isVideo ? '视频' : '音频'}: ${assetUrl}`, 'tag');
        if (isVideo) {
          el.style.display = 'block';
          dom.videoPlaceholder.style.display = 'none';
          el.play().catch(() => resolve('blocked'));
        } else {
          el.play().catch(() => resolve('blocked'));
        }
      });

      el.addEventListener('error', () => {
        log(`[错误] ${isVideo ? '视频' : '音频'}加载失败: ${assetUrl}`, 'error');
        resolve('error');
      });

      el.addEventListener(canEndEvent(el), () => resolve('ended'));

      el.src = url;
      el.load();
    });
  }

  function canPlayEvent(el) {
    return el.tagName === 'VIDEO' ? 'canplay' : 'canplaythrough';
  }

  function canEndEvent(el) {
    return el.tagName === 'VIDEO' ? 'ended' : 'ended';
  }

  function stopMedia() {
    if (!dom.videoPlayer.paused) {
      dom.videoPlayer.pause();
      dom.videoPlayer.currentTime = 0;
    }
    dom.videoPlayer.style.display = 'none';
    dom.videoPlaceholder.style.display = 'flex';
  }

  // ─────────────────────────────────────────
  // 降级策略
  // ─────────────────────────────────────────
  function applyFallback(level, reason) {
    state.renderMode = level;
    stopMedia();

    dom.fallbackIndicator.textContent = reason;
    dom.fallbackIndicator.className = `fallback-indicator visible${level === 'text_only' ? ' level-b' : ''}`;

    log(`[降级] 等级: ${level}，原因: ${reason}`, 'error');
  }

  function handleEmotionTag(data) {
    state.currentEmotion = data.tag;
    state.currentConfidence = data.confidence;
    state.currentVideoAsset = data.video_asset;
    state.currentAudioUrl = data.audio_url;

    // 渲染情绪标签
    dom.emotionBadge.textContent = `${data.tag} · ${Math.round(data.confidence * 100)}%`;
    dom.emotionBadge.className = `emotion-badge visible ${data.tag}`;
    dom.fallbackIndicator.className = 'fallback-indicator';

    log(`[情绪] tag=${data.tag} confidence=${data.confidence}`, 'tag');
    log(`[资源] video=${data.video_asset} audio=${data.audio_url}`, 'tag');

    // 降级判断
    if (data.confidence < CONFIG.FALLBACK_B_THRESHOLD) {
      applyFallback('text_only', `置信度 ${Math.round(data.confidence * 100)}% < 50%，纯文本模式`);
    } else if (data.confidence < CONFIG.FALLBACK_A_THRESHOLD) {
      applyFallback('audio_only', `置信度 ${Math.round(data.confidence * 100)}% < 80%，仅音频`);
    } else {
      state.renderMode = 'full';
      dom.fallbackIndicator.className = 'fallback-indicator';
      // 尝试加载视频（如果真实资产未就绪会自动跳过）
      if (state.renderMode === 'full') {
        preloadAndPlay(data.audio_url, false).then(() => {
          if (state.renderMode === 'full') {
            preloadAndPlay(data.video_asset, true);
          }
        });
      }
    }
  }

  // ─────────────────────────────────────────
  // 频控
  // ─────────────────────────────────────────
  function checkContinueLimit() {
    const now = Date.now();
    // 清理过期时间戳
    state.continueTimestamps = state.continueTimestamps.filter(
      t => now - t < CONFIG.CONTINUE_WINDOW_MS
    );

    if (state.continueBlocked) {
      log('[频控] 仍在冷却中，阻断', 'error');
      return false;
    }

    if (state.continueTimestamps.length >= CONFIG.CONTINUE_LIMIT) {
      triggerBlock();
      return false;
    }

    state.continueTimestamps.push(now);
    updateFreqCounter();
    return true;
  }

  function triggerBlock() {
    state.continueBlocked = true;
    dom.continueBtn.disabled = true;
    dom.continueBtn.classList.add('blocked');
    dom.continueBtn.innerHTML = '⏸ 操作频繁';

    log(`[频控] 触发阻断，${CONFIG.CONTINUE_LIMIT}次/窗口已满`, 'error');

    clearTimeout(state.cooldownTimer);
    state.cooldownTimer = setTimeout(() => {
      state.continueBlocked = false;
      state.continueTimestamps = [];
      dom.continueBtn.disabled = false;
      dom.continueBtn.classList.remove('blocked');
      dom.continueBtn.innerHTML = '▶ 继续';
      updateFreqCounter();
      log('[频控] 冷却结束，解除阻断', 'tag');
    }, CONFIG.CONTINUE_COOLDOWN_MS);
  }

  function updateFreqCounter() {
    const count = state.continueTimestamps.length;
    const remaining = CONFIG.CONTINUE_LIMIT - count;
    dom.freqCounter.textContent = `继续 ${count}/${CONFIG.CONTINUE_LIMIT}`;
    dom.freqCounter.className = 'freq-counter' +
      (remaining <= 1 ? ' danger' : remaining <= 2 ? ' warning' : '');
  }

  // ─────────────────────────────────────────
  // SSE 连接
  // ─────────────────────────────────────────
  let currentEventSource = null;
  let currentAiMessageEl = null;
  let currentFullText = '';
  let currentResolve = null;

  function sendMessage(message) {
    if (state.isStreaming) return Promise.reject('already streaming');
    if (!message.trim()) return Promise.reject('empty');

    state.isStreaming = true;
    dom.sendBtn.disabled = true;
    dom.continueBtn.disabled = true;
    setStatus('连接中...', 'default');

    addMessage('user', message);
    currentFullText = '';
    currentAiMessageEl = addMessage('ai', '', true);
    scrollToBottom();

    return new Promise((resolve, reject) => {
      currentResolve = resolve;

      const url = `${CONFIG.API_BASE}/chat`;
      const body = JSON.stringify({ message, session_id: state.sessionId });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }).then(res => {
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus('流式接收中', 'streaming');
        return res.body.getReader();
      }).then(reader => {
        const decoder = new TextDecoder();
        let buffer = '';

        function pump() {
          reader.read().then(({ done, value }) => {
            if (done) {
              finishStream();
              return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留不完整的行

            for (const line of lines) {
              processLine(line);
            }
            pump();
          });
        }
        pump();
      }).catch(err => {
        clearTimeout(timeout);
        const msg = err.name === 'AbortError' ? '请求超时，请检查网络' : `连接失败：${err.message}`;
        log(`[SSE错误] ${msg}`, 'error');
        setStatus('连接失败', 'error');
        if (currentAiMessageEl) {
          updateStreamingMessage(currentAiMessageEl, `⚠ ${msg}`);
          finalizeMessage(currentAiMessageEl);
        }
        cleanup();
        reject(err);
      });
    });
  }

  function processLine(line) {
    if (!line.startsWith('event:') && !line.startsWith('data:')) return;

    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      state._pendingEvent = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      const jsonStr = trimmed.slice(5).trim();
      try {
        const data = JSON.parse(jsonStr);
        handleEvent(state._pendingEvent || 'unknown', data);
        state._pendingEvent = null;
      } catch (e) {
        log(`[JSON解析错误] ${jsonStr}`, 'error');
      }
    }
  }

  function handleEvent(eventType, data) {
    log(`[事件] ${eventType}: ${JSON.stringify(data).slice(0, 80)}`, 'event');

    switch (eventType) {
      case 'emotion_tag':
        handleEmotionTag(data);
        break;

      case 'chunk':
        currentFullText += data.text;
        if (currentAiMessageEl) {
          updateStreamingMessage(currentAiMessageEl, currentFullText);
        }
        break;

      case 'done':
        if (currentAiMessageEl) {
          finalizeMessage(currentAiMessageEl);
        }
        log(`[完成] session=${data.session_id} chunks=${data.total_chunks} success=${data.render_success}`, 'tag');
        finishStream();
        break;

      case 'error':
        if (currentAiMessageEl) {
          updateStreamingMessage(currentAiMessageEl, `⚠ ${data.message}`);
          finalizeMessage(currentAiMessageEl);
        }
        log(`[错误] code=${data.code} msg=${data.message}`, 'error');
        finishStream();
        break;
    }
  }

  function finishStream() {
    if (currentResolve) {
      currentResolve({ fullText: currentFullText, emotion: state.currentEmotion });
      currentResolve = null;
    }
    cleanup();
  }

  function cleanup() {
    state.isStreaming = false;
    dom.sendBtn.disabled = false;
    dom.continueBtn.disabled = state.continueBlocked;
    setStatus('就绪', 'connected');
  }

  // ─────────────────────────────────────────
  // 事件绑定
  // ─────────────────────────────────────────

  // 发送
  dom.sendBtn.addEventListener('click', () => {
    const text = dom.messageInput.value.trim();
    if (!text) return;
    dom.messageInput.value = '';
    sendMessage(text).catch(() => {});
  });

  // 回车发送（Shift+Enter 换行）
  dom.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.sendBtn.click();
    }
  });

  // 自动调整高度
  dom.messageInput.addEventListener('input', () => {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 120) + 'px';
  });

  // 继续按钮
  dom.continueBtn.addEventListener('click', () => {
    if (!checkContinueLimit()) return;

    // 发送一个特殊的"继续"信号
    sendMessage('【继续】').catch(() => {});
  });

  // ─────────────────────────────────────────
  // 初始化
  // ─────────────────────────────────────────
  setStatus('就绪', 'connected');
  updateFreqCounter();
  log('天际线 Demo 前端初始化完成', 'tag');
  log(`API: ${CONFIG.API_BASE}`, 'info');
  log('提示：后端启动命令: cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000', 'info');

})();
