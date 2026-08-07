// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// parsers/postman.js — web.postman.co / postman.com (Postman AI Agent / Postbot) v2.0
// ─────────────────────────────────────────────────────────────────────────────
// Supports Postman Web Client AI Agent (Postbot / sideView=agentMode):
//   • Scopes to .ai-chat-conversation-list and .ai-chat-message-group
//   • Extracts user prompts from .ai-chat-user-message-container / [data-user-message-id]
//   • Extracts assistant responses from .ai-chat-agent-message
//   • Extracts Monaco editor and pre/code blocks cleanly with full line preservation
//   • Strips interactive buttons (Copy, Like, Dislike, Run, Suggestion chips)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

function convertHtmlTablesToMarkdown(node) {
  if (!node) return;
  node.querySelectorAll('table').forEach(table => {
    try {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) return;
      const mdRows = [];
      let headerColumnCount = 0;

      rows.forEach((tr, rIdx) => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(td =>
          (td.innerText || td.textContent || '').trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')
        );
        if (cells.length === 0) return;
        mdRows.push('| ' + cells.join(' | ') + ' |');
        if (rIdx === 0) {
          headerColumnCount = cells.length;
          mdRows.push('| ' + new Array(headerColumnCount).fill('---').join(' | ') + ' |');
        }
      });

      if (mdRows.length > 0) {
        const pre = document.createElement('pre');
        pre.setAttribute('data-mode-id', 'markdown');
        pre.textContent = mdRows.join('\n');
        table.replaceWith(pre);
      }
    } catch (e) {}
  });
}

function extractPostmanCode(node, codeMap, cIdx) {
  const codeRefs = [];

  // 0. Process any Visualizer iframes (Postbot generated HTML visualization assets)
  node.querySelectorAll('iframe').forEach(iframe => {
    let html = (iframe.getAttribute('srcdoc') || '').trim();
    if (!html) {
      try {
        html = (iframe.contentDocument?.documentElement?.outerHTML || '').trim();
      } catch (e) {}
    }
    if (!html || html.length < 15) return;
    const existingRef = Object.keys(codeMap).find(k => codeMap[k][1] === html);
    if (existingRef) {
      if (!codeRefs.includes(existingRef)) codeRefs.push(existingRef);
      return;
    }
    const cId = 'c' + cIdx++;
    codeMap[cId] = ['html', html];
    codeRefs.push(cId);
  });

  // 0b. Process explicit visualizer containers (Postbot generated HTML visualizer cards / HTML preview)
  node.querySelectorAll('[data-test*="visualizer"], [class*="visualizer-output"], [class*="visualizer-container"], [class*="html-preview"], [class*="rendered-html"]').forEach(viz => {
    if (viz.querySelector('pre, .monaco-editor, iframe')) return; // Handled separately
    const rawHtml = (viz.innerHTML || '').trim();
    if (rawHtml.length > 25 && /<(table|svg|div|canvas|script|style|ul|ol|h\d|section)/i.test(rawHtml)) {
      const existingRef = Object.keys(codeMap).find(k => codeMap[k][1] === rawHtml);
      if (existingRef) {
        if (!codeRefs.includes(existingRef)) codeRefs.push(existingRef);
        return;
      }
      const cId = 'c' + cIdx++;
      codeMap[cId] = ['html', rawHtml];
      codeRefs.push(cId);
    }
  });

  // 1. Process all <pre> tags (which contain Monaco or standard code in Postman)
  node.querySelectorAll('pre').forEach(pre => {
    // Check if it's a Monaco editor
    const viewLines = pre.querySelector('.view-lines');
    let body = '';
    let lang = 'text';

    if (viewLines) {
      const lines = Array.from(viewLines.querySelectorAll('.view-line'))
        .map(l => (l.textContent || '').replace(/\u00A0/g, ' '));
      body = lines.join('\n').trimEnd();
    } else {
      const codeEl = pre.querySelector('code') || pre;
      if (typeof normaliseCodeBlock === 'function') {
        const res = normaliseCodeBlock(codeEl);
        body = res.body;
        lang = res.lang;
      } else {
        body = (codeEl.innerText || codeEl.textContent || '').trim();
      }
    }

    if (!body || body.length < 5) return;
    const existingRef = Object.keys(codeMap).find(k => codeMap[k][1] === body);
    if (existingRef) {
      if (!codeRefs.includes(existingRef)) codeRefs.push(existingRef);
      return;
    }

    // Determine language if mode attribute is present or infer from keywords
    const modeEl = pre.querySelector('[data-mode-id]');
    const mode = modeEl ? modeEl.getAttribute('data-mode-id') : '';
    if (mode && mode !== 'plaintext') {
      lang = mode;
    } else if (lang === 'text' || !lang) {
      if (body.startsWith('curl ') || body.startsWith('curl\n')) lang = 'bash';
      else if (body.includes('pm.test') || body.includes('pm.expect') || body.startsWith('pm.')) lang = 'javascript';
      else if (/^\s*[{[]/.test(body)) lang = 'json';
      else if (/^\s*<!DOCTYPE\s+html/i.test(body) || /^\s*<html[\s>]/i.test(body) || (body.includes('<div') && body.includes('</div>')) || (body.includes('<table') && body.includes('</table>')) || body.includes('<style>') || body.includes('<script>') || body.includes('pm.visualizer.set')) lang = 'html';
      else if (body.includes('def ') || body.includes('import ') || body.includes('print(') || body.includes('class ')) lang = 'python';
      else if (body.includes('SELECT ') || body.includes('INSERT INTO') || body.includes('UPDATE ')) lang = 'sql';
      else if (mode) lang = mode;
    }

    const cId = 'c' + cIdx++;
    codeMap[cId] = [lang, body];
    codeRefs.push(cId);
  });

  // 2. Process any Monaco editors NOT inside <pre>
  node.querySelectorAll('.monaco-editor').forEach(editor => {
    if (editor.closest('pre')) return; // Already handled
    const viewLines = editor.querySelector('.view-lines') || editor;
    const lines = Array.from(viewLines.querySelectorAll('.view-line'))
      .map(l => (l.textContent || '').replace(/\u00A0/g, ' '));
    const body = lines.length > 0 ? lines.join('\n').trimEnd() : (editor.innerText || editor.textContent || '').trim();

    if (!body || body.length < 5) return;
    const existingRef = Object.keys(codeMap).find(k => codeMap[k][1] === body);
    if (existingRef) {
      if (!codeRefs.includes(existingRef)) codeRefs.push(existingRef);
      return;
    }

    let lang = 'text';
    const mode = editor.getAttribute('data-mode-id') || editor.closest('[data-mode-id]')?.getAttribute('data-mode-id');
    if (mode && mode !== 'plaintext') {
      lang = mode;
    } else {
      if (body.startsWith('curl ') || body.startsWith('curl\n')) lang = 'bash';
      else if (body.includes('pm.test') || body.includes('pm.expect') || body.startsWith('pm.')) lang = 'javascript';
      else if (/^\s*[{[]/.test(body)) lang = 'json';
      else if (/^\s*<!DOCTYPE\s+html/i.test(body) || /^\s*<html[\s>]/i.test(body) || (body.includes('<div') && body.includes('</div>')) || (body.includes('<table') && body.includes('</table>')) || body.includes('<style>') || body.includes('<script>') || body.includes('pm.visualizer.set')) lang = 'html';
      else if (body.includes('def ') || body.includes('import ') || body.includes('print(') || body.includes('class ')) lang = 'python';
      else if (body.includes('SELECT ') || body.includes('INSERT INTO') || body.includes('UPDATE ')) lang = 'sql';
    }

    const cId = 'c' + cIdx++;
    codeMap[cId] = [lang, body];
    codeRefs.push(cId);
  });

  return { codeRefs, cIdx };
}

// ── Helper: find the scrollable container for Postman chat ───────────────────
function findPostmanScrollContainer(chatRoot) {
  if (!chatRoot) return null;

  const isScrollable = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    // CRITICAL: NEVER treat code blocks, Monaco editors, or textareas as chat scroll container
    if (el.closest('.monaco-editor, pre, code, .view-lines, textarea')) return false;
    const style = window.getComputedStyle(el);
    const oy = style.overflowY || '';
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > (el.clientHeight + 25);
  };

  // 1. Conversation list element itself
  const convoList = chatRoot.matches?.('.ai-chat-conversation-list, [class*="conversation-list"], [data-testid*="conversation"]')
    ? chatRoot
    : chatRoot.querySelector('.ai-chat-conversation-list, [class*="conversation-list"], [data-testid*="conversation"]');
  if (convoList && isScrollable(convoList)) return convoList;

  // 2. ChatRoot itself
  if (isScrollable(chatRoot)) return chatRoot;

  // 3. Parents of chatRoot (drawers, panels, aside)
  let p = chatRoot.parentElement;
  for (let i = 0; i < 8 && p && p !== document.body; i++) {
    if (isScrollable(p)) return p;
    p = p.parentElement;
  }

  // 4. Descendants that are conversation or chat wrappers (excluding Monaco and pre)
  const descendants = chatRoot.querySelectorAll(
    '.ai-chat-conversation-list, [class*="conversation-list"], [class*="chat-list"], [class*="messages-list"], [class*="scroll"], [data-testid*="scroll"], .ai-chat-center-content'
  );
  for (const el of descendants) {
    if (isScrollable(el)) return el;
  }

  return convoList || chatRoot;
}

// ── Postman Element Selectors ────────────────────────────────────────────────
const POSTMAN_USER_SELECTORS = [
  '.ai-chat-user-message-container',
  '[data-user-message-id]',
  '.ai-chat-user-message-query',
  '[data-test*="user-message"]',
  '[data-test*="user-prompt"]',
  '[data-testid*="user-message"]',
  '[data-testid*="user-prompt"]',
  '[data-test*="prompt-item"]',
  '[class*="userMessage"]',
  '[class*="user-message"]',
  '[class*="userPrompt"]',
  '[class*="user-prompt"]',
  '[class*="UserQuery"]',
  '[class*="bubble--user"]'
].join(', ');

const POSTMAN_AGENT_SELECTORS = [
  '.ai-chat-agent-message',
  '[data-test*="agent-response"]',
  '[data-test*="agent-message"]',
  '[data-test*="postbot-response"]',
  '[data-test*="bot-response"]',
  '[data-test*="assistant-message"]',
  '[data-testid*="agent-response"]',
  '[data-testid*="assistant-message"]',
  '[class*="agentResponse"]',
  '[class*="agent-response"]',
  '[class*="postbotResponse"]',
  '[class*="postbot-response"]',
  '[class*="assistantMessage"]',
  '[class*="assistant-message"]',
  '[class*="ai-chat-agent-message"]',
  '[class*="botMessage"]',
  '[class*="bot-message"]'
].join(', ');

const POSTMAN_GROUP_SELECTORS = [
  '.ai-chat-conversation-list .ai-chat-message-group',
  '.ai-chat-center-content .ai-chat-message-group',
  '.ai-chat-message-group',
  '[data-test*="message-group"]',
  '[class*="messageGroup"]',
  '[class*="message-group"]'
].join(', ');

function queryAllPostman(root, selector) {
  const seen = new Set();
  const results = [];
  function add(node) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    results.push(node);
  }
  if (root) {
    if (root.matches?.(selector)) add(root);
    try { root.querySelectorAll(selector).forEach(add); } catch (e) {}
  }
  try {
    const docNodes = document.querySelectorAll(selector);
    for (const n of docNodes) {
      if (seen.has(n)) continue;
      if (!root || root === document || root === document.body || n.closest('[class*="side-view"], [class*="sideView"], [class*="agentMode"], [class*="agent-mode"], [class*="ai-chat"], [class*="postbot"], aside, [role="complementary"], [class*="drawer"], [class*="pane"]')) {
        add(n);
      }
    }
  } catch (e) {}
  return results;
}

// ── Helper: extract a robust unique signature for a group or message ─────────
function getPostmanGroupSignature(group) {
  if (!group) return '';
  const userEl = group.matches?.(POSTMAN_USER_SELECTORS)
    ? group
    : group.querySelector?.(POSTMAN_USER_SELECTORS);
  const userId = userEl?.getAttribute?.('data-user-message-id') || userEl?.getAttribute?.('data-message-id') || '';
  const userQuery = userEl?.querySelector?.('.ai-chat-user-message-query') || userEl;
  const userTxt = (userQuery?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  const agentEl = group.matches?.(POSTMAN_AGENT_SELECTORS)
    ? group
    : group.querySelector?.(POSTMAN_AGENT_SELECTORS);
  const agentTarget = agentEl || (group !== userEl ? group : null);
  const agentTxt = (agentTarget?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);

  if (userId) {
    return 'id:' + userId + '::' + userTxt.slice(0, 40) + '::' + agentTxt.slice(0, 40);
  }
  if (userTxt || agentTxt) {
    return 'txt:' + userTxt + '###' + agentTxt;
  }
  return 'raw:' + (group.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

// ── Helper: robust text extractor that survives detached/unrendered DOM nodes 
function extractPostmanText(node, stripSels) {
  if (!node) return '';
  try {
    const clone = node.cloneNode(true);
    const removeSels = [
      'pre', 'button', 'svg', '[aria-hidden="true"]', '.sr-only'
    ].concat(stripSels || []);
    removeSels.forEach(s => {
      try { clone.querySelectorAll(s).forEach(e => e.remove()); } catch (e) {}
    });
    const t = (clone.innerText || clone.textContent || '').trim();
    if (t) return t.replace(/\n{3,}/g, '\n\n');
  } catch (e) {}

  const fallback = (node.innerText || node.textContent || '').trim();
  if (fallback) return fallback.replace(/\n{3,}/g, '\n\n');

  // Last resort: use pre-captured text stamped before scroll (for Monaco nodes)
  const preText = node.getAttribute?.('data-cai-pretext') || '';
  return preText.replace(/\n{3,}/g, '\n\n');
}

// ── Helper: Auto-scroll crawler to gather all virtualized turns ──────────────
async function collectAllPostmanGroups(searchScope, chatRoot, preScrollLiveGroups) {
  const scrollEl = findPostmanScrollContainer(chatRoot);

  if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 30) {
    return null;
  }

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;opacity:0;pointer-events:none;z-index:-1;';
  document.body.appendChild(holder);

  const seenSignatures = new Set();
  const collectedGroups = [];

  function harvest() {
    // Harvest message groups
    const currentGroups = queryAllPostman(searchScope, POSTMAN_GROUP_SELECTORS);

    for (const group of currentGroups) {
      const sig = getPostmanGroupSignature(group);
      if (sig && !seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        const cloned = group.cloneNode(true);
        holder.appendChild(cloned);
        collectedGroups.push(cloned);
      }
    }
  }

  const originalScrollTop = scrollEl.scrollTop;
  const originalScrollBehavior = scrollEl.style.scrollBehavior;
  scrollEl.style.scrollBehavior = 'auto'; // Instant jumping for fast crawling

  try {
    // 1. Scroll to top to trigger loading of any older history
    scrollEl.scrollTop = 0;
    scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));

    // Handle pagination at top if Postman lazily fetches earlier turns
    let lastHeight = scrollEl.scrollHeight;
    for (let p = 0; p < 4; p++) {
      if (scrollEl.scrollTop > 0) {
        scrollEl.scrollTop = 0;
        scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 100));
      if (scrollEl.scrollHeight > lastHeight) {
        lastHeight = scrollEl.scrollHeight;
        scrollEl.scrollTop = 0;
        scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
      } else {
        break;
      }
    }

    // Harvest turns visible at top
    harvest();

    // 2. Progressively scroll down in overlapping steps to harvest virtualized items
    const stepSize = Math.max(260, Math.floor(scrollEl.clientHeight * 0.65));
    let maxSteps = 90;
    let prevScrollTop = -1;

    while (maxSteps-- > 0) {
      if (scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 5) {
        harvest(); // HARVEST BEFORE BREAKING!
        break;
      }
      scrollEl.scrollTop += stepSize;
      scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));

      if (scrollEl.scrollTop === prevScrollTop) {
        harvest();
        break;
      }
      prevScrollTop = scrollEl.scrollTop;

      await new Promise(r => setTimeout(r, 90));
      harvest();
    }

    // 3. Scroll to the absolute maximum bottom and wait for React to mount the final turns!
    scrollEl.scrollTop = scrollEl.scrollHeight + 5000;
    scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    harvest();

    // If scrollHeight expanded after React mounted items:
    if (scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 5) {
      scrollEl.scrollTop = scrollEl.scrollHeight + 5000;
      scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      harvest();
    }

    if (chatRoot && chatRoot !== scrollEl) {
      chatRoot.scrollTop = chatRoot.scrollHeight + 5000;
      chatRoot.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise(r => setTimeout(r, 180));
      harvest();
    }

    // 4. GUARANTEE: Check if any group from preScrollLiveGroups is missing!
    // Since preScrollLiveGroups were captured at the bottom before scrolling,
    // any group not yet seen MUST be appended to the end of collectedGroups!
    if (Array.isArray(preScrollLiveGroups) && preScrollLiveGroups.length > 0) {
      for (const preGroup of preScrollLiveGroups) {
        const sig = getPostmanGroupSignature(preGroup);
        if (sig && !seenSignatures.has(sig)) {
          seenSignatures.add(sig);
          holder.appendChild(preGroup);
          collectedGroups.push(preGroup);
        }
      }
    }
  } catch (e) {
    console.warn('[ContextSwitchAI] Postman auto-scroll crawl error:', e);
  } finally {
    // Restore user's original scroll position
    scrollEl.scrollTop = originalScrollTop;
    scrollEl.style.scrollBehavior = originalScrollBehavior;
    scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  return { collectedGroups, holder };
}

async function parsePostman() {
  const msgs = [], ts = {}, cm = {}, am = {};
  let ti = 1, ci = 1, fi = 1;

  // 1. Locate the Postbot / Agent Mode chat container
  let convoList = document.querySelector(
    '.ai-chat-conversation-list, [data-testid="ai-chat-conversation-container"], [class*="ai-chat-conversation-list"]'
  );

  // If not found at top level, search inside any side view / agent drawer
  if (!convoList) {
    const containers = document.querySelectorAll(
      '[class*="side-view"], [class*="sideView"], [class*="agentMode"], [class*="agent-mode"], aside, [role="complementary"], [class*="drawer"], [class*="pane"]'
    );
    for (const c of containers) {
      convoList = c.querySelector(
        '.ai-chat-conversation-list, [data-testid="ai-chat-conversation-container"], [class*="ai-chat-conversation-list"]'
      );
      if (convoList) break;
    }
  }

  let chatRoot = convoList;
  if (!chatRoot) {
    const CONTAINER_SELECTORS = [
      '[class*="ai-chat-container"]',
      '[class*="aiChat"]',
      '[data-test*="postbot-chat"]',
      '[data-test*="postbot-side-view"]',
      '[data-test*="side-view"]',
      '[data-test*="agentMode"]',
      '[data-test*="agent-mode"]',
      '[data-test*="postbot"]',
      '[class*="postbot-container"]',
      '[class*="postbotChat"]',
      '[class*="postbot_chat"]',
      '[class*="agentMode"]',
      '[class*="agent-mode"]',
      '[class*="side-view"]',
      '[aria-label*="Postbot" i]',
      '[aria-label*="Agent" i]',
    ];

    for (const sel of CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        chatRoot = el;
        break;
      }
    }
  }

  // Fallback: locate Postbot input box and climb up to find chat wrapper
  if (!chatRoot) {
    const inputEl = document.querySelector(
      'textarea[placeholder*="Postbot" i], textarea[placeholder*="Ask" i], textarea[placeholder*="agent" i], textarea[placeholder*="Describe" i], [data-test*="postbot-input"], [data-test*="chat-input"]'
    );
    if (inputEl) {
      let p = inputEl.parentElement;
      for (let i = 0; i < 8 && p && p !== document.body; i++) {
        if (p.querySelector('[class*="message"], [data-test*="message"], [class*="response"], [class*="prompt"], [class*="conversation"]')) {
          chatRoot = p;
          break;
        }
        p = p.parentElement;
      }
      if (!chatRoot && inputEl.closest('[class*="side"], [class*="panel"], [class*="drawer"], [role="complementary"], aside')) {
        chatRoot = inputEl.closest('[class*="side"], [class*="panel"], [class*="drawer"], [role="complementary"], aside');
      }
    }
  }

  const STRIP_SELECTORS = [
    'pre',
    'button',
    'svg',
    '.monaco-editor',
    '.text-editor',
    '[class*="action-bar"]',
    '[class*="actionBar"]',
    '[class*="feedback"]',
    '[class*="rating"]',
    '[class*="suggestion-chip"]',
    '[class*="suggestionChip"]',
    '[class*="suggestion-item"]',
    '[class*="suggestions-container"]',
    '[class*="suggestion-list"]',
    '.ai-chat-suggestion-chips',
    '[class*="filter-chip"]',
    '[class*="action-chip"]',
    '[class*="copy-button"]',
    '[class*="copyBtn"]',
    '[class*="insert-code"]',
    '[class*="run-button"]',
    '[class*="disclaimer"]',
    '[aria-label="Copy"]',
    '[aria-label="Like"]',
    '[aria-label="Dislike"]',
    '[aria-label="More"]',
    '[class*="Button__StyledButton"]',
  ];

  function isDuplicateOfRecent(role, txt, codeRefs) {
    if (!msgs || msgs.length === 0) return false;
    const recentMsgs = msgs.filter(m => m[0] === role).slice(-2);
    if (recentMsgs.length === 0) return false;

    const normTxt = (txt || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const currCodes = (codeRefs || []).map(id => (cm[id]?.[1] || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

    for (const prevMsg of recentMsgs) {
      const prevContent = prevMsg[2];
      const prevTxt = (typeof prevContent === 'string' ? prevContent : (prevContent?.txt || '')).replace(/\s+/g, ' ').trim().toLowerCase();
      const prevCodeIds = (prevContent && typeof prevContent === 'object' && Array.isArray(prevContent.c))
        ? prevContent.c
        : (prevContent?.c ? [prevContent.c] : []);
      const prevCodes = prevCodeIds.map(id => (cm[id]?.[1] || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

      // Text comparison — directional substring check to avoid tautologies
      if (normTxt && prevTxt) {
        if (normTxt === prevTxt) return true;
        const minLen = Math.min(normTxt.length, prevTxt.length);
        if (minLen >= 15) {
          const currSample = normTxt.slice(0, Math.min(45, minLen));
          const prevSample = prevTxt.slice(0, Math.min(45, minLen));
          // prevTxt contains curr's prefix  OR  currTxt contains prev's prefix
          // NOTE: do NOT use normTxt.includes(currSample) — that's always true.
          if (prevTxt.includes(currSample) || normTxt.includes(prevSample)) {
            return true;
          }
        }
      }

      // Code comparison — full equality only (prefix matching causes false-positives
      // when different responses share the same table header, e.g. "| Aspect | Assessment |")
      if (currCodes.length > 0 && prevCodes.length > 0) {
        for (const cCurr of currCodes) {
          for (const cPrev of prevCodes) {
            if (cCurr === cPrev) {
              return true;
            }
          }
        }
      }

      // Empty messages
      if (!normTxt && !prevTxt && currCodes.length === 0 && prevCodes.length === 0) {
        return true;
      }
    }

    return false;
  }

  function addMessage(node, role) {
    if (!node) return;

    // 1. Convert HTML tables into formatted markdown tables so structured data is preserved
    convertHtmlTablesToMarkdown(node);

    // 2. Extract code blocks, Monaco editors, and HTML visualizer assets
    const { codeRefs, cIdx: nc } = extractPostmanCode(node, cm, ci);

    // 3. Extract attachments and images
    const tId_temp = 't' + ti;
    const { refs: attRefs, fIdx: nf } = extractAttachments(node, am, fi, tId_temp, {
      chipSels: [
        '[class*="attachment"]',
        '[class*="fileChip"]',
        '[class*="upload"]',
        '[class*="pill"]',
        '[class*="badge"]'
      ],
      imgSels: [
        'img[src*="blob:"]',
        'img[src*="postman"]',
        'img[alt]:not([alt=""]):not([src*="avatar"]):not([src*="icon"]):not([src*="logo"])'
      ]
    });

    // 4. Clean text using robust Postman text extraction
    const txt = cleanMessageText(extractPostmanText(node, STRIP_SELECTORS));
    const c = buildContent(txt, codeRefs, attRefs);
    if (c === null) return;

    // 5. Deduplication check against recent messages of this role
    if (isDuplicateOfRecent(role, txt, codeRefs)) {
      return;
    }

    // Commit state updates
    ci = nc;
    fi = nf;
    const tId = 't' + ti++;
    ts[tId] = new Date().toISOString();
    msgs.push([role, tId, c]);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ───────────────────────────────────────────────────────────────────────────
  // Scope search to the full agent sidebar/drawer to catch both list and bottom items
  // ───────────────────────────────────────────────────────────────────────────
  const searchScope = chatRoot?.parentElement?.closest(
    '[class*="side-view"], [class*="sideView"], [class*="agentMode"], [class*="agent-mode"], aside, [role="complementary"], [class*="drawer"], [class*="pane"], [class*="ai-chat-container"], [class*="postbot"]'
  ) || chatRoot?.closest(
    '[class*="side-view"], [class*="sideView"], [class*="agentMode"], [class*="agent-mode"], aside, [role="complementary"], [class*="drawer"], [class*="pane"], [class*="ai-chat-container"], [class*="postbot"]'
  ) || chatRoot?.parentElement || chatRoot || document.body;

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 0: Capture live snapshot of the bottom turns BEFORE any scrolling
  // The user is at the bottom right now. The latest turn is mounted in the DOM.
  // ───────────────────────────────────────────────────────────────────────────
  const preScrollLiveGroups = queryAllPostman(searchScope, POSTMAN_GROUP_SELECTORS).map(g => g.cloneNode(true));

  // Find the latest live user prompt
  const allLiveUserNodes = queryAllPostman(searchScope, POSTMAN_USER_SELECTORS);
  const lastLiveUserNode = allLiveUserNodes.length > 0 ? allLiveUserNodes[allLiveUserNodes.length - 1] : null;
  const lastLiveUserClone = lastLiveUserNode ? lastLiveUserNode.cloneNode(true) : null;
  const lastLiveUserId = lastLiveUserNode?.getAttribute?.('data-user-message-id') || lastLiveUserNode?.getAttribute?.('data-message-id') || '';
  const lastLiveUserQuery = lastLiveUserNode ? (lastLiveUserNode.querySelector('.ai-chat-user-message-query') || lastLiveUserNode) : null;
  const lastLiveUserText = lastLiveUserQuery
    ? (extractPostmanText(lastLiveUserQuery, STRIP_SELECTORS) || (lastLiveUserQuery.innerText || lastLiveUserQuery.textContent || '').trim())
    : '';

  // Find the latest live agent response
  const allLiveAgentNodes = queryAllPostman(searchScope, POSTMAN_AGENT_SELECTORS);
  const lastLiveAgentNode = allLiveAgentNodes.length > 0 ? allLiveAgentNodes[allLiveAgentNodes.length - 1] : null;
  const lastLiveAgentClone = lastLiveAgentNode ? lastLiveAgentNode.cloneNode(true) : null;
  const lastLiveAgentText = lastLiveAgentNode
    ? (extractPostmanText(lastLiveAgentNode, STRIP_SELECTORS) || (lastLiveAgentNode.innerText || lastLiveAgentNode.textContent || '').trim())
    : '';
  const lastLiveAgentHasCode = lastLiveAgentNode
    ? !!lastLiveAgentNode.querySelector('pre, code, .monaco-editor, iframe, [data-mode-id], [data-test*="visualizer"]')
    : false;

  // Crawl virtualized DOM list to gather all historical turns
  let crawlResult = null;
  try {
    crawlResult = await collectAllPostmanGroups(searchScope, chatRoot, preScrollLiveGroups);
  } catch (e) {
    console.warn('[ContextSwitchAI] Postman crawl error:', e);
  }

  const holder = crawlResult?.holder || null;
  let messageGroups = crawlResult?.collectedGroups;

  // Fallback to pre-scroll snapshot or direct DOM query if crawl wasn't needed or found nothing
  if (!messageGroups || messageGroups.length === 0) {
    if (preScrollLiveGroups.length > 0) {
      messageGroups = preScrollLiveGroups;
    } else {
      messageGroups = queryAllPostman(searchScope, POSTMAN_GROUP_SELECTORS);
    }
  }

  // Track processed user and agent elements to detect any remaining loose turns
  const processedUserIds = new Set();
  const processedTexts = new Set();

  function getNodeSample(node) {
    if (!node) return '';
    return (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
  }

  function markProcessed(node) {
    if (!node) return;
    const uid = node.getAttribute?.('data-user-message-id') || node.getAttribute?.('data-message-id') || '';
    if (uid) processedUserIds.add(uid);
    const sample = getNodeSample(node);
    if (sample) processedTexts.add(sample);
  }

  function isAlreadyProcessed(node) {
    if (!node) return false;
    const uid = node.getAttribute?.('data-user-message-id') || node.getAttribute?.('data-message-id') || '';
    if (uid && processedUserIds.has(uid)) return true;
    const sample = getNodeSample(node);
    if (sample && processedTexts.has(sample)) return true;
    return false;
  }

  if (messageGroups.length > 0) {
    messageGroups.forEach(group => {
      // 1. User Message inside group
      const rawUserNodes = Array.from(group.querySelectorAll(POSTMAN_USER_SELECTORS))
        .filter(u => !u.closest('.ai-chat-user-message-query'));
      if (group.matches?.(POSTMAN_USER_SELECTORS) && !rawUserNodes.includes(group)) {
        rawUserNodes.unshift(group);
      }
      // Outermost user containers only
      const userNodes = [];
      rawUserNodes.forEach(u => {
        if (!userNodes.some(p => p.contains(u) && p !== u)) {
          userNodes.push(u);
        }
      });
      userNodes.forEach(uc => {
        markProcessed(uc);
        const queryEl = uc.querySelector('.ai-chat-user-message-query') || uc;
        addMessage(queryEl, 'u');
      });

      // 2. Agent Messages inside group
      const rawAgentNodes = Array.from(group.querySelectorAll(POSTMAN_AGENT_SELECTORS));
      if (group.matches?.(POSTMAN_AGENT_SELECTORS) && !rawAgentNodes.includes(group)) {
        rawAgentNodes.unshift(group);
      }
      // Outermost agent containers only
      const agentNodes = [];
      rawAgentNodes.forEach(a => {
        if (!agentNodes.some(p => p.contains(a) && p !== a)) {
          agentNodes.push(a);
        }
      });

      if (agentNodes.length > 0) {
        agentNodes.forEach(b => markProcessed(b));
        // Wrap all agent content in this group into a SINGLE message
        const agentWrapper = document.createElement('div');
        agentNodes.forEach(b => agentWrapper.appendChild(b.cloneNode(true)));
        addMessage(agentWrapper, 'a');
      } else {
        const nonUserMsgs = Array.from(group.querySelectorAll('.ai-chat-message')).filter(msg => {
          return !msg.matches(POSTMAN_USER_SELECTORS) && !msg.querySelector(POSTMAN_USER_SELECTORS);
        });
        if (nonUserMsgs.length > 0) {
          nonUserMsgs.forEach(m => markProcessed(m));
          const agentWrapper = document.createElement('div');
          nonUserMsgs.forEach(m => agentWrapper.appendChild(m.cloneNode(true)));
          addMessage(agentWrapper, 'a');
        }
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Check for any loose / recent user prompts or agent answers
  // at the bottom of searchScope that were not inside messageGroups!
  // ───────────────────────────────────────────────────────────────────────────
  const looseUserNodes = queryAllPostman(searchScope, POSTMAN_USER_SELECTORS).filter(n => !isAlreadyProcessed(n));
  const rawLooseBotNodes = queryAllPostman(searchScope, POSTMAN_AGENT_SELECTORS).filter(n => !isAlreadyProcessed(n));
  const looseBotNodes = [];
  rawLooseBotNodes.forEach(a => {
    if (!looseBotNodes.some(p => p.contains(a) && p !== a)) {
      looseBotNodes.push(a);
    }
  });

  if (looseUserNodes.length > 0 || looseBotNodes.length > 0) {
    const loosePairs = [];
    looseUserNodes.forEach(n => loosePairs.push({ node: n, role: 'u' }));
    looseBotNodes.forEach(n => loosePairs.push({ node: n, role: 'a' }));
    loosePairs.sort((a, b) => {
      try {
        return (a.node.compareDocumentPosition(b.node) & 4) ? -1 : 1;
      } catch (e) { return 0; }
    });
    loosePairs.forEach(p => {
      markProcessed(p.node);
      const el = p.role === 'u' ? (p.node.querySelector('.ai-chat-user-message-query') || p.node) : p.node;
      addMessage(el, p.role);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CRITICAL FAIL-SAFE: Verify that the latest turn from the live DOM snapshot
  // is present in msgs. If the virtualizer or grouping missed it, inject it now!
  // ───────────────────────────────────────────────────────────────────────────
  function isLastTurnPresent(role, targetNode, targetText, targetId, hasCode) {
    if (!msgs || msgs.length === 0) return false;
    const roleMsgs = msgs.filter(m => m[0] === role);
    if (roleMsgs.length === 0) return false;

    // Check against the last 3 messages of this role
    const candidateMsgs = roleMsgs.slice(-3);
    const normTarget = (targetText || targetNode?.textContent || '')
      .replace(/\s+/g, ' ').trim().toLowerCase();

    for (const m of candidateMsgs) {
      const content = m[2];
      const msgTxt = (typeof content === 'string' ? content : (content?.txt || ''))
        .replace(/\s+/g, ' ').trim().toLowerCase();
      const msgCodes = (content && typeof content === 'object' && Array.isArray(content.c))
        ? content.c
        : (content && typeof content === 'object' && content.c ? [content.c] : []);

      // 1. Text equality or significant overlap
      if (normTarget && msgTxt) {
        if (normTarget === msgTxt) return true;
        const minLen = Math.min(normTarget.length, msgTxt.length);
        if (minLen >= 15) {
          // Check if the stored message text contains the target's prefix,
          // OR if the target contains the stored message's prefix.
          // NOTE: do NOT check normTarget.includes(sample) — sample is derived
          // from normTarget so that's always true (false-positive).
          const targetSample = normTarget.slice(0, Math.min(35, minLen));
          const msgSample = msgTxt.slice(0, Math.min(35, minLen));
          if (msgTxt.includes(targetSample) || normTarget.includes(msgSample)) return true;
        }
      }

      // 2. Code content equality — compare actual code, not just presence
      if (hasCode && msgCodes.length > 0) {
        // Require at least the first 50 chars of code to match
        const targetCodeIds = (targetNode && typeof targetNode === 'object')
          ? (Array.isArray(targetNode.c) ? targetNode.c : (targetNode.c ? [targetNode.c] : []))
          : [];
        const targetCodes = targetCodeIds.map(id => (cm[id]?.[1] || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (targetCodes.length > 0) {
          for (const tc of targetCodes) {
            for (const mc of msgCodes.map(id => (cm[id]?.[1] || '').replace(/\s+/g, ' ').trim())) {
              if (mc && tc && (mc === tc || mc.slice(0, 50) === tc.slice(0, 50))) return true;
            }
          }
        }
        // If we can't compare codes (targetNode is a DOM node, not a message object),
        // fall through — don't assume it's present just because both have code.
      }

      // 3. REMOVED: the broad "short text + any existing AI msg = present" check.
      // That was a false-positive that swallowed the last AI response whenever
      // it was mostly code (short extracted text). We rely on text/code comparison only.
    }

    return false;
  }

  // Check if the last live user message is in msgs
  if (lastLiveUserClone) {
    const userPrompt = lastLiveUserText || (lastLiveUserClone.innerText || lastLiveUserClone.textContent || '').trim();
    if (!isLastTurnPresent('u', lastLiveUserClone, userPrompt, lastLiveUserId, false)) {
      const qEl = lastLiveUserClone.querySelector('.ai-chat-user-message-query') || lastLiveUserClone;
      addMessage(qEl, 'u');
    }
  } else {
    // If lastLiveUserClone wasn't found at Step 0, check live DOM now
    const liveUsersNow = queryAllPostman(document, POSTMAN_USER_SELECTORS);
    if (liveUsersNow.length > 0) {
      const lastNow = liveUsersNow[liveUsersNow.length - 1];
      const q = lastNow.querySelector('.ai-chat-user-message-query') || lastNow;
      const t = extractPostmanText(q, STRIP_SELECTORS) || (q.innerText || q.textContent || '').trim();
      if (!isLastTurnPresent('u', q, t, '', false)) {
        addMessage(q, 'u');
      }
    }
  }

  // Check if the last live agent response is in msgs
  if (lastLiveAgentNode) {
    const agentPrompt = lastLiveAgentText || (lastLiveAgentNode.innerText || lastLiveAgentNode.textContent || '').trim();
    if (!isLastTurnPresent('a', lastLiveAgentClone, agentPrompt, '', lastLiveAgentHasCode)) {
      // Use the live node (still attached to DOM) so Monaco view-lines are rendered.
      // Stamp the pre-captured text as a fallback attribute so extractPostmanText
      // can use it even if Monaco has re-virtualized lines post-scroll.
      if (agentPrompt && !lastLiveAgentNode.hasAttribute('data-cai-pretext')) {
        lastLiveAgentNode.setAttribute('data-cai-pretext', agentPrompt);
      }
      addMessage(lastLiveAgentNode, 'a');
    }
  } else if (lastLiveAgentClone) {
    // Live node gone (e.g. re-render after scroll) — use clone as last resort
    const agentPrompt = lastLiveAgentText || (lastLiveAgentClone.innerText || lastLiveAgentClone.textContent || '').trim();
    if (!isLastTurnPresent('a', lastLiveAgentClone, agentPrompt, '', lastLiveAgentHasCode)) {
      addMessage(lastLiveAgentClone, 'a');
    }
  } else {
    // If lastLiveAgentClone wasn't found at Step 0, check live DOM now
    const liveAgentsNow = queryAllPostman(document, POSTMAN_AGENT_SELECTORS);
    if (liveAgentsNow.length > 0) {
      const lastNow = liveAgentsNow[liveAgentsNow.length - 1];
      const t = extractPostmanText(lastNow, STRIP_SELECTORS) || (lastNow.innerText || lastNow.textContent || '').trim();
      const hasCode = !!lastNow.querySelector('pre, code, .monaco-editor, iframe, [data-mode-id], [data-test*="visualizer"]');
      if (!isLastTurnPresent('a', lastNow, t, '', hasCode)) {
        addMessage(lastNow, 'a');
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY 3: Fallback to generic class-based message selectors if msgs still empty
  // ───────────────────────────────────────────────────────────────────────────
  if (msgs.length === 0) {
    const classUserNodes = Array.from(searchScope.querySelectorAll(
      '[class*="userMessage"], [class*="user-message"], [class*="userPrompt"], [class*="user-prompt"], [class*="bubble--user"], [class*="UserQuery"]'
    ));
    const classBotNodes = Array.from(searchScope.querySelectorAll(
      '[class*="agentResponse"], [class*="agent-response"], [class*="postbotResponse"], [class*="postbot-response"], [class*="assistantMessage"], [class*="assistant-message"], [class*="botMessage"], [class*="bot-message"], [class*="AgentMessage"]'
    ));
    const pairs = [];
    classUserNodes.forEach(n => pairs.push({ node: n, role: 'u' }));
    classBotNodes.forEach(n => pairs.push({ node: n, role: 'a' }));

    if (pairs.length > 0) {
      pairs.sort((a, b) => a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1);
      pairs.forEach(p => addMessage(p.node, p.role));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STRATEGY 4: Turn items inside chatRoot
  // ───────────────────────────────────────────────────────────────────────────
  if (msgs.length === 0 && chatRoot) {
    const turnItems = Array.from(chatRoot.querySelectorAll(
      '[class*="message-item"], [class*="messageItem"], [class*="chat-turn"], [class*="chatTurn"], [class*="bubble"], [role="listitem"]'
    ));
    if (turnItems.length >= 1) {
      turnItems.forEach(turn => {
        const cls = (turn.className || '').toLowerCase();
        const testAttr = (turn.getAttribute('data-test') || turn.getAttribute('data-testid') || '').toLowerCase();
        const isUser = /user|prompt|human|sender|outgoing/i.test(cls) || /user|prompt/i.test(testAttr) ||
          !!turn.querySelector('[class*="user"], [data-test*="user"]');
        addMessage(turn, isUser ? 'u' : 'a');
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DEDUPLICATION SAFETY NET: Remove duplicate consecutive messages & turn pairs
  // ───────────────────────────────────────────────────────────────────────────
  function getMsgText(m) {
    if (!m) return '';
    const c = m[2];
    return (typeof c === 'string' ? c : (c?.txt || '')).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getMsgCodes(m) {
    if (!m) return '';
    const c = m[2];
    const ids = (c && typeof c === 'object' && Array.isArray(c.c)) ? c.c : (c?.c ? [c.c] : []);
    return ids.map(id => (cm[id]?.[1] || '').replace(/\s+/g, ' ').trim()).join('###');
  }

  function areMsgsEqual(m1, m2) {
    if (!m1 || !m2 || m1[0] !== m2[0]) return false;
    const t1 = getMsgText(m1);
    const t2 = getMsgText(m2);
    if (t1 && t2) {
      if (t1 === t2) return true;
      const minLen = Math.min(t1.length, t2.length);
      if (minLen >= 15) {
        const s1 = t1.slice(0, Math.min(45, minLen));
        const s2 = t2.slice(0, Math.min(45, minLen));
        if (t2.includes(s1) || t1.includes(s2)) return true;
      }
    }
    const c1 = getMsgCodes(m1);
    const c2 = getMsgCodes(m2);
    // Full equality only — prefix matching causes false-positives on shared table headers
    if (c1 && c2 && c1 === c2) return true;
    if (!t1 && !t2 && !c1 && !c2) return true;
    return false;
  }

  // 1. Filter out immediate duplicate of same role
  const dedupedSingle = [];
  for (let i = 0; i < msgs.length; i++) {
    const curr = msgs[i];
    const prev = dedupedSingle.length > 0 ? dedupedSingle[dedupedSingle.length - 1] : null;
    if (prev && areMsgsEqual(prev, curr)) {
      if (getMsgText(curr).length > getMsgText(prev).length || getMsgCodes(curr).length > getMsgCodes(prev).length) {
        dedupedSingle[dedupedSingle.length - 1] = curr;
      }
      continue;
    }
    dedupedSingle.push(curr);
  }

  // 2. Filter out duplicate turn pairs [..., (u1, a1), (u2, a2)]
  const finalMsgs = [];
  for (let i = 0; i < dedupedSingle.length; i++) {
    const curr = dedupedSingle[i];
    if (finalMsgs.length >= 2 && i + 1 < dedupedSingle.length) {
      const next = dedupedSingle[i + 1];
      const prevU = finalMsgs[finalMsgs.length - 2];
      const prevA = finalMsgs[finalMsgs.length - 1];
      if (areMsgsEqual(prevU, curr) && areMsgsEqual(prevA, next)) {
        i++; // Skip both curr and next (duplicate turn pair)
        continue;
      }
    }
    finalMsgs.push(curr);
  }

  const ccmf = assembleCCMF('postman', finalMsgs, ts, cm, am);

  // Chat title from header if available
  const titleEl = document.querySelector(
    '.ai-chat-header [class*="title"], [class*="ai-chat"] h4, [class*="side-view"] h4, [class*="sideView"] h4, [class*="agentMode"] h4, [class*="agent-mode"] h4, aside h4, [class*="chat-header"] [class*="title"], [class*="side-header"] [class*="title"], [data-test*="chat-title"], [data-test*="conversation-title"]'
  ) || chatRoot?.closest('[class*="side-view"], aside, [class*="pane"], [class*="drawer"]')
      ?.querySelector('h4, [class*="title"], [class*="header"]');
  const headerTitle = titleEl?.innerText?.trim();
  if (headerTitle && ccmf) {
    const cleanTitle = headerTitle.replace(/^[^a-zA-Z0-9]+/, '').trim().slice(0, 60);
    if (cleanTitle) ccmf.chatTitle = cleanTitle;
  }

  if (holder) {
    try { holder.remove(); } catch (e) {}
  }
  // Clean up any data-cai-pretext attributes we stamped on live DOM nodes
  try {
    document.querySelectorAll('[data-cai-pretext]').forEach(el => el.removeAttribute('data-cai-pretext'));
  } catch (e) {}

  return ccmf;
}
