// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/grok.js — grok.com + x.com/i/grok  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0 (March 2025):
//   • Strategy 1 [data-testid="message"] confirmed stable on grok.com 2025.
//   • Strategy 1b: [data-testid="user-message-text"] / [data-testid="response-text"]
//     for Grok 3 granular testids.
//   • Grok 3 DeepSearch: [data-testid="deep-search-content"], [class*="DeepSearch"],
//     [class*="deep_search"] — all stripped from text output.
//   • Grok 3 source cards: [class*="sourceCard"], [class*="SourceCard"] — stripped.
//   • Grok 3 Aurora image generation: [data-testid="aurora-image-result"] added
//     to imgSels for attachment capture.
//   • x.com root scoped to [aria-label*="Grok"] when available.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseGrok() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Strategy 1: data-testid="message" — outer wrapper (confirmed 2025)
  document.querySelectorAll('[data-testid="message"]').forEach(n => {
    const isUser = !!n.querySelector(
      '[data-testid="user-message-text"],[data-testid="human-message"]'
    );
    pairs.push({ node: n, role: isUser ? 'u' : 'a' });
  });

  // Strategy 1b: granular testids (Grok 3)
  if (!pairs.length) {
    document.querySelectorAll('[data-testid="user-message-text"],[data-testid="human-message"]')
      .forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll('[data-testid="response-text"],[data-testid="bot-message"],[data-testid="assistant-message"]')
      .forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 2: explicit human/bot containers
  if (!pairs.length) {
    document.querySelectorAll('[data-testid="human-message"]').forEach(n => pairs.push({ node: n, role: 'u' }));
    document.querySelectorAll('[data-testid="bot-message"],[data-testid="assistant-message"]').forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 3: message-bubble alignment heuristic (older layout)
  if (!pairs.length) {
    document.querySelectorAll('div.message-bubble, [class*="MessageBubble"]').forEach(bub => {
      const parent = bub.parentElement;
      const cls    = (parent?.className || '') + ' ' + (bub.className || '');
      // Prefer className check over getComputedStyle (faster, more reliable in shadow DOM)
      const isRight = cls.includes('justify-end') || cls.includes('self-end') ||
        cls.includes('ml-auto') || cls.includes('items-end');
      if (!isRight) {
        // Fallback to computed style only if className gives no signal
        try {
          const style = getComputedStyle(parent || bub);
          if (style.justifyContent === 'flex-end' || style.alignSelf === 'flex-end') {
            pairs.push({ node: bub, role: 'u' }); return;
          }
        } catch(e) {}
      }
      pairs.push({ node: bub, role: isRight ? 'u' : 'a' });
    });
  }

  // Strategy 4: aria-label scan
  if (!pairs.length) {
    document.querySelectorAll('[aria-label="User message"],[aria-label="Grok message"],[aria-label*="message" i]').forEach(n => {
      const lbl = (n.getAttribute('aria-label') || '').toLowerCase();
      pairs.push({ node: n, role: lbl.includes('user') ? 'u' : 'a' });
    });
  }

  // Strategy 5: main-scoped structural scan
  if (!pairs.length) {
    const scan = document.querySelector('main,[id*="last-reply"]')?.parentElement || document.querySelector('main') || document.body;
    Array.from(scan.querySelectorAll(':scope > div')).forEach(n => {
      if (!n.innerText?.trim()) return;
      const cls = (n.className || '');
      const isRight = cls.includes('justify-end') || cls.includes('ml-auto');
      pairs.push({ node: n, role: isRight ? 'u' : 'a' });
    });
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
      chipSels: ['[class*="attachment"]','[class*="fileChip"]','[class*="imagePreview"]','[class*="ImageCard"]','[class*="MediaAttachment"]','[class*="media-attachment"]'],
      imgSels:  [
        'img[src*="blob:"]',
        'img[src*="grok"]',
        'img[src*="pbs.twimg.com"]',
        'img[src*="ton.twimg.com"]',
        'img[src*="x.com/tweet_video_thumb"]',
        'img[src*="ximg"]',
        // Grok 3 Aurora generated images
        '[data-testid="aurora-image-result"] img',
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="avatar"]):not([src*="favicon"])',
      ],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      '[data-testid*="thinking"]','[data-testid*="reasoning"]',
      '[class*="thinking"]','[class*="ThinkingBlock"]','[class*="Reasoning"]',
      '[data-testid="deep-search-content"]',              // Grok 3 DeepSearch block
      '[class*="DeepSearch"]','[class*="deep_search"]',   // Grok 3 DeepSearch variants
      '[class*="sourceCard"]','[class*="SourceCard"]',    // Grok 3 web source cards
      'details',   // Grok 3 wraps thinking in <details>
      'button','svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('grok', msgs, ts, cm, am);
}
