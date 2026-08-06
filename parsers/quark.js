// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/quark.js — quark.cn  v2.0 (selectors confirmed)
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0:
//   • Quark AI (夸克) uses a Vue-based frontend.
//   • Added [data-role] as primary Strategy 1 — most reliable.
//   • Added [class*="chat-user-query"] / [class*="chat-ai-answer"] as Strategy 2 —
//     Quark's stable class naming convention for their AI chat feature.
//   • Extended class keyword set for Strategy 3.
//   • Added stripping of Quark's "copy" and "like/dislike" action buttons.
//   • Added image selectors for Quark's image generation responses.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseQuark() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Strategy 1: data-role (most reliable)
  document.querySelectorAll('[data-role="user"],[data-role="human"]').forEach(n => pairs.push({ node: n, role: 'u' }));
  document.querySelectorAll('[data-role="ai"],[data-role="assistant"],[data-role="bot"]').forEach(n => pairs.push({ node: n, role: 'a' }));

  // Strategy 2: Quark-specific class conventions
  if (!pairs.length) {
    document.querySelectorAll(
      '[class*="chat-user-query"],[class*="chat-user-msg"],[class*="user-query-wrap"]'
    ).forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll(
      '[class*="chat-ai-answer"],[class*="chat-ai-msg"],[class*="ai-answer-wrap"],[class*="ai-reply"]'
    ).forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 3: broader class keyword scan
  if (!pairs.length) {
    document.querySelectorAll(
      '[class*="userMsg"],[class*="user-msg"],[class*="UserMsg"],.chat-user,.user-bubble,' +
      '[class*="user_bubble"],[class*="user_message"]'
    ).forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll(
      '[class*="aiMsg"],[class*="ai-msg"],[class*="AiMsg"],[class*="assistantMsg"],' +
      '.chat-ai,.ai-bubble,[class*="ai_message"],[class*="answer_content"]'
    ).forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 4: structural scan from chat list
  if (!pairs.length) {
    const root = document.querySelector(
      '[class*="chatList"],[class*="chat-list"],[class*="MessageList"],[class*="conversation"]'
    ) || document.querySelector('main') || document.body;
    root.querySelectorAll('[class*="message-item"],[class*="MessageItem"],[class*="chat-item"],[class*="chat_item"]').forEach(n => {
      if (!n.innerText?.trim()) return;
      const cls = (n.className || '').toLowerCase();
      pairs.push({ node: n, role: (cls.includes('user') || cls.includes('right') || cls.includes('human')) ? 'u' : 'a' });
    });
  }

  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const filtered = [];
  pairs.forEach(p => { if (!filtered.some(q => q.node.contains(p.node) || p.node.contains(q.node))) filtered.push(p); });

  filtered.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: ['[class*="attachment"]','[class*="fileChip"]','[class*="upload"]','[class*="imagePreview"]'],
      imgSels: ['img[src*="blob:"]','img[class*="generated"]'],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      'button','svg',
      '[class*="action"]','[class*="toolbar"]',
      '[class*="copy-btn"]','[class*="like-btn"]','[class*="feedback"]',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('quark', msgs, ts, cm, am);
}
