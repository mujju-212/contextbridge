// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/lmarena.js — lmarena.ai / arena.ai / chat.lmsys.org  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// Supports LMSYS Chatbot Arena / LM Arena:
//   • Battle Mode: Side-by-side Model A and Model B responses captured with
//     model identities (anonymous "Model A/B" or revealed model names).
//   • Direct Chat: Single-model conversations.
//   • Thinking / Reasoning blocks (e.g. DeepSeek-R1, o1, o3-mini reasoning).
//   • Code blocks with language normalization and separate cId registration.
//   • Image & multimodal attachment extraction.
//   • Gradio UI fallback for chat.lmsys.org.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function parseLMArena() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Root conversation container
  const root = document.querySelector(
    '#chat-area, [class*="chat-area"], [class*="ChatArea"], main, [role="main"]'
  ) || document.body;

  // ── Helper: detect model label from an assistant column/node ───────────────
  function detectModelLabel(el, fallback) {
    if (!el) return fallback || 'Assistant';
    // 1. Look for explicit header / badge elements
    const headerEl = el.querySelector(
      '.sticky.top-0 span.truncate, .sticky.top-0 span, [class*="sticky"] span.truncate, span.truncate,' +
      '[class*="sticky"] [class*="font-semibold"], [class*="model-name"], [class*="modelName"],' +
      '[data-testid*="model"], header [class*="truncate"], header [class*="font-medium"],' +
      'button [class*="truncate"]'
    );
    if (headerEl) {
      const txt = headerEl.textContent.trim();
      if (txt && txt.length < 50 && !/^(copy|share|retry|edit|vote|thought)/i.test(txt)) {
        return txt;
      }
    }
    // 2. Check first 200 chars of container for Model A or Model B
    const startText = (el.innerText || '').slice(0, 200);
    if (/\bModel A\b/i.test(startText)) return 'Model A';
    if (/\bModel B\b/i.test(startText)) return 'Model B';

    // 3. Check if parent or container contains "Model A" or "Model B" indicators
    const containerText = el.closest('[data-model], [class*="col-"], [class*="grid"] > div')?.textContent || '';
    if (/\bModel A\b/i.test(containerText)) return 'Model A';
    if (/\bModel B\b/i.test(containerText)) return 'Model B';

    return fallback || 'Assistant';
  }

  // ── Helper: extract optional thinking / reasoning section ─────────────────
  function extractReasoning(node) {
    const thoughts = [];
    // 1. Radix collapsible controlled by "Thought for" button (LMArena Next.js UI)
    const thoughtBtn = Array.from(node.querySelectorAll('button')).find(b =>
      (b.textContent || '').includes('Thought for')
    );
    if (thoughtBtn) {
      const targetId = thoughtBtn.getAttribute('aria-controls');
      if (targetId) {
        const contentDiv = document.getElementById(targetId);
        if (contentDiv) {
          const t = contentDiv.innerText?.trim();
          if (t && t.length > 5) thoughts.push(t);
        }
      }
    }
    // 2. Class-based reasoning containers
    const reasoningNodes = node.querySelectorAll(
      '[class*="thinking"], [class*="reasoning"], [class*="thought"],' +
      'details[class*="think"], [data-state*="think"]'
    );
    reasoningNodes.forEach(r => {
      const t = r.innerText?.trim();
      if (t && t.length > 10 && !thoughts.some(item => item.includes(t) || t.includes(item))) {
        thoughts.push(t);
      }
    });
    return thoughts.length > 0 ? thoughts.join('\n\n') : '';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY 1: Modern LM Arena (Next.js / Radix / Tailwind on lmarena.ai)
  // ───────────────────────────────────────────────────────────────────────────
  // Turn containers or direct message bubbles:
  // User messages typically have bg-surface-raised, [data-role="user"], or are right-aligned.
  // Assistant messages typically have bg-surface-primary or contain .prose inside battle columns.

  const userNodes = Array.from(root.querySelectorAll(
    '[data-role="user"], [data-testid*="user"],' +
    'div[class*="bg-surface-raised"], div[class*="bg-muted"],' +
    '[class*="UserMessage"], [class*="user-message"]'
  )).filter(n => {
    // Exclude button dropdowns or settings dialogs
    return !n.closest('header') && !n.closest('nav') && (n.innerText?.trim().length > 0);
  });

  // Check for Battle Mode side-by-side layout:
  // In battle mode, each assistant turn contains a row/grid with two columns (Model A, Model B).
  const battleRows = Array.from(root.querySelectorAll(
    '[class*="grid-cols-2"], [class*="grid-cols-[repeat(2"],' +
    '[class*="flex"][class*="divide-x"], [data-testid="battle-row"],' +
    '[class*="battle-container"], [class*="battle_container"]'
  ));

  if (userNodes.length > 0 || battleRows.length > 0) {
    userNodes.forEach(n => pairs.push({ node: n, role: 'u', type: 'user' }));

    if (battleRows.length > 0) {
      battleRows.forEach(row => {
        // Direct child columns of the battle row
        const cols = Array.from(row.children).filter(c => c.querySelector('.prose, [class*="prose"], [class*="markdown"]') || c.innerText?.trim().length > 15);
        if (cols.length >= 2) {
          pairs.push({
            node: row,
            role: 'a',
            type: 'battle',
            colA: cols[0],
            colB: cols[1],
          });
        } else {
          // Fallback single column
          cols.forEach((col, idx) => {
            pairs.push({ node: col, role: 'a', type: 'single', defaultLabel: idx === 0 ? 'Model A' : 'Model B' });
          });
        }
      });
    } else {
      // Direct chat mode: find individual assistant response nodes
      const aiNodes = Array.from(root.querySelectorAll(
        '[data-role="assistant"], [data-testid*="assistant"], [data-testid*="bot"],' +
        'div[class*="bg-surface-primary"], .prose, [class*="prose-invert"]'
      )).filter(n => {
        if (n.closest('header, nav, footer, button')) return false;
        if (userNodes.some(u => u.contains(n))) return false;
        // If it's a raw .prose, prefer its outer container if available
        return n.innerText?.trim().length > 10;
      });

      // Deduplicate nested AI nodes
      const dedupedAi = [];
      aiNodes.forEach(n => {
        if (!dedupedAi.some(q => q.contains(n) || n.contains(q))) dedupedAi.push(n);
      });
      dedupedAi.forEach(n => pairs.push({ node: n, role: 'a', type: 'single' }));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY 2: Gradio UI on chat.lmsys.org
  // ───────────────────────────────────────────────────────────────────────────
  if (!pairs.length) {
    const gradioUser = root.querySelectorAll(
      '.message.user, [data-testid="user"], [class*="user-message"], .user-message'
    );
    const gradioBot = root.querySelectorAll(
      '.message.bot, [data-testid="bot"], [class*="bot-message"], .bot-message'
    );
    if (gradioUser.length + gradioBot.length > 0) {
      gradioUser.forEach(n => pairs.push({ node: n, role: 'u', type: 'user' }));
      gradioBot.forEach(n  => pairs.push({ node: n, role: 'a', type: 'single' }));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY 3: Structural fallback (prose blocks & user text blocks)
  // ───────────────────────────────────────────────────────────────────────────
  if (!pairs.length) {
    const allProse = Array.from(root.querySelectorAll('.prose, [class*="prose"], [class*="markdown"]'))
      .filter(n => !n.closest('pre') && n.innerText?.trim().length > 10);

    allProse.forEach(p => {
      // Look for preceding sibling or parent's preceding sibling as user query
      let prev = p.parentElement?.previousElementSibling;
      if (prev && prev.innerText?.trim()) {
        if (!pairs.some(x => x.node === prev)) {
          pairs.push({ node: prev, role: 'u', type: 'user' });
        }
      }
      pairs.push({ node: p, role: 'a', type: 'single' });
    });
  }

  // ── Visual / chronological comparator ────────────────────────────────────
  // On chat platforms (especially LM Arena which uses flex-col-reverse or prepends
  // new messages), DOM tree order is INVERTED: the newest turn is at the top of
  // the DOM tree, while Turn 1 is at the bottom of the DOM tree.
  // Comparing visual position (top-to-bottom, left-to-right) ensures strictly
  // chronological ordering (Turn 1 first, Turn N last) across all layout methods.
  function getNodeVisualPos(node) {
    if (!node) return { top: 0, left: 0, hasLayout: false };
    try {
      const rect = node.getBoundingClientRect();
      if (rect.height > 0 || rect.width > 0) {
        return { top: rect.top, left: rect.left, hasLayout: true };
      }
    } catch (e) {}

    // Fallback: calculate offsetTop through offsetParents
    let top = 0, left = 0, hasOffset = false;
    let curr = node;
    while (curr && curr !== document.body) {
      if (curr.offsetTop !== undefined || curr.offsetLeft !== undefined) {
        hasOffset = true;
        top += curr.offsetTop || 0;
        left += curr.offsetLeft || 0;
      }
      curr = curr.offsetParent;
    }
    return { top, left, hasLayout: hasOffset };
  }

  function compareChatOrder(a, b) {
    const posA = getNodeVisualPos(a.node);
    const posB = getNodeVisualPos(b.node);

    // If both nodes have layout coordinates, sort top-to-bottom visually
    if (posA.hasLayout && posB.hasLayout) {
      const diffY = posA.top - posB.top;
      // Meaningful vertical difference (> 12px): earlier message is higher on page
      if (Math.abs(diffY) > 12) {
        return diffY;
      }
      // Same vertical row (e.g. Model A & Model B side by side in Battle Mode):
      // Sort left-to-right
      const diffX = posA.left - posB.left;
      if (Math.abs(diffX) > 12) {
        return diffX;
      }
    }

    // Fallback if layout coordinates are unavailable:
    // In LM Arena (lmarena.ai / arena.ai), DOM order is inverted (newest first).
    // So reverse of compareDocumentPosition gives chronological order.
    const isLMArenaDomain = /lmarena\.ai|arena\.ai/i.test(location.hostname);
    if (isLMArenaDomain) {
      // Inverted DOM: preceding in DOM means LATER in chat
      return a.node.compareDocumentPosition(b.node) & 4 ? 1 : -1;
    }

    // Standard DOM order (chat.lmsys.org Gradio)
    return a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1;
  }

  // Sort pairs strictly in chronological order (Turn 1 -> Turn N)
  pairs.sort(compareChatOrder);

  // Deduplicate overlapping nodes while preserving chronological order
  const filtered = [];
  pairs.forEach(p => {
    if (!filtered.some(q => q.node === p.node || (q.type !== 'battle' && (q.node.contains(p.node) || p.node.contains(q.node))))) {
      filtered.push(p);
    }
  });

  // Strip selectors for clean text extraction
  const stripSelectors = [
    'button', 'svg', '[aria-hidden="true"]', '.sr-only',
    '[class*="tooltip"]', '[role="tooltip"]',
    '[class*="vote"]', '[class*="rating"]', '[class*="feedback"]',
    '[class*="action-bar"]', '[class*="actions"]',
    '[class*="thinking-toggle"]', '[class*="thought-toggle"]',
    'details > summary',
  ];

  let firstUserQuery = '';

  filtered.forEach(item => {
    const { role, type } = item;

    // USER TURN
    if (role === 'u') {
      const node = item.node;
      const tId = 't' + ti++;
      ts[tId] = new Date().toISOString();
      const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
      const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
        chipSels: ['[class*="attachment"]', '[class*="fileChip"]', '[class*="upload"]', '[class*="badge"]'],
        imgSels:  ['img[src*="blob:"]', 'img[src*="lmarena"]', 'img[src*="arena"]', 'img[src^="http"]:not([src*="avatar"]):not([src*="logo"])'],
      }); fi = nf;

      const txt = cleanMessageText(stripAndGetText(node, stripSelectors));
      if (!firstUserQuery && txt) firstUserQuery = txt;

      const c = buildContent(txt, codeRefs, attRefs);
      if (c !== null) msgs.push(['u', tId, c]);
      return;
    }

    // ASSISTANT TURN: BATTLE MODE (Model A and Model B)
    if (type === 'battle' && item.colA && item.colB) {
      const labelA = detectModelLabel(item.colA, 'Model A');
      const labelB = detectModelLabel(item.colB, 'Model B');

      // Model A
      const tIdA = 't' + ti++;
      ts[tIdA] = new Date().toISOString();
      const { codeRefs: codeA, cIdx: ncA } = extractCode(item.colA, cm, ci); ci = ncA;
      const { refs: attA, fIdx: nfA } = extractAttachments(item.colA, am, fi, tIdA, {
        chipSels: ['[class*="attachment"]', '[class*="fileChip"]', '[class*="upload"]'],
        imgSels:  ['img[src*="blob:"]', 'img[src*="lmarena"]', 'img[src*="arena"]'],
      }); fi = nfA;

      const reasoningA = extractReasoning(item.colA);
      let textA = cleanMessageText(stripAndGetText(item.colA, stripSelectors));
      if (reasoningA && !textA.includes(reasoningA.slice(0, 40))) {
        textA = `> 💭 **Thinking (${labelA}):**\n> ${reasoningA.replace(/\n/g, '\n> ')}\n\n` + textA;
      }
      const fullTextA = `### 🤖 ${labelA}\n\n` + textA;
      const contentA = buildContent(fullTextA, codeA, attA);
      if (contentA !== null) msgs.push(['a', tIdA, contentA]);

      // Model B
      const tIdB = 't' + ti++;
      ts[tIdB] = new Date().toISOString();
      const { codeRefs: codeB, cIdx: ncB } = extractCode(item.colB, cm, ci); ci = ncB;
      const { refs: attB, fIdx: nfB } = extractAttachments(item.colB, am, fi, tIdB, {
        chipSels: ['[class*="attachment"]', '[class*="fileChip"]', '[class*="upload"]'],
        imgSels:  ['img[src*="blob:"]', 'img[src*="lmarena"]', 'img[src*="arena"]'],
      }); fi = nfB;

      const reasoningB = extractReasoning(item.colB);
      let textB = cleanMessageText(stripAndGetText(item.colB, stripSelectors));
      if (reasoningB && !textB.includes(reasoningB.slice(0, 40))) {
        textB = `> 💭 **Thinking (${labelB}):**\n> ${reasoningB.replace(/\n/g, '\n> ')}\n\n` + textB;
      }
      const fullTextB = `### 🤖 ${labelB}\n\n` + textB;
      const contentB = buildContent(fullTextB, codeB, attB);
      if (contentB !== null) msgs.push(['a', tIdB, contentB]);
      return;
    }

    // ASSISTANT TURN: SINGLE MODEL / DIRECT CHAT
    const node = item.node;
    const tId = 't' + ti++;
    ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: ['[class*="attachment"]', '[class*="fileChip"]', '[class*="upload"]'],
      imgSels:  ['img[src*="blob:"]', 'img[src*="lmarena"]', 'img[src*="arena"]', 'img[src^="http"]:not([src*="avatar"]):not([src*="logo"])'],
    }); fi = nf;

    const label = detectModelLabel(node, item.defaultLabel || '');
    const reasoning = extractReasoning(node);
    let txt = cleanMessageText(stripAndGetText(node, stripSelectors));
    if (reasoning && !txt.includes(reasoning.slice(0, 40))) {
      txt = `> 💭 **Thinking:**\n> ${reasoning.replace(/\n/g, '\n> ')}\n\n` + txt;
    }
    if (label && label !== 'Assistant') {
      txt = `### 🤖 ${label}\n\n` + txt;
    }

    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push(['a', tId, c]);
  });

  const ccmf = assembleCCMF('lmarena', msgs, ts, cm, am);

  // Smart chatTitle from the first user question
  if (firstUserQuery) {
    const cleanTitle = firstUserQuery
      .split('\n')[0]
      .replace(/[#*`]/g, '')
      .trim()
      .slice(0, 60);
    if (cleanTitle) ccmf.chatTitle = cleanTitle;
  }

  return ccmf;
}
