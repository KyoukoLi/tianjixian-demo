/**
 * 角色编辑器 — Persona Editor
 * 用户配置角色原子数据，生成系统 Prompt
 */

(function() {
  'use strict';

  // ── 默认角色模板 ──
  const DEFAULT_PERSONA = {
    name: "",
    age: "",
    gender: "",
    appearance: "",
    backstory: "",
    core_traits: "",
    speaking_style: "",
    likes: "",
    dislikes: "",
    goals: "",
    forbidden_topics: "",
    dialogue_examples: "",
    weight: 70, // 人物占比 0-100
  };

  let currentPersona = { ...DEFAULT_PERSONA };

  // ── 渲染 ──
  function render() {
    const container = document.getElementById('personaEditor');
    if (!container) return;

    container.innerHTML = `
      <div class="pe-section">
        <h3 class="pe-section-title">基础信息</h3>
        <div class="pe-grid">
          <div class="pe-field">
            <label>角色名称 *</label>
            <input type="text" id="pe-name" placeholder="如：顾深" value="${v(currentPersona.name)}">
          </div>
          <div class="pe-row">
            <div class="pe-field">
              <label>年龄</label>
              <input type="text" id="pe-age" placeholder="如：28岁" value="${v(currentPersona.age)}">
            </div>
            <div class="pe-field">
              <label>性别</label>
              <select id="pe-gender">
                <option value="">未设置</option>
                <option value="男" ${sel(currentPersona.gender,'男')}>男</option>
                <option value="女" ${sel(currentPersona.gender,'女')}>女</option>
                <option value="其他" ${sel(currentPersona.gender,'其他')}>其他</option>
              </select>
            </div>
          </div>
          <div class="pe-field pe-full">
            <label>外貌特征</label>
            <input type="text" id="pe-appearance" placeholder="如：外表冷峻，眉眼锐利，身着深色西装" value="${v(currentPersona.appearance)}">
          </div>
        </div>
      </div>

      <div class="pe-section">
        <h3 class="pe-section-title">人设核心</h3>
        <div class="pe-grid">
          <div class="pe-field pe-full">
            <label>身世背景</label>
            <textarea id="pe-backstory" rows="3" placeholder="角色的来历、成长经历、重要回忆">${v(currentPersona.backstory)}</textarea>
          </div>
          <div class="pe-field pe-full">
            <label>性格特质</label>
            <input type="text" id="pe-core-traits" placeholder="如：外冷内热、毒舌、责任感强、嘴硬心软" value="${v(currentPersona.core_traits)}">
          </div>
          <div class="pe-field pe-full">
            <label>语言风格</label>
            <input type="text" id="pe-speaking-style" placeholder="如：说话简洁、偶尔毒舌、关键时候温柔" value="${v(currentPersona.speaking_style)}">
          </div>
          <div class="pe-row">
            <div class="pe-field">
              <label>喜好</label>
              <input type="text" id="pe-likes" placeholder="如：黑咖啡、夜深人静" value="${v(currentPersona.likes)}">
            </div>
            <div class="pe-field">
              <label>厌恶</label>
              <input type="text" id="pe-dislikes" placeholder="如：虚伪、背叛" value="${v(currentPersona.dislikes)}">
            </div>
          </div>
          <div class="pe-field pe-full">
            <label>核心目标</label>
            <input type="text" id="pe-goals" placeholder="角色最在意的事，如：保护他在意的人" value="${v(currentPersona.goals)}">
          </div>
          <div class="pe-field pe-full">
            <label>禁忌话题</label>
            <input type="text" id="pe-forbidden-topics" placeholder="角色不愿主动提及的事，如：不主动提家庭和前任" value="${v(currentPersona.forbidden_topics)}">
          </div>
        </div>
      </div>

      <div class="pe-section">
        <h3 class="pe-section-title">对话调教</h3>
        <div class="pe-grid">
          <div class="pe-field pe-full">
            <label>对话示例（few-shot，AI 参考风格）</label>
            <textarea id="pe-dialogue-examples" rows="4" placeholder="每行一条，格式：场景 -> 回复&#10;如：被夸奖时 -> *轻咳一声* ...还行吧。&#10;被质问时 -> *眉头微皱* 关你什么事。">${v(currentPersona.dialogue_examples)}</textarea>
          </div>
        </div>
      </div>

      <div class="pe-section">
        <h3 class="pe-section-title">叙事权重</h3>
        <div class="pe-slider-row">
          <span class="pe-slider-label">故事向</span>
          <input type="range" id="pe-weight" min="0" max="100" value="${currentPersona.weight}"
            oninput="document.getElementById('pe-weight-val').textContent=this.value+'% 人物 / '+(100-this.value)+'% 故事'">
          <span class="pe-slider-label">人物向</span>
        </div>
        <div class="pe-weight-desc" id="pe-weight-val">${currentPersona.weight}% 人物 / ${100-currentPersona.weight}% 故事</div>
        <div class="pe-weight-hint">人物向：注重情感互动、细腻情绪描写。故事向：注重事件推进、冲突触发。</div>
      </div>

      <div class="pe-actions">
        <button class="pe-btn-pe" onclick="PersonaEditor.save()">💾 保存角色</button>
        <button class="pe-btn-ghost" onclick="PersonaEditor.reset()">🔄 重置</button>
        <button class="pe-btn-ghost" onclick="PersonaEditor.export()">📋 导出 Prompt</button>
      </div>

      <div class="pe-preview" id="pePreview">
        <h3 class="pe-section-title">Prompt 预览</h3>
        <pre id="pePromptPreview" class="pe-prompt-code">${escapeHtml(buildPrompt(currentPersona))}</pre>
      </div>
    `;

    updatePreview();
  }

  function updatePreview() {
    const inputs = [
      'name','age','gender','appearance','backstory','core_traits',
      'speaking_style','likes','dislikes','goals','forbidden_topics','dialogue_examples','weight'
    ];
    inputs.forEach(id => {
      const el = document.getElementById('pe-' + id);
      if (el) el.addEventListener('input', syncAndPreview);
    });
  }

  function syncAndPreview() {
    const fields = ['name','age','gender','appearance','backstory','core_traits',
      'speaking_style','likes','dislikes','goals','forbidden_topics'];
    fields.forEach(f => {
      const el = document.getElementById('pe-' + f);
      if (el) currentPersona[f] = el.value;
    });
    const weightEl = document.getElementById('pe-weight');
    if (weightEl) {
      currentPersona.weight = parseInt(weightEl.value);
      document.getElementById('pe-weight-val').textContent =
        currentPersona.weight + '% 人物 / ' + (100 - currentPersona.weight) + '% 故事';
    }
    const preview = document.getElementById('pePromptPreview');
    if (preview) preview.textContent = buildPrompt(currentPersona);

    // Dispatch save event
    window.dispatchEvent(new CustomEvent('persona-changed', { detail: currentPersona }));
  }

  window.PersonaEditor = {
    save() {
      syncAndPreview();
      localStorage.setItem('tianjixian_persona', JSON.stringify(currentPersona));
      alert('角色已保存！');
    },
    reset() {
      if (!confirm('确定重置？当前填写的内容会丢失。')) return;
      currentPersona = { ...DEFAULT_PERSONA };
      render();
    },
    export() {
      syncAndPreview();
      const prompt = buildPrompt(currentPersona);
      navigator.clipboard.writeText(prompt).then(() => alert('Prompt 已复制到剪贴板！'));
    },
    getPersona() { syncAndPreview(); return { ...currentPersona }; },
  };

  // ── Prompt 构建 ──
  function buildPrompt(persona) {
    if (!persona.name) return '// 请先填写角色名称';
    const weight = persona.weight || 50;
    const personaFocus = weight > 60
      ? '注重情感互动和细腻情绪描写，深入角色的内心世界。'
      : weight < 40
      ? '注重事件推进和冲突触发，推进故事主线。'
      : '平衡情感互动与剧情推进，沉浸式叙事。';

    let prompt = `【角色人设】\n`;
    prompt += `你是「${persona.name}」`;
    if (persona.age) prompt += `，${persona.age}`;
    if (persona.gender) prompt += `，${persona.gender}`;
    if (persona.appearance) prompt += `\n外貌：${persona.appearance}`;
    if (persona.backstory) prompt += `\n背景：${persona.backstory}`;
    if (persona.core_traits) prompt += `\n性格：${persona.core_traits}`;
    if (persona.speaking_style) prompt += `\n语言风格：${persona.speaking_style}`;
    if (persona.likes) prompt += `\n喜好：${persona.likes}`;
    if (persona.dislikes) prompt += `\n厌恶：${persona.dislikes}`;
    if (persona.goals) prompt += `\n核心目标：${persona.goals}`;
    if (persona.forbidden_topics) prompt += `\n禁忌话题：${persona.forbidden_topics}（禁止主动提及）`;

    prompt += `\n\n【叙事风格】\n${personaFocus}`;

    prompt += `\n\n【核心规则】\n`;
    prompt += `1. 回复末尾必须标注情绪：[emotion:happy/neutral/sad/angry]\n`;
    prompt += `2. 支持*动作*语法，如：*微微一笑* 你好\n`;
    prompt += `3. 回复简洁自然，1-3句话\n`;
    prompt += `4. 禁止：承认自己是AI、跳出角色、提及禁忌话题\n`;

    if (persona.dialogue_examples) {
      prompt += `\n【对话示例】\n${persona.dialogue_examples}`;
    }

    return prompt;
  }

  // ── 工具函数 ──
  function v(val) { return escapeHtml(val || ''); }
  function sel(cur, val) { return cur === val ? 'selected' : ''; }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── 初始化 ──
  const saved = localStorage.getItem('tianjixian_persona');
  if (saved) {
    try { currentPersona = { ...DEFAULT_PERSONA, ...JSON.parse(saved) }; } catch(e) {}
  }
  render();
})();
