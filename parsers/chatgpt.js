// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/chatgpt.js — chatgpt.com  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// DOM AUDIT v2.0 (March 2025):
//   • Strategy 1 rewritten: use article[data-testid^="conversation-turn-"] as
//     the outer turn wrapper, then find [data-message-author-role] inside.
//     Direct querySelectorAll on [data-message-author-role] was picking up
//     edit-mode duplicate nodes and voice-mode sub-divs.
//   • Strategy 1b: [data-message-author-role] direct query kept as fallback
//     (handles builds where article wrapper is absent).
//   • File/image attachment selectors updated for 2025 ChatGPT:
//       [data-testid="file-attachment-icon"]
//       [data-testid="image-attachment-overlay"]
//       [data-testid="image-tile"]
//   • Strip response-footnotes (web search citations injected at bottom of reply).
//   • Strip [data-testid="reasoning-recap"] (GPT-5/o4 reasoning summary).
//   • Strip [data-testid="canvas-panel"] (side canvas artifacts).
//   • Voice mode turn markers ([class*="voiceMode"]) stripped from text.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseChatGPT() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;

  // Scope to main conversation — avoids sidebar/canvas/GPT-store content
  const root = document.querySelector('main') || document.body;

  let pairs = [];

  // Strategy 1: article[data-testid^="conversation-turn-"] outer wrapper (2025 stable)
  // Each turn is an <article data-testid="conversation-turn-N"> containing one
  // [data-message-author-role] div. Using the article avoids edit-mode dupe nodes.
  const articles = Array.from(root.querySelectorAll('article[data-testid^="conversation-turn-"]'));
  if (articles.length > 0) {
    articles.forEach(article => {
      const roleEl = article.querySelector('[data-message-author-role]');
      const roleAttr = roleEl
        ? roleEl.getAttribute('data-message-author-role')
        : (article.getAttribute('data-testid') || '').includes('human') ? 'user' : 'assistant';
      pairs.push({ node: article, role: roleAttr === 'assistant' ? 'a' : 'u' });
    });
  }

  // Strategy 1b: direct [data-message-author-role] query (fallback for alternate builds)
  if (!pairs.length) {
    const nodes = Array.from(root.querySelectorAll('[data-message-author-role]'));
    // Deduplicate containment (edit mode nests role attrs)
    const deduped = [];
    nodes.forEach(n => { if (!deduped.some(q => q.contains(n))) deduped.push(n); });
    deduped.forEach(node => {
      const roleAttr = node.getAttribute('data-message-author-role');
      pairs.push({ node, role: roleAttr === 'assistant' ? 'a' : 'u' });
    });
  }

  // Strategy 2: article turn wrappers without inner role attr
  if (!pairs.length) {
    Array.from(root.querySelectorAll('article[data-testid^="conversation-turn"]'))
      .forEach(n => {
        const testid = n.getAttribute('data-testid') || '';
        pairs.push({ node: n, role: testid.includes('human') ? 'u' : 'a' });
      });
  }

  // Strategy 3: role listitem scan
  if (!pairs.length) {
    pairs = Array.from(root.querySelectorAll('[role="presentation"] > div[class]'))
      .filter(n => n.innerText?.trim().length > 0)
      .map(n => ({ node: n, role: 'u' })); // conservative: mark all user, better than wrong
  }

  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  // Final dedup in case strategies overlapped
  const final = [];
  pairs.forEach(p => { if (!final.some(q => q.node.contains(p.node) || p.node.contains(q.node))) final.push(p); });

  final.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: [
        '[data-testid="file-attachment-icon"]',      // 2025 file chip
        '[data-testid="image-attachment-overlay"]',  // 2025 image overlay
        '[data-testid="image-tile"]',                // generated image tile
        '[data-testid*="image-upload"]',             // legacy upload
        '[data-testid*="file-upload"]',              // legacy upload
        '[class*="fileContainer"]',
        '[class*="attachment"]',
      ],
      imgSels: [
        'img[alt][src*="oaiusercontent"]',
        'img[alt][src*="blob:"]',
        'img[src*="dalle"]',
        'img[src*="openai"]',
      ],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      '[data-testid*="image-upload"]', '[data-testid*="file-upload"]',
      '[data-testid="file-attachment-icon"]',
      '[data-testid="image-attachment-overlay"]',
      '[data-testid="thinking"]', '[class*="thinking"]',    // o1/o3/o4 thinking
      '[data-testid="reasoning-recap"]',                     // GPT-5 reasoning summary
      '[data-testid="response-footnotes"]',                  // web search footnotes
      '[data-testid="canvas-panel"]',                        // canvas side-panel
      '[class*="voiceMode"]',                                // voice mode UI
      '[class*="fileAttachment"]', '[class*="fileContainer"]',
      'button', 'svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('chatgpt', msgs, ts, cm, am);
}
