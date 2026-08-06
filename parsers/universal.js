// Extension By - Manas Tiwari & Aditya Mittal
// parsers/universal.js — v1.0
// Smart universal fallback parser for ANY AI chat site.
// Uses layered heuristics to find user/assistant message pairs.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function parseUniversal() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;

  const host = location.hostname.replace(/^www\./, '');
  const root = document.querySelector('main')
    || document.querySelector('[role="main"]')
    || document.querySelector('#__next')
    || document.querySelector('#app')
    || document.querySelector('#root')
    || document.body;

  // ── Strategy 1: explicit role attributes ──────────────────────────────────
  // Many AI sites (Mistral, You.com, Poe, Kimi, etc.) use data-role or
  // aria-label to mark messages.
  const ROLE_SELECTORS = [
    '[data-message-author-role]',
    '[data-role]',
    '[data-sender]',
    '[data-author]',
    '[data-testid*="human-turn"]',
    '[data-testid*="assistant-turn"]',
    '[data-testid*="user-message"]',
    '[data-testid*="bot-message"]',
    '[data-testid*="ai-message"]',
    '[data-testid*="model-response"]',
    '[class*="humanMessage"]',
    '[class*="human-message"]',
    '[class*="userMessage"]',
    '[class*="user-message"]',
    '[class*="UserMessage"]',
    '[class*="assistantMessage"]',
    '[class*="assistant-message"]',
    '[class*="AssistantMessage"]',
    '[class*="aiMessage"]',
    '[class*="ai-message"]',
    '[class*="AiMessage"]',
    '[class*="botMessage"]',
    '[class*="bot-message"]',
    '[class*="BotMessage"]',
    '[class*="modelMessage"]',
    '[class*="model-message"]',
  ];

  function inferRole(el) {
    const ra = (el.getAttribute('data-message-author-role') || '').toLowerCase();
    if (ra) return ra === 'assistant' || ra === 'ai' || ra === 'bot' || ra === 'model' ? 'a' : 'u';

    const dr = (el.getAttribute('data-role') || el.getAttribute('data-sender') || el.getAttribute('data-author') || '').toLowerCase();
    if (dr) return dr === 'assistant' || dr === 'ai' || dr === 'bot' || dr === 'model' ? 'a' : 'u';

    const ti_ = (el.getAttribute('data-testid') || '').toLowerCase();
    if (ti_.includes('human') || ti_.includes('user')) return 'u';
    if (ti_.includes('assistant') || ti_.includes('bot') || ti_.includes('ai') || ti_.includes('model')) return 'a';

    const cls = el.className || '';
    if (/human|user/i.test(cls)) return 'u';
    if (/assistant|bot|ai|model/i.test(cls)) return 'a';

    return null;
  }

  let nodes = [];
  for (const sel of ROLE_SELECTORS) {
    const found = Array.from(root.querySelectorAll(sel));
    if (found.length >= 2) { // need at least 2 messages to be meaningful
      nodes = found;
      break;
    }
  }

  // Deduplicate nested matches (keep outermost)
  if (nodes.length) {
    const deduped = [];
    nodes.forEach(n => {
      if (!deduped.some(q => q.contains(n))) deduped.push(n);
    });
    nodes = deduped;
  }

  // ── Strategy 2: structural alternation heuristic ──────────────────────────
  // If strategy 1 found nothing, look for a repeating container pattern where
  // adjacent siblings alternate in visual alignment (left/right) or class.
  if (!nodes.length) {
    nodes = _structuralStrategy(root);
  }

  // ── Strategy 3: big text block extraction ─────────────────────────────────
  // Last resort: grab all large text blocks and assign roles by visual position.
  if (!nodes.length) {
    nodes = _textBlockStrategy(root);
  }

  if (!nodes.length) return null; // nothing found — can't export

  // Ensure chronological order (top-to-bottom) in case of flex-col-reverse
  try {
    if (nodes.length >= 2) {
      const rect0 = nodes[0].getBoundingClientRect();
      const rectLast = nodes[nodes.length - 1].getBoundingClientRect();
      if ((rect0.height || rect0.width) && (rectLast.height || rectLast.width)) {
        if (rect0.top > rectLast.top + 20) {
          nodes.reverse();
        }
      }
    }
  } catch (e) {}

  // ── Build messages ─────────────────────────────────────────────────────────
  let lastRole = null;
  nodes.forEach((node, idx) => {
    let role = inferRole(node);

    // If role unknown, alternate starting with 'u'
    if (!role) {
      role = (idx % 2 === 0) ? 'u' : 'a';
    }

    // Merge consecutive same-role blocks (some sites split assistant into chunks)
    if (role === lastRole && msgs.length > 0) {
      const prev = msgs[msgs.length - 1];
      const extra = _nodeText(node);
      if (extra) prev[2] = (prev[2] ? prev[2] + '\n\n' : '') + extra;
      return;
    }
    lastRole = role;

    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;

    const txt = cleanMessageText(_nodeText(node));
    const c = buildContent(txt, codeRefs, []);
    if (c !== null) msgs.push([role, tId, c]);
  });

  if (!msgs.length) return null;
  return assembleCCMF(host, msgs, ts, cm, am);
}

// ── Structural strategy: find repeating sibling pattern ──────────────────────
function _structuralStrategy(root) {
  // Look for a list/container of chat turn siblings with at least 4 items
  const candidates = Array.from(root.querySelectorAll(
    'ul > li, ol > li, [role="list"] > *, [class*="conversation"] > *, [class*="chat"] > *, [class*="messages"] > *, [class*="thread"] > *'
  )).filter(el => {
    const t = (el.innerText || el.textContent || '').trim();
    return t.length > 20; // skip tiny/empty elements
  });

  if (candidates.length >= 2) return candidates;

  // Try direct children of a scrollable container
  const scrollable = Array.from(root.querySelectorAll('*')).find(el => {
    const s = getComputedStyle(el);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.children.length >= 4;
  });
  if (scrollable) {
    const kids = Array.from(scrollable.children).filter(el => {
      const t = (el.innerText || el.textContent || '').trim();
      return t.length > 20;
    });
    if (kids.length >= 2) return kids;
  }

  return [];
}

// ── Text block strategy: grab biggest text nodes ───────────────────────────
function _textBlockStrategy(root) {
  const blocks = Array.from(root.querySelectorAll('p, div, section, article'))
    .filter(el => {
      if (el.children.length > 15) return false; // too complex, likely layout
      const t = (el.innerText || el.textContent || '').trim();
      return t.length > 80 && t.length < 20000;
    })
    .sort((a, b) => {
      // Prefer elements with more text
      return (b.innerText || '').length - (a.innerText || '').length;
    })
    .slice(0, 30);

  // Deduplicate containment
  const deduped = [];
  blocks.forEach(n => {
    if (!deduped.some(q => q.contains(n) || n.contains(q))) deduped.push(n);
  });

  return deduped;
}

// ── Get clean text from a node ────────────────────────────────────────────────
function _nodeText(node) {
  // Clone and strip buttons, icons, timestamps
  const clone = node.cloneNode(true);
  clone.querySelectorAll('button, svg, time, [aria-hidden="true"], [class*="action"], [class*="Action"], [class*="toolbar"], [class*="Toolbar"], [class*="copy"], [class*="Copy"]').forEach(el => el.remove());
  return (clone.innerText || clone.textContent || '').trim();
}
