// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/doubao.js — doubao.com (ByteDance)  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0:
//   • Doubao 2025 uses a React frontend with hashed class names.
//   • Primary stable selector confirmed: [data-testid="message-item"] with
//     a child [data-testid="message-role"] attribute value "user" or "assistant".
//   • Added [data-testid] strategy as Strategy 1.
//   • Strategy 2: class keywords updated — Doubao uses "userContent"/"botContent"
//     but also newer "send_message_wrap" / "receive_message_wrap" patterns.
//   • Strategy 3: structural scan updated for Doubao's chat container class names.
//   • Added stripping of Doubao's "thinking" / "reasoning" blocks (Doubao Pro uses R1).
//   • Added image capture for Doubao's image generation outputs.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseDoubao() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Strategy 1: data-testid message-item with role detection
  document.querySelectorAll('[data-testid="message-item"]').forEach(n => {
    const roleEl = n.querySelector('[data-testid="message-role"]');
    const role   = (roleEl?.getAttribute('data-role') || roleEl?.textContent || '').toLowerCase();
    pairs.push({ node: n, role: role.includes('user') ? 'u' : 'a' });
  });

  // Strategy 1b: direct role attributes
  if (!pairs.length) {
    document.querySelectorAll('[data-role="user"],[data-role="human"]').forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll('[data-role="assistant"],[data-role="ai"],[data-role="bot"]').forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 2: class keyword patterns (stable + Doubao-specific)
  if (!pairs.length) {
    document.querySelectorAll(
      '[class*="userContent"],[class*="user-content"],[class*="humanContent"],[class*="UserBubble"],' +
      '[class*="send_message_wrap"],[class*="user_message_wrap"],[class*="msg_from_user"]'
    ).forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll(
      '[class*="botContent"],[class*="bot-content"],[class*="assistantContent"],' +
      '[class*="modelContent"],[class*="BotBubble"],[class*="receive_message_wrap"],' +
      '[class*="bot_message_wrap"],[class*="msg_from_bot"],[class*="msg_from_model"]'
    ).forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 3: structural scan from chat message container
  if (!pairs.length) {
    document.querySelectorAll(
      '[class*="chat-message"],[class*="ChatMessage"],[class*="MessageItem"],[class*="chat_message"],' +
      '[class*="message_item"],[class*="msg_item"]'
    ).forEach(n => {
      if (!n.innerText?.trim()) return;
      const cls = (n.className || '').toLowerCase();
      const hasMarkdown = !!n.querySelector('[class*="markdown"],[class*="prose"]');
      const isUser = cls.includes('user') || cls.includes('human') || cls.includes('right') || cls.includes('send');
      pairs.push({ node: n, role: (isUser && !hasMarkdown) ? 'u' : 'a' });
    });
  }

  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const filtered = [];
  pairs.forEach(p => { if (!filtered.some(q => q.node.contains(p.node) || p.node.contains(q.node))) filtered.push(p); });

  filtered.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: ['[class*="attachment"]','[class*="fileChip"]','[class*="upload"]','[class*="imagePreview"]','[class*="fileCard"]'],
      imgSels:  ['img[src*="blob:"]','img[class*="generated_image"]','img[class*="image_gen"]'],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      'button','svg',
      '[class*="action"]','[class*="toolbar"]','[class*="feedback"]',
      '[class*="thinking"]','[class*="reasoning"]','[class*="think_block"]',
      '[class*="thinkingContent"]','[class*="reasoningBox"]',  // Doubao Pro R1 variants
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('doubao', msgs, ts, cm, am);
}
