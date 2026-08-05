// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/claude.js — claude.ai  v2.0
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT v2.0 (March 2025):
//   • [data-testid="human-turn"] / [data-testid="assistant-turn"] confirmed stable.
//   • New strip targets added:
//       [data-testid="message-feedback"] — thumbs up/down rating UI
//       [class*="InteractiveArtifact"] — Claude 3.7 interactive artifact frame
//       [data-testid="citation"] / [class*="CitationBubble"] — citation markers
//   • Root scoping extended: [data-testid="chat-content"] added as candidate.
//   • Thinking block HEADER stripped (UI chrome), but body text preserved as
//     it contains reasoning context valuable to the next AI.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
function parseClaude() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;
  let pairs = [];

  // ── Root scoping (avoids Projects / knowledge-base sidebar) ──────────────
  const root = (
    document.querySelector('[data-testid="chat-content"]') ||       // Claude 3.7+
    document.querySelector('[data-testid="conversation-content"]') ||
    document.querySelector('[class*="conversationContainer"]') ||
    document.querySelector('[class*="conversation"][class*="container"]') ||
    document.querySelector('main [class*="thread"]') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('main') ||
    document.body
  );

  // ── Strategy 1a: human-turn / assistant-turn test-ids (stable 2025) ──────
  const humanTurns = root.querySelectorAll('[data-testid="human-turn"]');
  const asstTurns  = root.querySelectorAll('[data-testid="assistant-turn"]');
  if (humanTurns.length + asstTurns.length > 0) {
    humanTurns.forEach(n => pairs.push({ node: n, role: 'u' }));
    asstTurns.forEach(n  => pairs.push({ node: n, role: 'a' }));
  }

  // ── Strategy 1b: user-message test-id (newer Claude builds) ──────────────
  if (!pairs.length) {
    root.querySelectorAll('[data-testid="user-message"]').forEach(n =>
      pairs.push({ node: n, role: 'u' })
    );
    root.querySelectorAll(
      '[class*="font-claude-response"],[class*="claude-response"],[class*="AssistantMessage"],[class*="assistantMessage"]'
    ).forEach(n => pairs.push({ node: n, role: 'a' }));
  }

  // ── Strategy 1c: data-message-author-role attribute (A/B builds) ─────────
  if (!pairs.length) {
    root.querySelectorAll('[data-message-author-role]').forEach(n => {
      const r = n.getAttribute('data-message-author-role');
      if (r === 'user') pairs.push({ node: n, role: 'u' });
      else if (r === 'assistant') pairs.push({ node: n, role: 'a' });
    });
  }

  // ── Strategy 2: prose/markdown container heuristic ───────────────────────
  if (!pairs.length) {
    root.querySelectorAll('[class*="ConversationItem"],[class*="conversation-item"],[class*="MessageGroup"]').forEach(n => {
      const hasProse = !!n.querySelector('.prose,[class*="prose"],[class*="markdown"]');
      pairs.push({ node: n, role: hasProse ? 'a' : 'u' });
    });
  }

  // ── Strategy 3: structural scan of thread container ───────────────────────
  if (!pairs.length) {
    const thread = root.querySelector(
      '[class*="ThreadContainer"],[class*="thread"],[class*="messages"],[class*="Messages"]'
    );
    if (thread) {
      Array.from(thread.children).forEach(n => {
        if (!n.innerText?.trim()) return;
        const hasProse = !!n.querySelector('.prose,[class*="prose"],[class*="markdown"]');
        pairs.push({ node: n, role: hasProse ? 'a' : 'u' });
      });
    }
  }

  // ── De-duplicate nested nodes and sort by DOM order ───────────────────────
  pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
  const filtered = [];
  pairs.forEach(p => {
    if (!filtered.some(q => q.node.contains(p.node) || p.node.contains(q.node)))
      filtered.push(p);
  });

  // ── Extract messages ───────────────────────────────────────────────────────
  filtered.forEach(({ node, role }) => {
    const tId = 't' + ti++; ts[tId] = new Date().toISOString();
    const { codeRefs, cIdx: nc } = extractCode(node, cm, ci); ci = nc;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId, {
      chipSels: [
        '[data-testid="file-thumbnail"]',
        '[data-testid*="file-preview"]',
        '[data-testid*="pdf"]',
        '[class*="filePreview"]',
        '[class*="file-preview-chip"]',
        '[class*="attachment-chip"]',
        '[class*="attachmentChip"]',
        '[class*="imagePreview"]',
        '[class*="image-preview"]',
        '[class*="FileAttachment"]',
        '[class*="PdfPreview"]',
        '[class*="pdf-preview"]',
        '[class*="DocumentChip"]',
        '[class*="document-chip"]',
      ],
      imgSels: [
        'img[src*="blob:"]',
        'img[src*="anthropic"]',
        'img[src*="upload"]',
        'img[src*="files.claude"]',
        'img[src*="amazonaws"]',
        // Inline rendered images in assistant responses
        'img[src^="https"]:not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
      ],
    }); fi = nf;

    const txt = cleanMessageText(stripAndGetText(node, [
      // Action bars & UI chrome
      '[data-testid="action-bar"]',
      '[data-testid="action-bar-copy"]',
      '[data-testid="copy-code-button"]',
      '[data-testid="message-actions"]',
      '[data-testid="message-feedback"]',           // thumbs up/down rating UI
      // File/image previews
      '[data-testid="file-thumbnail"]',
      '[class*="filePreview"]',
      '[class*="attachmentChip"]',
      '[class*="image-preview"]',
      '[class*="FileAttachment"]',
      // Edit / regenerate controls
      '[class*="regenerate"]',
      '[data-testid*="edit"]',
      '[class*="EditButton"]',
      // Thinking / reasoning blocks (strip the UI chrome frame only, keep body text)
      '[data-testid="thinking-block-header"]',
      '[class*="ThinkingBlock"] > [class*="header"]',
      // Artifact chrome (strip frame, not content)
      '[data-testid="artifact-header"]',
      '[class*="ArtifactHeader"]',
      '[class*="InteractiveArtifact"] > [class*="header"]',  // Claude 3.7 interactive frame
      // Citations
      '[data-testid="citation"]','[class*="CitationBubble"]',
      // Generic noise
      'time', '.message-timestamp', 'button', 'svg',
    ]));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c !== null) msgs.push([role, tId, c]);
  });

  return assembleCCMF('claude', msgs, ts, cm, am);
}
