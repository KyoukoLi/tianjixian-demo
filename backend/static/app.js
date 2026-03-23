/**
 * 天际线 Demo — 前端核心逻辑
 * 负责：聊天请求 / 并发调度 / 降级策略 / 频控 / UI 渲染
 * 通信模式：轮询（POST /chat/poll）
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────
  const getApiBase = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('api')) return params.get('api');
    return window.location.origin;
  };

  const CONFIG = {
    API_BASE: getApiBase(),
    CONTINUE_WINDOW_MS: 60_000,
    CONTINUE_LIMIT: 3,
    CONTINUE_COOLDOWN_MS: 30_000,
    FALLBACK_A_THRESHOLD: 0.5,
    FALLBACK_B_THRESHOLD: 0.5,
  };

  // ─────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────
  const state = {
    sessionId: crypto.randomUUID(),
    isStreaming: false,
    continueCount: 0,
    continueTimestamps: [],
    continueBlocked: false,
    cooldownTimer: null,
    currentEmotion: null,
    currentConfidence: 0,
    currentVideoAsset: null,
    currentAudioUrl: null,
    renderMode: 'full',
  };

  // ─────────────────────────────────────────
  // DOM refs
  // ─────────────────────────────────────────
  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) console.error('[天际线] 找不到元素:', id);
    return el;
  };

  const dom = {
    messageInput:     $('messageInput'),
    sendBtn:          $('sendBtn'),
    continueBtn:      $('continueBtn'),
    chatMessages:     $('chatMessages'),
    statusDot:        $('statusDot'),
    freqCounter:      $('freqCounter'),
    debugLog:         $('debugLog'),
    videoPlayer:      $('videoPlayer'),
    videoPlaceholder:  $('videoPlaceholder'),
    emotionBadge:     $('emotionBadge'),
    fallbackIndicator:$('fallbackIndicator'),
    statusText:       $('statusText'),
  };

  // ─────────────────────────────────────────
  // 启动检查
  // ─────────────────────────────────────────
  const missing = Object.entries(dom).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('[天际线] 缺少 DOM 元素:', missing.join(', '));
    document.body.innerHTML = `<div style="padding:20px;color:red;font-size:16px">
      天际线 Demo 加载失败，缺少元素: ${missing.join(', ')}
    </div>`;
    return;
  }

  console.log('[天际线] 初始化完成，API:', CONFIG.API_BASE);

  // ─────────────────────────────────────────
  // 工具
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
  function addMessage(role, content) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${role}`;
    msgEl.innerHTML = `
      <div class="message-label">${role === 'user' ? '你' : '天际线'}</div>
      <div class="message-bubble">${escapeHtml(content)}</div>
    `;
    dom.chatMessages.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  function updateMessage(msgEl, content) {
    const bubble = msgEl.querySelector('.message-bubble');
    bubble.textContent = content;
    scrollToBottom();
  }

  // ─────────────────────────────────────────
  // 情绪 + 媒体
  // ─────────────────────────────────────────
  function handleEmotionTag(data) {
    state.currentEmotion = data.tag;
    state.currentConfidence = data.confidence;
    state.currentVideoAsset = data.video_asset;
    state.currentAudioUrl = data.audio_url;

    dom.emotionBadge.textContent = `${data.tag} · ${Math.round(data.confidence * 100)}%`;
    dom.emotionBadge.className = `emotion-badge visible ${data.tag}`;
    dom.fallbackIndicator.className = 'fallback-indicator';

    log(`[情绪] tag=${data.tag} confidence=${data.confidence}`, 'tag');
    log(`[资源] video=${data.video_asset} audio=${data.audio_url}`, 'tag');

    if (data.confidence < CONFIG.FALLBACK_B_THRESHOLD) {
      applyFallback('text_only', `置信度 ${Math.round(data.confidence * 100)}% < 50%，纯文本`);
    } else if (data.confidence < CONFIG.FALLBACK_A_THRESHOLD) {
      applyFallback('audio_only', `置信度 ${Math.round(data.confidence * 100)}% < 80%，仅音频`);
    } else {
      state.renderMode = 'full';
      dom.fallbackIndicator.className = 'fallback-indicator';
      log(`[模式] 全量渲染：视频 + 音频 + 文本`, 'tag');
    }
  }

  function applyFallback(level, reason) {
    state.renderMode = level;
    dom.videoPlayer.pause();
    dom.videoPlayer.style.display = 'none';
    dom.videoPlaceholder.style.display = 'flex';
    dom.fallbackIndicator.textContent = reason;
    dom.fallbackIndicator.className = `fallback-indicator visible${level === 'text_only' ? ' level-b' : ''}`;
    log(`[降级] ${level} — ${reason}`, 'error');
  }

  function handleDone(data) {
    log(`[完成] session=${data.session_id} chunks=${data.total_chunks}`, 'tag');
  }

  function handleError(data) {
    log(`[错误] ${data.code}: ${data.message}`, 'error');
  }

  // ─────────────────────────────────────────
  // 轮询发送
  // ─────────────────────────────────────────
  function sendMessage(message) {
    if (state.isStreaming) return Promise.reject('already streaming');
    if (!message.trim()) return Promise.reject('empty');

    state.isStreaming = true;
    dom.sendBtn.disabled = true;
    dom.continueBtn.disabled = true;
    setStatus('思考中...', 'default');

    addMessage('user', message);
    const aiMsgEl = addMessage('ai', '···');
    scrollToBottom();

    const url = `${CONFIG.API_BASE}/chat/poll`;
    const body = JSON.stringify({ message, session_id: state.sessionId });

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }).then(data => {
      log(`[轮询] 收到 ${data.events.length} 个事件`, 'event');
      let fullText = '';

      for (const event of data.events) {
        log(`[事件] ${event.type}`, 'event');

        switch (event.type) {
          case 'emotion_tag':
            handleEmotionTag(event.data);
            break;
          case 'chunk':
            fullText += event.data.text;
            updateMessage(aiMsgEl, fullText);
            break;
          case 'done':
            handleDone(event.data);
            fullText = event.data.full_text || fullText;
            break;
          case 'error':
            handleError(event.data);
            updateMessage(aiMsgEl, `⚠ ${event.data.message}`);
            break;
        }
      }

      updateMessage(aiMsgEl, fullText || '（无内容）');
      setStatus('就绪', 'connected');
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      dom.continueBtn.disabled = state.continueBlocked;
      return data;
    }).catch(err => {
      log(`[请求错误] ${err.message}`, 'error');
      setStatus('连接失败', 'error');
      updateMessage(aiMsgEl, `⚠ 连接失败：${err.message}`);
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      dom.continueBtn.disabled = state.continueBlocked;
      return Promise.reject(err);
    });
  }

  // ─────────────────────────────────────────
  // 频控
  // ─────────────────────────────────────────
  function checkContinueLimit() {
    const now = Date.now();
    state.continueTimestamps = state.continueTimestamps.filter(
      t => now - t < CONFIG.CONTINUE_WINDOW_MS
    );

    if (state.continueBlocked) { log('[频控] 冷却中', 'error'); return false; }
    if (state.continueTimestamps.length >= CONFIG.CONTINUE_LIMIT) {
      triggerBlock(); return false;
    }

    state.continueTimestamps.push(now);
    updateFreqCounter();
    return true;
  }

  function triggerBlock() {
    state.continueBlocked = true;
    dom.continueBtn.disabled = true;
    dom.continueBtn.classList.add('blocked');
    dom.continueBtn.querySelector('span').textContent = '操作频繁';
    log('[频控] 触发阻断', 'error');

    clearTimeout(state.cooldownTimer);
    state.cooldownTimer = setTimeout(() => {
      state.continueBlocked = false;
      state.continueTimestamps = [];
      dom.continueBtn.disabled = false;
      dom.continueBtn.classList.remove('blocked');
      dom.continueBtn.querySelector('span').textContent = '▶ 继续';
      updateFreqCounter();
      log('[频控] 冷却结束', 'tag');
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
  // 测试按钮（诊断用）
  // ─────────────────────────────────────────
  const testBtn = document.getElementById('testBtn');
  if (testBtn) {
    testBtn.addEventListener('click', () => {
      log('点击测试按钮，发送 "test" 到 ' + CONFIG.API_BASE + '/chat/poll', 'tag');
      fetch(`${CONFIG.API_BASE}/chat/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' }),
      }).then(r => {
        log(`测试请求: HTTP ${r.status}`, r.ok ? 'tag' : 'error');
        return r.json();
      }).then(d => {
        log(`收到 ${d.events.length} 个事件`, 'tag');
        const done = d.events.find(e => e.type === 'done');
        if (done) log(`AI 回复: ${done.data.full_text}`, 'tag');
      }).catch(e => {
        log(`测试失败: ${e.message}`, 'error');
      });
    });
  }

  // ─────────────────────────────────────────
  // 事件绑定
  // ─────────────────────────────────────────
  dom.sendBtn.addEventListener('click', () => {
    const text = dom.messageInput.value.trim();
    if (!text) return;
    dom.messageInput.value = '';
    sendMessage(text);
  });

  dom.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.sendBtn.click();
    }
  });

  dom.messageInput.addEventListener('input', () => {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 120) + 'px';
  });

  dom.continueBtn.addEventListener('click', () => {
    if (!checkContinueLimit()) return;
    sendMessage('【继续】');
  });

  // ─────────────────────────────────────────
  // 初始化
  // ─────────────────────────────────────────
  setStatus('就绪', 'connected');
  updateFreqCounter();
  log('天际线 Demo 初始化完成', 'tag');
  log(`API: ${CONFIG.API_BASE}`, 'info');
  log('通信模式: 轮询', 'tag');
  log('点击"测试API"按钮验证网络连通性', 'info');

})();
