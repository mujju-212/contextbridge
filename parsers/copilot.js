// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/copilot.js — copilot.microsoft.com + bing.com/chat  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0 (March 2025):
//   • cib-chat-turn (Angular) still confirmed stable on copilot.microsoft.com.
//   • React renderer: [data-turn-id] / [data-turn-role] confirmed.
//   • New strip targets: [class*="suggestedReplies"] (response suggestion chips),
//     [class*="workingCard"], [class*="WorkingCard"] (new "working" indicator),
//     [class*="disclaimerText"] (legal footer text).
//   • Copilot image generation: [class*="imageGeneration"] img, [class*="dalleImage"]
//     added to imgSels for Designer/DALL-E outputs.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseCopilot() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;

  const proc = (node, role) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: ['[class*="attachment"]','[class*="fileChip"]','[class*="imageCard"]','[class*="upload"]','[class*="ImageAttachment"]','cib-attachment'],
      imgSels: [
        'img[src*="blob:"]',
        'img[src*="bing.com"]',
        'img[src*="microsoft.com"]',
        'img[src*="copilot"]',
        'img[src*="th.bing.com"]',
        'img[src*="www.bing.com/images"]',
        // Designer / DALL-E image generation outputs
        '[class*="imageGeneration"] img','[class*="dalleImage"] img',
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="avatar"]):not([src*="favicon"])',
      ]
    }); fi = nf;
    const txt = cleanMessageText(stripAndGetText(node, [
      'cib-action-bar', 'cib-feedback-buttons', 'cib-message-actions', 'cib-work-in-progress',
      '[class*="thinking"]','[class*="reasoningStep"]','[class*="ThinkingCard"]',
      '[class*="workingCard"]','[class*="WorkingCard"]',    // "Working on it..." indicator
      '[class*="suggestedReplies"]',                        // suggested reply chips
      '[class*="disclaimerText"]',                          // legal disclaimer footer
      'button', 'svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  };

  // Strategy 1a: cib-chat-turn Web Component (Angular Copilot — confirmed 2025)
  const cibs = document.querySelectorAll('cib-chat-turn');
  if (cibs.length) {
    cibs.forEach(t => proc(t, t.getAttribute('source') === 'user' ? 'u' : 'a'));
    return assembleCCMF('copilot', msgs, ts, cm, am);
  }

  // Strategy 1b: cib-message-group (older bing.com/chat layout)
  const groups = document.querySelectorAll('cib-message-group');
  if (groups.length) {
    groups.forEach(g => {
      const role = (g.getAttribute('source') || '').toLowerCase() === 'user' ? 'u' : 'a';
      g.querySelectorAll('cib-message').forEach(m => proc(m, role));
    });
    return assembleCCMF('copilot', msgs, ts, cm, am);
  }

  // Strategy 2: Next Copilot React renderer (data-turn-id)
  let pairs = [];
  document.querySelectorAll('[data-turn-id]').forEach(n => {
    const role = n.getAttribute('data-turn-role') || n.getAttribute('data-author') || '';
    pairs.push({ node: n, role: role.toLowerCase().includes('user') ? 'u' : 'a' });
  });

  // Strategy 3: data-content role
  if (!pairs.length) {
    document.querySelectorAll('[data-content="user-message"],[data-content="bot-message"]').forEach(n => {
      pairs.push({ node: n, role: n.getAttribute('data-content').includes('user') ? 'u' : 'a' });
    });
  }

  // Strategy 4: aria-label on message containers
  if (!pairs.length) {
    document.querySelectorAll('[aria-label*="User" i],[aria-label*="Copilot" i],[aria-label*="input" i],[aria-label*="response" i]').forEach(n => {
      if (!n.innerText?.trim()) return;
      const lbl = (n.getAttribute('aria-label') || '').toLowerCase();
      const isUser = lbl.includes('user') || lbl.includes('input') || lbl.includes('you');
      pairs.push({ node: n, role: isUser ? 'u' : 'a' });
    });
  }

  // Strategy 5: class keyword scan
  if (!pairs.length) {
    document.querySelectorAll('[class*="userMessage"],[class*="HumanMessage"]').forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll('[class*="botMessage"],[class*="AiMessage"],[class*="CopilotMessage"],[class*="AssistantMessage"]').forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 6: role listitem structural scan
  if (!pairs.length) {
    document.querySelectorAll('[role="listitem"],[class*="message-item"]').forEach(n => {
      if (!n.innerText?.trim()) return;
      const hasMd = !!n.querySelector('.markdown,[class*="markdown"],[class*="ac-body"]');
      pairs.push({ node: n, role: hasMd ? 'a' : 'u' });
    });
  }

  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const filtered = [];
  pairs.forEach(p => {
    if (!filtered.some(q => q.node.contains(p.node) || p.node.contains(q.node))) filtered.push(p);
  });
  filtered.forEach(({ node, role }) => proc(node, role));
  return assembleCCMF('copilot', msgs, ts, cm, am);
}
