// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/gemini.js — gemini.google.com  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE NOTE:
//   Gemini is an Angular app that uses a mix of custom elements (Web Components)
//   and shadow DOM. The chat content lives inside shadow roots of elements like
//   <gemini-app>, <chat-window> etc. Plain document.querySelectorAll() cannot
//   pierce these shadow roots — every strategy MUST use deepShadowAll().
//
// Strategy cascade (first non-empty result wins):
//   1. ms-chat-turn[model]              — newest Gemini (2025)
//   2. user-query / model-response      — current Gemini stable
//   3. conversation-turn (role attr)    — alternate layout
//   4. [data-message-author-role]       — role-attribute fallback
//   5. class-keyword heuristic          — last resort
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function parseGemini() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // ── Deep shadow DOM traversal ─────────────────────────────────────────────
  // Walks all accessible shadow roots recursively.
  // Returns ALL elements matching `sel` anywhere in the shadow tree.
  function deepShadowAll(sel) {
    const found = [];
    const visited = new WeakSet(); // prevent re-visiting the same root
    function walk(root) {
      if (visited.has(root)) return;
      visited.add(root);
      try {
        root.querySelectorAll(sel).forEach(n => found.push(n));
      } catch(e) {}
      // Walk into any shadow roots of children
      try {
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch(e) {}
    }
    walk(document);
    return found;
  }

  // ── Strategy 1: ms-chat-turn[model] ──────────────────────────────────────
  // Newer Gemini uses <ms-chat-turn model="user"> / <ms-chat-turn model="model">
  const msChatTurns = deepShadowAll('ms-chat-turn');
  if (msChatTurns.length > 0) {
    msChatTurns.forEach(turn => {
      const model = (turn.getAttribute('model') || '').toLowerCase();
      // model="user" → user, anything else ("model","gemini","bard") → assistant
      pairs.push({ node: turn, role: model === 'user' ? 'u' : 'a' });
    });
  }

  // ── Strategy 2: user-query / model-response ───────────────────────────────
  // Current stable Gemini uses these custom element names
  if (!pairs.length) {
    const userNodes = deepShadowAll('user-query, ms-user-query');
    const aiNodes   = deepShadowAll('model-response, ms-model-response');
    if (userNodes.length + aiNodes.length > 0) {
      userNodes.forEach(n => pairs.push({ node: n, role: 'u' }));
      aiNodes.forEach(n   => pairs.push({ node: n, role: 'a' }));
    }
  }

  // ── Strategy 3: conversation-turn with role attribute ─────────────────────
  if (!pairs.length) {
    deepShadowAll('conversation-turn').forEach(turn => {
      const role = turn.getAttribute('role') || turn.getAttribute('data-turn-role') || '';
      pairs.push({ node: turn, role: /user|human/i.test(role) ? 'u' : 'a' });
    });
  }

  // ── Strategy 4: data-message-author-role ─────────────────────────────────
  if (!pairs.length) {
    deepShadowAll('[data-message-author-role]').forEach(n => {
      const r = (n.getAttribute('data-message-author-role') || '').toLowerCase();
      pairs.push({ node: n, role: r === 'user' ? 'u' : 'a' });
    });
  }

  // ── Strategy 5: class-keyword heuristic scan (deep) ──────────────────────
  if (!pairs.length) {
    // Try to find the chat history container first (deep), then scan its children
    const historyEls = deepShadowAll(
      '[class*="ChatHistory"],[class*="chat-history"],#chat-history,' +
      'conversation-container,infinite-scroller,[class*="conversation-container"]'
    );
    const scanRoot = historyEls[0] || document.body;

    // In deep shadow we can only scan with what we've already collected above
    // so just iterate the scan root's reachable DOM
    const candidates = scanRoot.querySelectorAll(
      '[class*="turn"],[class*="Turn"],query-bubble,[class*="QueryBubble"],' +
      '[class*="message"],[class*="Message"]'
    );
    candidates.forEach(t => {
      if (!t.innerText?.trim()) return;
      const hasModel = !!t.querySelector(
        '[class*="response-content"],[class*="ResponseContent"],' +
        '[class*="modelResponse"],[class*="markdown"],[class*="prose"]'
      );
      const cls = (t.className || '').toLowerCase();
      const isUser = /user|human|query/.test(cls) && !hasModel;
      pairs.push({ node: t, role: (isUser || !hasModel) && /user|human|query/.test(cls) ? 'u' : 'a' });
    });
  }

  // ── Sort + deduplicate containment ────────────────────────────────────────
  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const deduped = [];
  pairs.forEach(p => {
    if (!deduped.some(q => q.node.contains(p.node) || p.node.contains(q.node))) deduped.push(p);
  });

  deduped.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();

    // Extract code from <pre> blocks and Gemini's <code-block> custom elements
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    node.querySelectorAll('code-block').forEach(cb => {
      const inner = (cb.shadowRoot || cb).querySelector('code') || cb;
      const { lang, body } = normaliseCodeBlock(inner);
      if (body && body.length >= 15) {
        const cId = 'c' + ci++; cm[cId] = [lang, body]; codeRefs.push(cId);
      }
    });

    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: [
        '[class*="attachment"]','[class*="fileContainer"]',
        '[class*="imageCard"]','[class*="uploadedFile"]','[class*="ImageThumbnail"]',
        '[class*="ImageAttachment"]','[class*="image-attachment"]',
        '[class*="upload-preview"]','[class*="UploadPreview"]',
        'ms-file-attachment','ms-image-attachment',
      ],
      imgSels: [
        'img[src*="googleusercontent.com"]',
        'img[src*="blob:"]',
        'img[src*="lh3.google"]',
        'img[src*="storage.googleapis"]',
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="favicon"])',
      ],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      'code-block','ms-copy-button','ms-chat-turn-actions','ms-vote-buttons',
      'ms-prompt-footer',                                    // "Draft more" / "Google it" bar
      'model-thoughts','thought-chunk','[class*="thoughts"]','[class*="Thoughts"]',
      '[class*="action-button"]','[class*="thumbs"]','[class*="share"]',
      '[class*="FollowUp"]','[class*="follow-up"]',          // suggested follow-up chips
      'button','svg',
    ]));

    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('gemini', msgs, ts, cm, am);
}
