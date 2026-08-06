// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/perplexity.js — perplexity.ai  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0 (March 2025):
//   • [data-testid="user-query"] confirmed stable.
//   • AI answer: broadened to [data-testid*="answer"],[data-testid="perplexity-answer"].
//   • Pro Search sources panel [data-testid="sources-panel"] stripped from text
//     (URLs still captured as source-type attachments via the a[href] loop).
//   • "Rewrite" / "Focus" toolbar elements stripped: focusSelector, rewriteBar.
//   • Pro image search results captured via [class*="imageGrid"] img selectors.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function parsePerplexity() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // Scope to main thread (avoid Spaces sidebar)
  const root = document.querySelector(
    '[class*="ThreadContainer"],[class*="thread-container"],[class*="ConversationThread"],main'
  ) || document.body;

  // Strategy 1: data-testid selectors (most stable)
  const userByTestId = root.querySelectorAll(
    '[data-testid="user-query"],[data-testid*="human"],[data-testid*="user-message"]'
  );
  const aiByTestId = root.querySelectorAll(
    '[data-testid="answer"],[data-testid*="answer"],[data-testid="perplexity-answer"],' +
    '[data-testid*="ai-response"],[data-testid*="bot-message"]'
  );
  if (userByTestId.length + aiByTestId.length > 0) {
    userByTestId.forEach(n => pairs.push({ node: n, role: 'u' }));
    aiByTestId.forEach(n   => pairs.push({ node: n, role: 'a' }));
  }

  // Strategy 2: class patterns (Perplexity Tailwind 2025)
  if (!pairs.length) {
    const userNodes = Array.from(root.querySelectorAll(
      '.whitespace-pre-wrap, .whitespace-pre-line, [class*="UserQuery"], [class*="user-query"]'
    )).filter(n => n.innerText?.trim().length > 1);

    const aiNodes = Array.from(root.querySelectorAll(
      '.prose, [class*="prose-invert"], [class*="AnswerContent"], [class*="answer-content"],' +
      '[class*="answer_content"], [class*="AnswerBody"], [class*="Answer_body"]'
    )).filter(n => !n.closest('pre') && n.innerText?.trim().length > 20);

    if (userNodes.length + aiNodes.length > 0) {
      userNodes.forEach(n => pairs.push({ node: n, role: 'u' }));
      aiNodes.forEach(n   => pairs.push({ node: n, role: 'a' }));
    }
  }

  // Strategy 3: structural thread child scan
  if (!pairs.length) {
    root.querySelectorAll(':scope > div, :scope > section > div').forEach(n => {
      if (!n.innerText?.trim()) return;
      // Skip follow-up / related questions section
      if (n.querySelector('[class*="RelatedQuestions"],[class*="related-questions"]')) return;
      const hasProse = !!n.querySelector('.prose,[class*="prose"],[class*="markdown"]');
      const hasInput = !!n.querySelector('[class*="UserQuery"],input,textarea');
      if (hasProse) pairs.push({ node: n, role: 'a' });
      else if (hasInput || (n.className || '').toLowerCase().includes('query'))
        pairs.push({ node: n, role: 'u' });
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
      chipSels: ['[class*="attachment"]','[class*="fileChip"]','[class*="upload"]','[class*="ImageAttachment"]','[class*="image_attachment"]'],
      imgSels:  [
        'img[src*="blob:"]',
        'img[src*="perplexity"]',
        'img[src*="pplx"]',
        'img[src*="media.perplexity"]',
        // Pro image search grid results
        '[class*="imageGrid"] img','[class*="image_result"] img',
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="favicon"]):not([src*="avatar"])',
      ],
    }); fi = nf;

    // Extract source citations for AI responses
    if (role === 'a') {
      const seen = new Set();
      node.querySelectorAll('a[href^="http"]').forEach(a => {
        const href = a.href;
        if (!href || seen.has(href) || href.includes('perplexity.ai')) return;
        seen.add(href);
        const fId = 'f' + fi++;
        let host = href;
        try { host = new URL(href).hostname; } catch(e) {}
        am[fId] = { mid: tId, name: a.textContent.trim() || host, type: 'source', url: href, downloadable: false };
        attRefs.push(fId);
      });
    }

    const txt = cleanMessageText(stripAndGetText(node, [
      '[data-testid="source-chip"]','[data-testid="citation"]',
      '[data-testid="sources-panel"]',                               // Pro Search source list
      '[class*="RelatedQuestions"],[class*="related-questions"]',
      '[class*="SearchStatus"],[class*="search-status"]',
      '[class*="focusSelector"],[class*="rewriteBar"]',              // toolbar chrome
      '[class*="tooltip"]', 'button', 'svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('perplexity', msgs, ts, cm, am);
}
