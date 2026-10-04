"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, parent) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent?.append(node);
    return node;
  };
  let zh = false;
  try { zh = localStorage.getItem('considea-study-lang') === 'zh'; } catch {}
  const tr = (en, cn) => zh ? cn : en;
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.title = tr('Considea · Recorded walkthrough', 'Considea · 流程演示');
  for (const node of document.querySelectorAll('[data-en]')) node.textContent = zh ? node.dataset.zh : node.dataset.en;
  for (const node of document.querySelectorAll('[data-aria-en]')) node.setAttribute('aria-label', zh ? node.dataset.ariaZh : node.dataset.ariaEn);
  for (const button of document.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === (zh ? 'zh' : 'en')));
    button.onclick = () => {
      try { localStorage.setItem('considea-study-lang', button.dataset.language); } catch {}
      location.reload();
    };
  }
  try {
    const response = await fetch('/demo-data.json');
    if (!response.ok) throw Error();
    const original = await response.json();
    let dictionary = {};
    if (zh) {
      const response = await fetch('/demo-zh.json');
      if (!response.ok) throw Error();
      dictionary = await response.json();
    }
    const localized = value => typeof value === 'string' ? (dictionary[value] || value)
      : Array.isArray(value) ? value.map(localized)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, value]) => [key, localized(value)])) : value;
    const data = localized(original);
    let position = 0;
    const moments = [
      [tr('Every perspective', '每个人的想法'), tr('First, make room for each person.', '先给每个人表达的空间。')],
      [tr('Find common ground', '寻找共同点'), tr('Start with the problem you care about.', '从你们在意的问题开始。')],
      [tr('Ask a little more', '多问一点'), tr('Leave fewer things unspoken.', '把还没说清楚的事聊明白。')],
      [tr('Work through a difference', '谈清分歧'), tr('Give a difference room to be heard.', '让不同的意见被认真听见。')],
      [tr('Choose the next step', '选择下一步'), tr('Decide when you are ready to explore.', '一起决定何时开始探索。')],
      [tr('Explore an idea', '探索方案'), tr('Look closely at a possible direction.', '认真看看一个可能的方向。')],
      [tr('Refine it together', '一起完善'), tr('A smaller idea. A clearer starting point.', '想法小一点，起点清楚一点。')],
      [tr('A shared direction', '共同的方向'), tr('One project. Everyone on board.', '一个项目，全员认可。')],
    ];
    $('demo-status').textContent = tr('Recorded on ', '录制日期：') + new Date(data.recorded_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    $('run-notes').textContent = data.notes;
    function list(title, items, parent) {
      if (!items?.length) return;
      el('h4', title, parent);
      const ul = el('ul', undefined, parent);
      for (const item of items) el('li', item, ul);
    }
    function sources(items, parent) {
      const valid = (items || []).filter(source => {
        try { return ['https:', 'http:'].includes(new URL(source.url).protocol); } catch { return false; }
      });
      if (!valid.length) return;
      const details = el('details', undefined, parent);
      details.className = 'replay-member';
      el('summary', tr('Explore the sources', '查看参考来源'), details);
      const ul = el('ul', undefined, details);
      for (const source of valid) {
        const li = el('li', undefined, ul);
        const a = el('a', source.title || source.url, li);
        a.href = source.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (source.limitation) el('small', source.limitation, li);
      }
    }
    const links = data.steps.map((step, index) => {
      const button = el('button', undefined, $('step-links'));
      button.type = 'button';
      button.setAttribute('aria-controls', 'step-body');
      el('span', String(index + 1).padStart(2, '0'), button);
      el('span', moments[index]?.[0] || step.kind, button);
      button.onclick = () => { position = index; render(); };
      return button;
    });
    function render() {
      const step = data.steps[position];
      const out = $('step-body');
      out.replaceChildren();
      $('step-number').textContent = tr('Moment ', '第 ') + String(position + 1).padStart(2, '0') + tr(' · ', ' 步 · ') + (moments[position]?.[0] || step.kind);
      $('step-title').textContent = moments[position]?.[1] || step.title;
      $('step-position').textContent = (position + 1) + ' / ' + data.steps.length;
      $('previous').disabled = position === 0;
      $('next').disabled = position === data.steps.length - 1;
      links.forEach((button, index) => {
        if (index === position) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      el('p', step.title, out);
      for (const text of step.paragraphs || []) el('p', text, out);
      for (const item of step.members || []) {
        const details = el('details', undefined, out);
        details.className = 'replay-member';
        const summary = el('summary', item.member, details);
        el('span', tr('Read their words', '看看对方怎么说'), summary);
        el('p', item.text, details);
      }
      if (step.candidate) {
        const candidate = step.candidate;
        el('h4', candidate.title, out);
        el('p', candidate.problem, out);
        el('p', candidate.solution, out);
        list(tr('The first version', '第一个版本'), candidate.mvp_scope, out);
        list(tr('For another day', '留待以后'), candidate.out_of_scope, out);
      }
      if (step.report) {
        for (const [key, test] of Object.entries(step.report.tests || {})) {
          const title = tr(({ novelty: 'How it compares', feasibility: 'Could we build it?' })[key] || 'Review', ({ novelty: '与已有项目相比', feasibility: '我们能做出来吗？' })[key] || '评估');
          const result = tr(({ pass: 'Looks promising', fail: 'Needs another look', insufficient_evidence: 'More to find out' })[test.result] || 'Still open', ({ pass: '值得尝试', fail: '需要再看看', insufficient_evidence: '还需了解更多' })[test.result] || '待确认');
          el('h4', title + ' · ' + result, out);
          el('p', test.reason, out);
          list(tr('What we still need to know', '还需要弄清楚的事'), test.missing_information, out);
        }
        sources(step.report.evidence, out);
      }
    }
    function move(delta) {
      position = Math.max(0, Math.min(data.steps.length - 1, position + delta));
      render();
      $('step-title').focus({ preventScroll: true });
      if ($('step-title').getBoundingClientRect().top < 0) $('step-title').scrollIntoView({ block: 'start' });
    }
    $('previous').onclick = () => move(-1);
    $('next').onclick = () => move(1);
    render();
  } catch {
    $('demo-status').textContent = tr('The saved conversation could not be loaded. Refresh to try again, or watch the video above.', '讨论记录暂时无法加载，请刷新重试，或查看上方实录视频。');
  }
})();
