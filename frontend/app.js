/**
 * 天际线 Demo — 前端核心逻辑
 * GitHub Pages 版本：API 指向 Railway
 */
(function () {
  'use strict';

  const CONFIG = {
    API_BASE: 'https://tianjixian-demo-production.up.railway.app',
    CONTINUE_WINDOW_MS: 60_000,
    CONTINUE_LIMIT: 3,
    CONTINUE_COOLDOWN_MS: 30_000,
    FALLBACK_A_THRESHOLD: 0.5,
    FALLBACK_B_THRESHOLD: 0.5,
  };

  const state = {
    sessionId: crypto.randomUUID(),
    isStreaming: false,
    continueTimestamps: [],
    continueBlocked: false,
    cooldownTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const dom = {
    messageInput:     $('messageInput'),
    sendBtn:          $('sendBtn'),
    continueBtn:      $('continueBtn'),
    chatMessages:     $('chatMessages'),
    statusDot:        $('statusDot'),
    freqCounter:      $('freqCounter'),
    debugLog:         $('debugLog'),
    videoPlaceholder: $('videoPlaceholder'),
    emotionBadge:    $('emotionBadge'),
    fallbackIndicator:$('fallbackIndicator'),
    statusText:       $('statusText'),
  };

  // startup check
  const missing = Object.entries(dom).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    document.body.innerHTML = '<div style="padding:20px;color:red">缺少元素: ' + missing.join(', ') + '</div>';
    return;
  }

  const log = (msg, type) => {
    const line = document.createElement('div');
    line.className = 'debug-line ' + (type || 'info');
    line.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    dom.debugLog.appendChild(line);
    dom.debugLog.scrollTop = dom.debugLog.scrollHeight;
  };

  const setStatus = (text, type) => {
    dom.statusDot.className = 'status-dot ' + (type || '');
    dom.statusText.textContent = text;
  };

  const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function addMsg(role, content) {
    const el = document.createElement('div');
    el.className = 'message ' + role;
    el.innerHTML = '<div class="message-label">' + (role==='user'?'你':'天际线') + '</div><div class="message-bubble">' + escapeHtml(content) + '</div>';
    dom.chatMessages.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth' });
    return el;
  }

  function updateMsg(el, content) {
    el.querySelector('.message-bubble').textContent = content;
  }

  function sendMessage(message) {
    if (state.isStreaming || !message.trim()) return;
    state.isStreaming = true;
    dom.sendBtn.disabled = true;
    dom.continueBtn.disabled = true;
    setStatus('思考中...');

    const userEl = addMsg('user', message);
    const aiEl = addMsg('ai', '···');
    log('发送: ' + message);

    fetch(CONFIG.API_BASE + '/chat/poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: state.sessionId }),
    }).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(data => {
      log('收到 ' + data.events.length + ' 个事件');
      let full = '';
      for (const ev of data.events) {
        switch (ev.type) {
          case 'emotion_tag':
            dom.emotionBadge.textContent = ev.data.tag + ' ' + Math.round(ev.data.confidence*100) + '%';
            dom.emotionBadge.className = 'emotion-badge visible ' + ev.data.tag;
            log('情绪: ' + ev.data.tag + ' 置信度: ' + ev.data.confidence);
            break;
          case 'chunk':
            full += ev.data.text;
            updateMsg(aiEl, full);
            break;
          case 'done':
            full = ev.data.full_text || full;
            log('完成: ' + full);
            break;
          case 'error':
            updateMsg(aiEl, '错误: ' + ev.data.message);
            log('错误: ' + ev.data.message, 'error');
            break;
        }
      }
      updateMsg(aiEl, full || '(空)');
    }).catch(e => {
      updateMsg(aiEl, '请求失败: ' + e.message);
      log('失败: ' + e.message, 'error');
    }).finally(() => {
      state.isStreaming = false;
      dom.sendBtn.disabled = false;
      dom.continueBtn.disabled = state.continueBlocked;
      setStatus('就绪', 'connected');
    });
  }

  function checkContinue() {
    const now = Date.now();
    state.continueTimestamps = state.continueTimestamps.filter(t => now - t < CONFIG.CONTINUE_WINDOW_MS);
    if (state.continueBlocked || state.continueTimestamps.length >= CONFIG.CONTINUE_LIMIT) {
      log('继续已阻断', 'error');
      return false;
    }
    state.continueTimestamps.push(now);
    updateFreqCounter();
    return true;
  }

  function updateFreqCounter() {
    const c = state.continueTimestamps.length;
    dom.freqCounter.textContent = '继续 ' + c + '/' + CONFIG.CONTINUE_LIMIT;
    dom.freqCounter.className = 'freq-counter' + (c >= 2 ? ' warning' : '');
  }

  dom.sendBtn.onclick = () => {
    const t = dom.messageInput.value.trim();
    dom.messageInput.value = '';
    if (t) sendMessage(t);
  };
  dom.messageInput.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.sendBtn.click();
    }
  };
  dom.continueBtn.onclick = () => {
    if (checkContinue()) sendMessage('【继续】');
  };

  setStatus('就绪', 'connected');
  updateFreqCounter();
  log('天际线 Demo 初始化完成', 'tag');
  log('API: ' + CONFIG.API_BASE, 'tag');
  log('使用 GitHub Pages 前端 + Railway 后端', 'info');

  // Test on load
  fetch(CONFIG.API_BASE + '/health').then(r => r.json()).then(d => {
    log('后端健康: ' + JSON.stringify(d), 'tag');
  }).catch(e => {
    log('后端连接失败: ' + e.message, 'error');
  });
})();
