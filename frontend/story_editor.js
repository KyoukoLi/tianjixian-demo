/**
 * 故事大纲编辑器 — Story Editor
 */

(function() {
  'use strict';

  const DEFAULT_STORY = {
    genre: '',
    setting: '',
    timeline: '',
    endings: [],
    core_conflict: '',
    key_events: '',
    forbidden_elements: '',
  };

  let currentStory = { ...DEFAULT_STORY };

  const ENDINGS = [
    { id: 'he', label: 'HE', desc: 'Happy Ending' },
    { id: 'ne', label: 'NE', desc: 'Normal Ending' },
    { id: 'be', label: 'BE', desc: 'Bad Ending' },
    { id: 'open', label: '开放', desc: '开放式结局' },
  ];

  const GENRES = ['现代都市', '校园', '职场', '古代宫廷', '奇幻', '科幻', '悬疑', '其他'];

  function render() {
    const container = document.getElementById('storyEditor');
    if (!container) return;

    const endingsHtml = ENDINGS.map(e => `
      <div class="ending-option ${currentStory.endings.includes(e.id) ? 'active' : ''}"
           onclick="StoryEditor.toggleEnding('${e.id}')"
           title="${e.desc}">${e.label}</div>
    `).join('');

    const genresHtml = GENRES.map(g => `
      <div class="ending-option ${currentStory.genre === g ? 'active' : ''}"
           onclick="StoryEditor.selectGenre('${g}')">${g}</div>
    `).join('');

    container.innerHTML = `
      <div class="story-section">
        <div class="story-section-title">题材类型</div>
        <div class="ending-options">${genresHtml}</div>
        <div style="margin-top:10px"></div>
        <div class="pe-field">
          <label>自定义题材</label>
          <input type="text" id="st-genre-custom" placeholder="如：民国谍战" value="${v(currentStory.genre_custom || '')}"
                 oninput="StoryEditor.setGenre(this.value)">
        </div>
      </div>

      <div class="story-section">
        <div class="story-section-title">世界观设定</div>
        <div class="pe-field">
          <label>故事背景</label>
          <textarea id="st-setting" rows="3" placeholder="故事发生的时代、地点、社会环境。如：上海，2024年，公司高管与新人相遇">${v(currentStory.setting)}</textarea>
        </div>
        <div style="margin-top:10px"></div>
        <div class="pe-field">
          <label>时间跨度</label>
          <input type="text" id="st-timeline" placeholder="如：从初遇到相知，跨度3个月" value="${v(currentStory.timeline)}">
        </div>
      </div>

      <div class="story-section">
        <div class="story-section-title">结局方向</div>
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-mute)">可多选</div>
        <div class="ending-options">${endingsHtml}</div>
      </div>

      <div class="story-section">
        <div class="story-section-title">剧情设定</div>
        <div class="pe-field">
          <label>核心冲突</label>
          <textarea id="st-conflict" rows="2" placeholder="故事主线矛盾。如：家族利益 vs 真心、身份秘密 vs 相爱">${v(currentStory.core_conflict)}</textarea>
        </div>
        <div style="margin-top:10px"></div>
        <div class="pe-field">
          <label>关键事件节点（用换行分隔）</label>
          <textarea id="st-events" rows="3" placeholder="必须发生的重要节点。如：&#10;初遇 - 咖啡厅偶遇&#10;误解 - 身份被误解&#10;表白 - 雨中告白">${v(currentStory.key_events)}</textarea>
        </div>
      </div>

      <div class="story-section">
        <div class="story-section-title">禁区设定</div>
        <div class="pe-field">
          <label>禁止出现的元素（用换行分隔）</label>
          <textarea id="st-forbidden" rows="3" placeholder="该世界观/题材下禁止出现的内容。如：&#10;除穿越剧外，不出现超自然元素&#10;不出现现代科技（手机、电脑等）">${v(currentStory.forbidden_elements)}</textarea>
        </div>
        <div style="margin-top:8px;font-size:12px;color:var(--amber)">AI 生成冲突和对话时，会自动避免触发禁区元素</div>
      </div>

      <div class="pe-actions">
        <button class="pe-btn-pe" onclick="StoryEditor.save()">💾 保存故事</button>
        <button class="pe-btn-ghost" onclick="StoryEditor.reset()">🔄 重置</button>
        <button class="pe-btn-ghost" onclick="StoryEditor.export()">📋 导出</button>
      </div>

      <div class="pe-preview">
        <h3 class="story-section-title">Prompt 片段预览</h3>
        <pre class="pe-prompt-code">${escapeHtml(buildStoryPrompt(currentStory))}</pre>
      </div>
    `;

    window.dispatchEvent(new CustomEvent('story-changed', { detail: currentStory }));
  }

  window.StoryEditor = {
    selectGenre(genre) {
      currentStory.genre = genre;
      document.getElementById('st-genre-custom').value = '';
      render();
    },
    setGenre(val) {
      currentStory.genre = val;
      render();
    },
    toggleEnding(id) {
      const idx = currentStory.endings.indexOf(id);
      if (idx >= 0) currentStory.endings.splice(idx, 1);
      else currentStory.endings.push(id);
      render();
    },
    save() {
      syncFromInputs();
      localStorage.setItem('tianjixian_story', JSON.stringify(currentStory));
      alert('故事已保存！');
    },
    reset() {
      if (!confirm('确定重置？')) return;
      currentStory = { ...DEFAULT_STORY };
      render();
    },
    export() {
      syncFromInputs();
      const text = buildStoryPrompt(currentStory);
      navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板！'));
    },
    getStory() {
      syncFromInputs();
      return { ...currentStory };
    },
  };

  function syncFromInputs() {
    const fields = ['setting', 'timeline', 'conflict', 'events', 'forbidden'];
    const keys = ['setting', 'timeline', 'core_conflict', 'key_events', 'forbidden_elements'];
    fields.forEach((f, i) => {
      const el = document.getElementById('st-' + f);
      if (el) currentStory[keys[i]] = el.value;
    });
    const customGenre = document.getElementById('st-genre-custom');
    if (customGenre && customGenre.value) currentStory.genre = customGenre.value;
    window.dispatchEvent(new CustomEvent('story-changed', { detail: currentStory }));
  }

  function buildStoryPrompt(story) {
    if (!story.genre && !story.setting) return '// 请先填写题材类型和故事背景';
    let prompt = '【故事框架】\n';
    if (story.genre) prompt += `题材：${story.genre}\n`;
    if (story.setting) prompt += `世界观：${story.setting}\n`;
    if (story.timeline) prompt += `时间线：${story.timeline}\n`;
    if (story.endings.length) prompt += `结局方向：${story.endings.map(e => ENDINGS.find(x=>x.id===e)?.label).join(' / ')}\n`;
    if (story.core_conflict) prompt += `核心冲突：${story.core_conflict}\n`;
    if (story.key_events) prompt += `关键事件：\n${story.key_events.split('\n').map(e=>'- '+e.trim()).filter(Boolean).join('\n')}\n`;
    if (story.forbidden_elements) prompt += `禁区（禁止出现）：\n${story.forbidden_elements.split('\n').map(e=>'- '+e.trim()).filter(Boolean).join('\n')}\n`;
    return prompt;
  }

  function v(val) { return escapeHtml(val || ''); }
  function escapeHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Init
  const saved = localStorage.getItem('tianjixian_story');
  if (saved) {
    try { currentStory = { ...DEFAULT_STORY, ...JSON.parse(saved) }; } catch(e) {}
  }
  render();
})();
