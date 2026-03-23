/**
 * 天际线 Demo — 前端核心逻辑
 * 优化版：适配新 UI
 */
(function () {
  'use strict';

  const CONFIG = {
    API_BASE: 'https://tianjixian-demo-production.up.railway.app',
    CONTINUE_WINDOW_MS: 60_000,
    CONTINUE_LIMIT: 3,
    CONTINUE_COOLDOWN_MS: 30_000,
  };

  const state = {
    sessionId: crypto.randomUUID(),
    isStreaming: false,
    continueTimestamps: [],
    continueBlocked: false,
  };

  // DOM
  const $ = id => document.getElementById(id);
  const dom = {
    statusDot:    $('statusDot'),
    statusText:   $('statusText'),
    emotionIcon:  $('emotionIcon'),
    emotionTag:   $('emotionTag'),
    emotionConf:  $('emotionConf'),
    emotionDesc:  $('emotionDesc'),
    emotionStatus:$('emotionStatus'),
    chatMessages: $('chatMessages'),
    messageInput: $('messageInput'),
    sendBtn:      $('sendBtn'),
    continueBtn:  $('continueBtn'),
    freqCounter:  $('freqCounter'),
    debugPanel:   $('debugPanel'),
    debugToggle:  $('debugToggle'),
  };

  const missing = Object.entries(dom).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    document.body.innerHTML = `<div style="padding:20px;color:#f87171">缺少元素: ${missing.join(', ')}</div>`;
    return;
  }

  // ── 日志 ──
  function log(msg, type) {
    const el = document.createElement('div');
    el.className = 'd-line ' + (type || '');
    el.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    dom.debugPanel.appendChild(el);
    dom.debugPanel.scrollTop = dom.debugPanel.scrollHeight;
  }

  // ── 状态 ──
  function setStatus(text, dot) {
    dom.statusText.textContent = text;
    dom.statusDot.className = 'dot ' + (dot || '');
  }

  // ── 情绪卡片 ──
  const EMOTION_MAP = {
    neutral: { icon: '😐', desc: '情绪平稳，保持对话', color: 'ok' },
    happy:   { icon: '😊', desc: '心情愉悦，期待继续', color: 'ok' },
    sad:     { icon: '😢', desc: '情绪低落，需要关注', color: 'warn' },
    angry:   { icon: '😠', desc: '情绪激动，注意引导', color: 'warn' },
    curious: { icon: '🤔', desc: '好奇追问，深入交流', color: 'ok' },
    tired:   { icon: '😴', desc: '疲惫困倦，可能流失', color: 'warn' },
  };

  function setEmotion(tag, confidence) {
    const info = EMOTION_MAP[tag] || EMOTION_MAP.neutral;
    dom.emotionIcon.textContent = info.icon;
    dom.emotionTag.textContent = tag || '未知';
    dom.emotionConf.textContent = confidence ? ` ${Math.round(confidence*100)}%` : '';
    dom.emotionDesc.textContent = info.desc;
    dom.emotionStatus.textContent = confidence
      ? (confidence >= 0.8 ? '高置信' : confidence >= 0.5 ? '中置信' : '低置信')
      : '就绪';
    dom.emotionStatus.className = 'emotion-status ' + info.color;
  }

  // ── 消息 ──
  function addMessage(role, content, thinking) {
    if (thinking) {
      const el = document.createElement('div');
      el.className = 'msg ai';
      el.id = 'thinkingMsg';
      el.innerHTML = `<div class="msg-label">天际线</div><div class="bubble thinking"><div class="thinking-dots"><span></span><span></span><span></span></div>&nbsp;思考中...</div>`;
      dom.chatMessages.appendChild(el);
      el.scrollIntoView({ behavior: 'smooth' });
      return el;
    }

    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.innerHTML = `<div class="msg-label">${role === 'user' ? '你' : '天际线'}</div><div class="bubble">${escapeHtml(content)}</div>`;
    dom.chatMessages.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth' });
    return el;
  }

  function updateMessage(el, content) {
    el.querySelector('.bubble').textContent = content;
    el.scrollIntoView({ behavior: 'smooth' });
  }

  function removeThinking() {
    const t = document.getElementById('thinkingMsg');
    if (t) t.remove();
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── 快速情绪 ──
  window.qeSend = function(action) {
    dom.messageInput.value = action;
    dom.messageInput.focus();
  };

  // ── 诊断面板折叠 ──
  window.toggleDebug = function() {
    const panel = dom.debugPanel;
    const hint = document.getElementById('debugToggleHint');
    panel.classList.toggle('open');
    hint.textContent = panel.classList.contains('open') ? '(点击收起)' : '(点击展开)';
  };

  // ── 发送 ──
  function sendMessage(message) {
    if (state.isStreaming || !message.trim()) return;
    state.isStreaming = true;
    dom.sendBtn.disabled = true;
    dom.sendBtn.textContent = '···';
    dom.continueBtn.disabled = true;
    setStatus('思考中...', 'wait');
    removeThinking();

    addMessage('user', message);
    const aiEl = addMessage('ai', '', true);
    log('发送: ' + message, 'info');

    fetch(CONFIG.API_BASE + '/chat/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: state.sessionId }),
    }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(data => {
      log('收到 ' + data.events.length + ' 个事件', 'tag');
      let full = '';
      for (const ev of data.events) {
        switch (ev.type) {
          case 'emotion_tag':
            setEmotion(ev.data.tag, ev.data.confidence);
            log('情绪: ' + ev.data.tag + ' | 置信: ' + ev.data.confidence, 'tag');
            break;
          case 'chunk':
            full += ev.data.text;
            updateMessage(aiEl, full);
            break;
          case 'done':
            full = ev.data.full_text || full;
            setEmotion(ev.data.emotion_tag, ev.data.confidence);
            log('完成: ' + full, 'tag');
            break;
          case 'error':
            log('错误: ' + ev.data.code + ' — ' + ev.data.message, 'err');
            updateMessage(aiEl, '⚠ ' + ev.data.message);
            break;
        }
      }
      updateMessage(aiEl, full || '(空)');
      setStatus('就绪', 'ok');
    }).catch(e => {
      log('请求失败: ' + e.message, 'err');
      updateMessage(aiEl, '⚠ ' + e.message);
      setStatus('连接失败', 'err');
    }).finally(() => {
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      dom.sendBtn.textContent = '发送';
      dom.continueBtn.disabled = state.continueBlocked;
    });
  }

  // ── 频控 ──
  function checkContinue() {
    const now = Date.now();
    state.continueTimestamps = state.continueTimestamps.filter(t => now - t < CONFIG.CONTINUE_WINDOW_MS);
    if (state.continueBlocked) { log('继续已阻断（冷却中）', 'err'); return false; }
    if (state.continueTimestamps.length >= CONFIG.CONTINUE_LIMIT) {
      log('继续已阻断（窗口内已达上限）', 'err');
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
    dom.continueBtn.textContent = '⏸ 频繁';
    log('频控触发，30s 冷却', 'err');
    clearTimeout(state._cooldownTimer);
    state._cooldownTimer = setTimeout(() => {
      state.continueBlocked = false;
      state.continueTimestamps = [];
      dom.continueBtn.disabled = false;
      dom.continueBtn.classList.remove('blocked');
      dom.continueBtn.textContent = '继续';
      updateFreqCounter();
      log('频控冷却结束', 'tag');
    }, CONFIG.CONTINUE_COOLDOWN_MS);
  }

  function updateFreqCounter() {
    const c = state.continueTimestamps.length;
    const rem = CONFIG.CONTINUE_LIMIT - c;
    dom.freqCounter.textContent = '继续 ' + c + '/' + CONFIG.CONTINUE_LIMIT;
    dom.freqCounter.className = 'freq' + (rem <= 1 ? ' danger' : rem <= 2 ? ' warn' : '');
  }

  // ── 重置 ──
  window.__reset = () => {
    state.sessionId = crypto.randomUUID();
    dom.chatMessages.innerHTML = '';
    dom.messageInput.value = '';
    dom.messageInput.style.height = 'auto';
    dom.continueBtn.disabled = false;
    dom.continueBtn.classList.remove('blocked');
    dom.continueBtn.textContent = '继续';
    state.continueTimestamps = [];
    state.continueBlocked = false;
    state.isStreaming = false;
    dom.sendBtn.disabled = false;
    clearTimeout(state._cooldownTimer);
    setEmotion('neutral', null);
    setStatus('已重置', 'ok');
    updateFreqCounter();
    log('会话已重置，新 session: ' + state.sessionId, 'tag');
  };

  // ── 事件绑定 ──
  window.__send = () => {
    const t = dom.messageInput.value.trim();
    dom.messageInput.value = '';
    dom.messageInput.style.height = 'auto';
    if (t) sendMessage(t);
  };
  window.__continue = () => {
    if (checkContinue()) sendMessage('【继续】');
  };
  dom.sendBtn.addEventListener('click', window.__send);

  dom.messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.sendBtn.click();
    }
  });

  dom.messageInput.addEventListener('input', () => {
    dom.messageInput.style.height = 'auto';
    dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 100) + 'px';
  });

  dom.continueBtn.addEventListener('click', () => {
    if (checkContinue()) sendMessage('【继续】');
  });

  // ── 初始化 ──
  setStatus('就绪', 'ok');
  setEmotion('neutral', null);
  updateFreqCounter();
  log('天际线 Demo 初始化完成', 'tag');
  log('API: ' + CONFIG.API_BASE, 'info');
  log('模型: MiniMax-M2.5-highspeed', 'tag');
  log('提示：发送 *动作* 语法可触发情绪渲染', 'info');

  // 启动时健康检查
  fetch(CONFIG.API_BASE + '/health')
    .then(r => r.json())
    .then(d => { log('后端健康: ' + JSON.stringify(d), 'tag'); setStatus('就绪', 'ok'); })
    .catch(e => { log('后端连接失败: ' + e.message, 'err'); setStatus('连接失败', 'err'); });

})();
