// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/deepseek.js — chat.deepseek.com  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0 (March 2025):
//   • DeepSeek V3-0324 (March 2025 redesign): [data-testid="message-bubble"] still
//     primary when present. ds-markdown remains the reliable AI signal.
//   • Extended thinking/R1 class variants: r1_thinking, _reasoning_, thinking_text,
//     _think_content — all stripped.
//   • Extended web search strip selectors: search_result_wrap, _search_results.
//   • Added [class*="suggest_"] strip — removes "Did you mean?" / suggestion chips.
//   • User message class keywords broadened for V3 redesign builds.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseDeepSeek() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Strategy 1: data-testid message bubbles (newest DeepSeek builds)
  document.querySelectorAll('[data-testid="message-bubble"]').forEach(n => {
    const isUser = !!n.closest('[data-testid*="user"],[data-testid*="human"]') ||
      (n.parentElement && (n.parentElement.className || '').toLowerCase().includes('user'));
    pairs.push({ node: n, role: isUser ? 'u' : 'a' });
  });

  // Strategy 1b: explicit testid role attributes
  if (!pairs.length) {
    document.querySelectorAll('[data-testid*="message"],[data-testid*="turn"]').forEach(n => {
      const testid = n.getAttribute('data-testid') || '';
      if (testid.includes('user') || testid.includes('human')) pairs.push({ node: n, role: 'u' });
      else if (testid.includes('assistant') || testid.includes('bot')) pairs.push({ node: n, role: 'a' });
    });
  }

  // Strategy 2: ds-markdown = AI; walk up to find container
  if (!pairs.length) {
    const aiSet = new Set();
    document.querySelectorAll('div.ds-markdown,[class*="ds-markdown"]').forEach(el => {
      let node = el;
      for (let i = 0; i < 5; i++) {
        if (!node.parentElement) break;
        const parent = node.parentElement;
        if (parent.children.length >= 2 && parent !== document.body) { node = parent; break; }
        node = parent;
      }
      if (!aiSet.has(node)) { aiSet.add(node); pairs.push({ node, role: 'a' }); }
    });

    // User messages by stable class keywords
    document.querySelectorAll(
      '[class*="userMessage"],[class*="user-message"],[class*="UserMessage"],' +
      '[class*="humanMessage"],[class*="HumanMessage"],' +
      '[class*="userInput"],[class*="UserInput"],' +
      '[class*="userBubble"],[class*="UserBubble"],' +
      '[class*="user_message"],[class*="human_message"]'
    ).forEach(n => {
      if (n.innerText?.trim().length > 0 && !pairs.some(p => p.node === n || p.node.contains(n) || n.contains(p.node))) {
        pairs.push({ node: n, role: 'u' });
      }
    });
  }

  // Strategy 3: data-role attribute
  if (pairs.length < 2) {
    document.querySelectorAll('[data-role]').forEach(n => {
      const r = (n.getAttribute('data-role') || '').toLowerCase();
      if ((r === 'user' || r === 'human') && !pairs.some(p => p.node === n))
        pairs.push({ node: n, role: 'u' });
      else if ((r === 'assistant' || r === 'ai') && !pairs.some(p => p.node === n))
        pairs.push({ node: n, role: 'a' });
    });
  }

  // Strategy 4: chat container children
  if (!pairs.length) {
    const list = document.querySelector(
      '[class*="chat_message"],[class*="ChatContainer"],[class*="MessageList"],[class*="messageList"]'
    );
    if (list) {
      Array.from(list.children).forEach(n => {
        if (!n.innerText?.trim()) return;
        pairs.push({ node: n, role: n.querySelector('div.ds-markdown,[class*="ds-markdown"]') ? 'a' : 'u' });
      });
    }
  }

  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const filtered = [];
  pairs.forEach(p => {
    if (!filtered.some(q => q.node.contains(p.node) || p.node.contains(q.node))) filtered.push(p);
  });

  filtered.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: ['[class*="fileChip"]','[class*="attachment"]','[class*="uploadedFile"]','[class*="imagePreview"]','[class*="ImagePreview"]','[class*="file_card"]'],
      imgSels:  [
        'img[src*="blob:"]',
        'img[src*="deepseek"]',
        'img[src*="cdn.deepseek"]',
        // DeepSeek-V3 generated images
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="avatar"]):not([src*="favicon"])',
      ],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      '[class*="thinking"]','[class*="reasoningContent"]','[class*="ThinkBlock"]',
      '[class*="r1-thinking"]','[class*="thinking_content"]','[class*="think_block"]',
      '[class*="r1_thinking"]','[class*="_reasoning_"]','[class*="thinking_text"]',  // V3-0324
      '[class*="_think_content"]',
      '[class*="searchResult"]','[class*="search_result"]',
      '[class*="search_result_wrap"]','[class*="_search_results"]',  // V3 web search
      '[class*="suggest_"]',   // "Did you mean?" suggestion chips
      'details',   // R1 thinking wrapped in <details>
      'button','svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('deepseek', msgs, ts, cm, am);
}
