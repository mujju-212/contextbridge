// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// popup.js — v2.0
'use strict';

// Check if the extension runtime context is still alive
function isExtensionValid() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome?.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

// Intercept and swallow context invalidation errors to keep the extension clean on reload/update
window.addEventListener('error', (event) => {
  const msg = event?.message || event?.error?.message || (typeof event === 'string' ? event : '');
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return true;
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || String(event?.reason || '');
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return true;
  }
}, true);

// Detect whether this script is running inside the FAB iframe (panel.html)
// vs the real extension popup. Used to suppress the T&C screen in the panel —
// the panel is always a secondary surface; T&C must be agreed in the main popup first.
const IS_PANEL = (window.self !== window.top);

let lastData = null;
let notes    = [];
let currentFormat = 'json'; // default export format

const HOST_PLATFORM = {
  'chatgpt.com'      : 'chatgpt',
  'claude.ai'        : 'claude',
  'gemini.google.com': 'gemini',
  'grok.com'         : 'grok',
  'x.com'            : 'grok',
  'deepseek.com'     : 'deepseek',
  'perplexity.ai'    : 'perplexity',
  'microsoft.com'    : 'copilot',
  'bing.com'         : 'copilot',
  'quark.cn'         : 'quark',
  'doubao.com'       : 'doubao',
  'postman.co'       : 'postman',
  'postman.com'      : 'postman',
  'lmarena.ai'       : 'lmarena',
  'arena.ai'         : 'lmarena',
  'chat.lmsys.org'   : 'lmarena',
  'lmsys.org'        : 'lmarena',
};

const ALLOWED_PLATFORMS = new Set([
  'chatgpt','claude','gemini','grok','deepseek','perplexity','copilot','quark','doubao','postman','lmarena'
]);

const PLATFORM_URLS = {
  chatgpt    : 'https://chatgpt.com',
  claude     : 'https://claude.ai',
  gemini     : 'https://gemini.google.com',
  grok       : 'https://grok.com',
  deepseek   : 'https://chat.deepseek.com',
  perplexity : 'https://www.perplexity.ai',
  copilot    : 'https://copilot.microsoft.com',
  quark      : 'https://www.quark.cn',
  doubao     : 'https://www.doubao.com',
  postman    : 'https://web.postman.co',
  lmarena    : 'https://lmarena.ai',
};

function $(id) { return document.getElementById(id); }

// ── Error messages ───────────────────────────────────────────────────────────
function friendlyError(rawMsg, context) {
  rawMsg = (rawMsg || '').toLowerCase();

  if (rawMsg.includes('could not establish connection') || rawMsg.includes('receiving end does not exist')) {
    return context === 'export'
      ? { msg: 'Please refresh the page and try again', hint: 'The extension lost connection to the AI page. Press Ctrl/Cmd + R to reload it, then click Export.' }
      : { msg: 'Please refresh the page and try again', hint: 'Reload the AI chat page (Ctrl/Cmd + R), then try again.' };
  }
  if (rawMsg.includes('no tab') || rawMsg.includes('no active tab')) {
    return { msg: 'No active browser tab found', hint: 'Click somewhere on the page first to make it active, then retry.' };
  }
  if (rawMsg.includes('no messages found') || rawMsg.includes('0 messages')) {
    return { msg: 'No conversation found on this page', hint: 'Make sure the chat has loaded fully. Try scrolling through the whole conversation, then export again.' };
  }
  if (rawMsg.includes('page did not respond') || rawMsg.includes('null') || rawMsg.includes('no response')) {
    return { msg: 'Page stopped responding — please refresh', hint: 'Reload the AI chat page (Ctrl/Cmd + R) and try again.' };
  }
  if (rawMsg.includes('too many messages') || rawMsg.includes('2000')) {
    return { msg: 'Conversation is too large to export at once', hint: 'Try exporting a shorter conversation, or start a new chat with a summary.' };
  }
  if (rawMsg.includes('unknown platform')) {
    return { msg: 'This platform is not supported yet', hint: 'Supported: ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, Copilot, Quark, Doubao, Postman, LM Arena.' };
  }
  if (rawMsg.includes('file too large')) {
    return { msg: 'File is too large (max 10 MB)', hint: 'Try loading a smaller exported file.' };
  }
  if (rawMsg.includes('invalid') || rawMsg.includes('not a valid ccmf') || rawMsg.includes('malformed')) {
    return { msg: "This file doesn't look like a valid export", hint: "Make sure you're loading a .json file exported by this extension." };
  }
  if (rawMsg.includes('zip')) {
    return { msg: 'ZIP export failed', hint: 'Make sure the original chat page is still open, then try again.' };
  }
  return { msg: rawMsg.replace(/^(error:|⚠|warning:)\s*/i, ''), hint: 'If this keeps happening, try reloading the page and reopening the extension.' };
}

function setStatus(text, type, hint) {
  const el = $('status');
  el.textContent = '';
  if (!text) return;
  const wrap = document.createElement('span');
  wrap.className = type === 'ok' ? 's-ok' : type === 'err' ? 's-err' : 's-dim';
  wrap.textContent = type === 'err' ? '✕ ' + text : type === 'ok' ? '✓ ' + text : text;
  el.appendChild(wrap);
  if (hint) {
    const hintEl = document.createElement('span');
    hintEl.className = 's-hint';
    hintEl.textContent = '→ ' + hint;
    el.appendChild(hintEl);
  }
}

function setError(rawMsg, context) {
  const { msg, hint } = friendlyError(rawMsg, context);
  setStatus(msg, 'err', hint);
}

// Smart filename builder
const AI_DISPLAY_NAMES = {
  chatgpt:'ChatGPT', claude:'Claude', gemini:'Gemini', grok:'Grok',
  deepseek:'DeepSeek', perplexity:'Perplexity', copilot:'Copilot',
  quark:'Quark', doubao:'Doubao', postman:'Postman', lmarena:'LM Arena',
};
function buildSmartFilename(data) {
  try {
    const aiLabel  = AI_DISPLAY_NAMES[(data && data.p) || ''] || 'AI';
    let rawChat = '';
    if (data && typeof data.chatTitle === 'string') {
      rawChat = data.chatTitle.trim();
    } else if (data && data.chatTitle) {
      rawChat = String(data.chatTitle).trim();
    }
    const chatPart = rawChat
      ? rawChat.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 40)
      : 'Chat';
    const now = new Date();
    const ts  = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') + '-' +
      String(now.getMinutes()).padStart(2, '0') + '-' +
      String(now.getSeconds()).padStart(2, '0');
    return aiLabel + '_' + chatPart + '_' + ts;
  } catch (e) {
    return 'Chat_' + Date.now();
  }
}
function getFilename(ext) {
  const raw  = $('fileNameInput').value.trim();
  const base = raw
    ? raw.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80)
    : buildSmartFilename(lastData);
  // If ext is explicitly provided, use it; otherwise derive from currentFormat
  if (ext !== undefined && ext !== null && ext !== '') return base + ext;
  const fmtExt = { json: '.json', csv: '.csv', md: '.md', pdf: '.html' };
  return base + (fmtExt[currentFormat] || '.json');
}

// ── Validation ───────────────────────────────────────────────────────────────
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function validateCCMF(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a valid CCMF file');
  if (!Array.isArray(data.m))            throw new Error('Missing message array');
  if (typeof data.p !== 'string')        throw new Error('Missing platform field');
  if (!ALLOWED_PLATFORMS.has(data.p))   throw new Error('Unknown platform: ' + data.p);
  if (data.m.length > 2000)             throw new Error('File contains too many messages');
  for (const m of data.m) {
    if (!Array.isArray(m) || m.length < 3) throw new Error('Malformed message entry');
    if (m[0] !== 'u' && m[0] !== 'a')      throw new Error('Invalid message role');
  }
  return true;
}

function safeDownloadUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch { return null; }
}

// ── Context preamble ─────────────────────────────────────────────────────────
function buildContextPreamble(data) {
  const notesArr      = Array.isArray(data.notes) ? data.notes : [];
  const openingPrompt = (data._openingPrompt || '').trim();
  const lines = [];
  lines.push('=== LLM MEMORY EXPORT ===');
  lines.push('Source: ' + (data.p || 'unknown') + ' | ' + (data.m || []).length + ' messages');
  lines.push('Exported: ' + new Date().toISOString().slice(0, 10));
  lines.push('');
  lines.push('INSTRUCTIONS FOR AI: This file contains a compressed export of a prior');
  lines.push('conversation. Please read the notes and context below, then resume');
  lines.push('naturally as if continuing from where we left off.');
  if (notesArr.length > 0) {
    lines.push(''); lines.push('--- NOTES FROM USER ---');
    notesArr.forEach((n, i) => lines.push((i + 1) + '. ' + n.text));
  }
  if (openingPrompt) {
    lines.push(''); lines.push('--- OPENING REQUEST ---'); lines.push(openingPrompt);
  }
  lines.push(''); lines.push('--- CONVERSATION FOLLOWS ---');
  return lines.join('\n');
}

function finaliseExportData(data, prompt) {
  const out = Object.assign({}, data);
  if (notes.length > 0) out.notes = notes.map(n => ({ text: n.text, ts: n.ts }));
  const effectivePrompt = (prompt && prompt.trim()) ? prompt.trim().slice(0, 1000)
    : (data._openingPrompt && data._openingPrompt.trim()) ? data._openingPrompt.trim().slice(0, 1000)
    : 'Please review our prior discussion from this session and continue where we left off. Acknowledge what we covered and help me with the next step!';
  out._openingPrompt = effectivePrompt;
  out._context = buildContextPreamble(out);
  return out;
}

// ═══════════════════════════════════════════════════════════════
// T&C GATE
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// LOAD & CONTINUE MODAL
// ═══════════════════════════════════════════════════════════════

let _lcmData = null;

function openLoadContinueModal(data, name) {
  _lcmData = data;
  const modal = $('loadContinueModal');
  if (!modal) return;

  // Header meta
  const msgs    = (data.m || []).length;
  const platform = data.p || 'unknown';
  const label   = name ? name.replace(/\.json$/i, '') : platform;
  $('lcmTitle').textContent = '📂 ' + label;
  $('lcmMeta').textContent  = msgs + ' messages · from ' + platform;

  // Populate prompt input
  const promptInput = $('lcmPromptInput');
  if (promptInput) {
    promptInput.value = data._openingPrompt || $('openingPrompt')?.value || '';
  }

  modal.classList.add('open');
}

function closeLoadContinueModal() {
  const modal = $('loadContinueModal');
  if (modal) modal.classList.remove('open');
  _lcmData = null;
}

function initLoadContinueModal() {
  const modal = $('loadContinueModal');
  if (!modal) return;

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLoadContinueModal();
  });
  $('lcmClose').addEventListener('click', closeLoadContinueModal);

  // AI platform buttons
  modal.querySelectorAll('.lcm-ai-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform;
      if (!platform || !_lcmData) return;
      const prompt = $('lcmPromptInput')?.value?.trim().slice(0, 1000) || $('openingPrompt')?.value?.trim().slice(0, 1000) || _lcmData._openingPrompt || '';
      if ($('openingPrompt') && prompt) $('openingPrompt').value = prompt;
      const exportData = finaliseExportData(_lcmData, prompt);
      chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, () => {
        chrome.runtime.sendMessage({ action: 'CONTINUE_ON', platform }, (res) => {
          if (!res?.ok) setError(res?.error || 'Could not connect to ' + platform, 'open');
          else if (res?.reusedTab) setStatus('Injected into open ' + platform + ' tab ✓', 'ok');
          else setStatus('Opening ' + platform + ' — memory attaching…', 'ok');
        });
      });
      closeLoadContinueModal();
    });
  });

  // Inject into current tab
  $('lcmInjectBtn').addEventListener('click', async () => {
    if (!_lcmData) return;
    const prompt = $('lcmPromptInput')?.value?.trim().slice(0, 1000) || $('openingPrompt')?.value?.trim().slice(0, 1000) || _lcmData._openingPrompt || '';
    if ($('openingPrompt') && prompt) $('openingPrompt').value = prompt;
    const exportData = finaliseExportData(_lcmData, prompt);
    chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) { setStatus('No active tab', 'err'); return; }
      let host = '';
      try { host = new URL(tab.url).hostname; } catch(e) {}
      const currentPlatform = Object.entries(HOST_PLATFORM).find(
        ([k]) => host === k || host.endsWith('.' + k)
      )?.[1];
      if (currentPlatform) {
        chrome.tabs.sendMessage(tab.id, { action: 'INJECT_CONTINUATION', platform: currentPlatform }, (res) => {
          if (!chrome.runtime.lastError && res?.ok) setStatus('Injected into ' + currentPlatform + ' ✓', 'ok');
          else setError('Could not inject — refresh the AI page first', 'inject');
        });
      } else {
        setError('Open ChatGPT, Claude, Gemini etc. first, then inject', 'inject');
      }
    });
    closeLoadContinueModal();
  });

  // Share — reuse existing openShareMenu
  $('lcmShareBtn').addEventListener('click', (ev) => {
    if (!_lcmData) return;
    const fakeEntry = { data: _lcmData, name: ($('fileNameInput')?.value || buildSmartFilename(_lcmData)) + '.json' };
    closeLoadContinueModal();
    // small delay so modal closes before menu opens
    setTimeout(() => openShareMenu($('lcmShareBtn'), fakeEntry), 80);
  });
}

// ── Loaded-JSON quick-action bar (always visible once a JSON is loaded) ───────
function showLoadedShareBar(data, name) {
  const row = $('loadedShareRow');
  if (!row) return;
  const label = $('loadedShareLabel');
  const msgs  = (data.m || []).length;
  const src   = data.p || 'file';
  label.textContent = '📂 ' + (name ? name.replace(/\.json$/i,'') : src) + ' · ' + msgs + ' msgs';
  row.style.display = 'block';
}

function initLoadedShareBar() {
  const continueBtn = $('lsaContinueBtn');
  const shareBtn    = $('lsaShareBtn');
  const injectBtn   = $('lsaInjectBtn');
  if (!continueBtn) return;

  continueBtn.addEventListener('click', () => {
    if (!lastData) return;
    openLoadContinueModal(lastData, $('fileNameInput')?.value || '');
  });

  shareBtn.addEventListener('click', (ev) => {
    if (!lastData) return;
    const fakeEntry = { data: lastData, name: ($('fileNameInput')?.value || buildSmartFilename(lastData)) + '.json' };
    openShareMenu(shareBtn, fakeEntry);
  });

  injectBtn.addEventListener('click', async () => {
    if (!lastData) return;
    const prompt = $('lcmPromptInput')?.value?.trim().slice(0, 1000) || $('openingPrompt')?.value?.trim().slice(0, 1000) || lastData._openingPrompt || '';
    if ($('openingPrompt') && prompt) $('openingPrompt').value = prompt;
    const exportData = finaliseExportData(lastData, prompt);
    chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) { setStatus('No active tab', 'err'); return; }
      let host = '';
      try { host = new URL(tab.url).hostname; } catch(e) {}
      const p = Object.entries(HOST_PLATFORM).find(([k]) => host === k || host.endsWith('.' + k))?.[1];
      if (p) {
        chrome.tabs.sendMessage(tab.id, { action: 'INJECT_CONTINUATION', platform: p }, (res) => {
          if (!chrome.runtime.lastError && res?.ok) setStatus('Injected into ' + p + ' ✓', 'ok');
          else setError('Could not inject — refresh the AI page first', 'inject');
        });
      } else {
        setError('Open an AI tab first (ChatGPT, Claude, Gemini…)', 'inject');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// TUTORIAL ENGINE
// ═══════════════════════════════════════════════════════════════

const TUTORIAL_STEPS = [
  {
    targetId: null, // welcome — full-center modal, no spotlight
    title: '👋 Welcome to MKAI!',
    body: `Your AI conversations no longer have to start from scratch.<br><br>
           <strong>In 30 seconds you'll learn how to:</strong><br>
           export any AI chat · carry your memory across platforms · continue seamlessly on any AI.`,
    hint: { ico: '⚡', text: 'This is a quick 6-step tour. You can skip at any time.' },
    arrow: null,
  },
  {
    targetId: 'exportBtn',
    title: '① Export your chat',
    body: `Click <strong>⬆ Export Chat</strong> while you're on any AI platform — ChatGPT, Claude, Gemini, Grok, DeepSeek, and more.<br><br>
           Your entire conversation is captured as a compressed memory file and saved to your <span class="tut-chip">Downloads/MKAI</span> folder.`,
    hint: { ico: '💡', text: "Works on the current tab's AI chat. Navigate there first, then click Export." },
    arrow: 'top',
  },
  {
    targetId: 'fmt-options',
    title: '② Pick your format',
    body: `Choose how to export your chat:<br><br>
           <strong>JSON 🗜</strong> — best for AI import, token-compressed<br>
           <strong>CSV 🗜</strong> — spreadsheet-friendly<br>
           <strong>MD</strong> — full readable Markdown<br>
           <strong>PDF</strong> — printable via browser`,
    hint: { ico: '🧠', text: 'JSON is recommended — it keeps the most context in the fewest tokens when the AI reads it.' },
    arrow: 'top',
  },
  {
    targetId: 'csaiSidebar',
    title: '③ Click an AI to continue',
    body: `After exporting, click any AI logo in this sidebar.<br><br>
           MKAI will <strong>open that AI in a new tab</strong> and <strong>automatically attach your exported memory file</strong> — so the new AI instantly knows your full conversation history.`,
    hint: { ico: '🚀', text: "No copy-pasting needed. The chat context lands in the new AI's input box automatically." },
    arrow: 'left',
  },
  {
    targetId: 'contextToggleBtn',
    title: '④ Add notes & a follow-up prompt',
    body: `Click the <strong>📝 Notes</strong> button to add sticky notes or an opening message that gets sent to the new AI along with your memory.<br><br>
           Great for: <em>"Continue where we left off and focus on the CSS part next"</em> or <em>"Translate all previous answers to Spanish"</em>.`,
    hint: { ico: '✍️', text: "Notes are carried forward every time you switch — they're like a persistent sticky note for your AI." },
    arrow: 'left',
  },
  {
    targetId: 'openSearchBtn',
    title: '⑤ Search all your past chats',
    body: `<strong>Smart Context Search</strong> lets you search across every JSON export you've ever saved.<br><br>
           Find a relevant old conversation, select it, and load it into any AI with one click — <strong>even if you exported it weeks ago</strong>.`,
    hint: { ico: '🔍', text: 'Link your Downloads/MKAI folder once and all your past exports become searchable instantly.' },
    arrow: 'top',
  },
];

let _tutStep = 0;
let _tutActive = false;

function _tutGetEl(id) {
  if (!id) return null;
  if (id === 'fmt-options') return document.querySelector('.fmt-options');
  return document.getElementById(id);
}

function _tutPositionCard(card, targetEl, arrow) {
  const POPUP_W = 380, POPUP_H = 580;
  const cardW = 248, cardH = card.offsetHeight || 190;
  const pad = 10, margin = 6;

  if (!targetEl) {
    // Center welcome card
    card.style.left = Math.round((POPUP_W - cardW) / 2) + 'px';
    card.style.top  = Math.round((POPUP_H - cardH) / 2) + 'px';
    card.className  = 'tut-card';
    return;
  }

  const tr = targetEl.getBoundingClientRect();
  let top, left, arrowClass;

  // Helper: clamp left so card never exits popup horizontally
  const clampLeft = (l) => Math.min(Math.max(l, margin), POPUP_W - cardW - margin);
  // Helper: clamp top so card never exits popup vertically
  const clampTop  = (t) => Math.min(Math.max(t, margin), POPUP_H - cardH - margin);

  const fitsBelow  = tr.bottom + pad + cardH <= POPUP_H - margin;
  const fitsAbove  = tr.top    - pad - cardH >= margin;
  const fitsLeft   = tr.left   - pad - cardW >= margin;
  const fitsRight  = tr.right  + pad + cardW <= POPUP_W - margin;

  if (fitsBelow) {
    top = tr.bottom + pad;
    left = clampLeft(tr.left);
    arrowClass = 'arrow-top';
  } else if (fitsAbove) {
    top = tr.top - cardH - pad;
    left = clampLeft(tr.left);
    arrowClass = 'arrow-bottom';
  } else if (fitsLeft) {
    top = clampTop(tr.top);
    left = tr.left - cardW - pad;
    arrowClass = 'arrow-right';
  } else if (fitsRight) {
    top = clampTop(tr.top);
    left = tr.right + pad;
    arrowClass = 'arrow-left';
  } else {
    // No perfect fit — force above and clamp both axes
    top = clampTop(tr.top - cardH - pad);
    left = clampLeft(tr.left);
    arrowClass = 'arrow-bottom';
  }

  // Final safety clamp — always keep card fully inside popup
  top  = clampTop(top);
  left = clampLeft(left);

  card.style.top  = top  + 'px';
  card.style.left = left + 'px';
  card.className  = 'tut-card ' + arrowClass;
}

function _tutPositionSpotlight(targetEl) {
  const spot = document.getElementById('tutSpotlight');
  if (!targetEl) {
    spot.style.display = 'none';
    return;
  }
  const tr = targetEl.getBoundingClientRect();
  const pad = 5;
  spot.style.display = 'block';
  spot.style.top    = (tr.top    - pad) + 'px';
  spot.style.left   = (tr.left   - pad) + 'px';
  spot.style.width  = (tr.width  + pad*2) + 'px';
  spot.style.height = (tr.height + pad*2) + 'px';
}

function _tutRenderStep(idx) {
  const step   = TUTORIAL_STEPS[idx];
  const total  = TUTORIAL_STEPS.length;
  const overlay = document.getElementById('tutorialOverlay');
  const card    = document.getElementById('tutCard');
  const targetEl = _tutGetEl(step.targetId);

  // badge
  document.getElementById('tutBadge').textContent = `Step ${idx + 1} of ${total}`;
  document.getElementById('tutTitle').innerHTML = step.title;
  document.getElementById('tutBody').innerHTML  = step.body;

  // hint
  const hintEl = document.getElementById('tutHint');
  if (step.hint) {
    document.getElementById('tutHintIco').textContent  = step.hint.ico;
    document.getElementById('tutHintText').textContent = step.hint.text;
    hintEl.style.display = 'flex';
  } else {
    hintEl.style.display = 'none';
  }

  // dots
  const dotsEl = document.getElementById('tutDots');
  dotsEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'tut-dot' + (i === idx ? ' active' : '');
    dotsEl.appendChild(d);
  }

  // progress bar
  document.getElementById('tutProgressFill').style.width = ((idx + 1) / total * 100) + '%';

  // next / done
  const nextBtn = document.getElementById('tutNextBtn');
  if (idx === total - 1) {
    nextBtn.className = 'tut-btn-done';
    nextBtn.innerHTML = '✓ Got it!';
  } else {
    nextBtn.className = 'tut-btn-next';
    nextBtn.innerHTML = 'Next →';
  }

  // position card + spotlight (after paint so offsetHeight is accurate)
  requestAnimationFrame(() => {
    _tutPositionSpotlight(targetEl);
    _tutPositionCard(card, targetEl, step.arrow);
  });
}

function startTutorial() {
  if (IS_PANEL) return; // don't run in FAB panel
  _tutStep   = 0;
  _tutActive = true;
  const overlay = document.getElementById('tutorialOverlay');
  overlay.classList.add('active');
  _tutRenderStep(0);
}

function endTutorial() {
  _tutActive = false;
  document.getElementById('tutorialOverlay').classList.remove('active');
  chrome.storage.local.set({ tutorialSeen: true });
}

function initTutorialControls() {
  document.getElementById('tutNextBtn').addEventListener('click', () => {
    if (_tutStep < TUTORIAL_STEPS.length - 1) {
      _tutStep++;
      _tutRenderStep(_tutStep);
    } else {
      endTutorial();
    }
  });
  document.getElementById('tutSkipBtn').addEventListener('click', endTutorial);
  document.getElementById('tutBackdrop').addEventListener('click', endTutorial);

  const replayBtn = document.getElementById('tutReplayBtn');
  if (replayBtn) replayBtn.addEventListener('click', startTutorial);
}

function initTCScreen() {
  const checkbox  = $('tcCheckbox');
  const agreeBtn  = $('agreeBtn');
  const tcScreen  = $('tcScreen');
  const appScreen = $('appScreen');

  checkbox.addEventListener('change', () => {
    agreeBtn.classList.toggle('active', checkbox.checked);
  });

  agreeBtn.addEventListener('click', () => {
    if (!checkbox.checked) return;
    chrome.storage.local.set({ tcAgreed: true });
    tcScreen.classList.add('hidden');
    appScreen.classList.add('visible');
    initApp().then(() => {
      initTutorialControls();
      // Always show tutorial right after first-time TnC agreement
      startTutorial();
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
async function initApp() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  let host = '';
  try { host = new URL(tab.url).hostname; } catch(e) {}
  const current = Object.entries(HOST_PLATFORM).find(
    ([k]) => host === k || host.endsWith('.' + k)
  )?.[1];

  document.querySelectorAll('.ai-btn').forEach(btn => {
    if (btn.dataset.platform === current) {
      btn.classList.add('current');
      const dot = document.createElement('div');
      dot.className = 'current-dot';
      btn.appendChild(dot);
    }
  });

  loadRecentFiles();
  checkRateLimitModal();
  initLoadContinueModal();
  initLoadedShareBar();
  chrome.storage.local.get(['ccmf', 'notes'], (res) => {
    if (res.ccmf) {
      try { validateCCMF(res.ccmf); lastData = res.ccmf; enableAIButtons(res.ccmf); }
      catch(e) { /* don't remove — user might still want to continue on another platform */ }
    }
    if (Array.isArray(res.notes)) { notes = res.notes; renderNotes(); }
  });
}

// ── Post-export UI ───────────────────────────────────────────────────────────
function enableAIButtons(data) {
  document.querySelectorAll('.ai-btn').forEach(btn => btn.classList.add('ready'));
  showStats(data);
  $('actionRow').style.display = 'flex';
  $('resetBtn').style.display  = 'inline-block';
}

function showStats(data) {
  const msgs    = (data.m || []).length;
  const codes   = Object.keys(data.c   || {}).length;
  const atts    = Object.keys(data.att || {}).length;
  const imgAtts = atts > 0 ? Object.values(data.att || {}).filter(v => v.type === 'image').length : 0;

  $('statMsgs').textContent  = msgs;
  $('statCode').textContent  = codes;
  $('statAtt').textContent   = atts;
  $('statNotes').textContent = notes.length;
  $('stats').style.display   = 'flex';

  // Hide the 📎 attachments chip entirely when no attachments were detected
  const attRow = $('statAttRow');
  if (attRow) attRow.style.display = atts > 0 ? '' : 'none';

  const tk = data.tokenStats;
  if (tk && tk.rawChatTokens > 0) {
    $('statTokenRaw').textContent = Number(tk.rawChatTokens).toLocaleString();
    $('statTokenMin').textContent = Number(tk.compressedTokens).toLocaleString();
    $('statTokenPct').textContent = Number(tk.reductionPercent) + '%';
    $('tokenRow').style.display   = 'flex';
  } else {
    $('tokenRow').style.display = 'none';
  }

  const dlCount = atts > 0
    ? Object.values(data.att || {}).filter(v => v.downloadable && safeDownloadUrl(v.url)).length : 0;
  $('dlBtn').style.display  = dlCount > 0 ? '' : 'none';
  $('zipBtn').style.display = ''; // always show ZIP — captures images + manifest
  $('zipBtn').title = `Download ZIP with images${imgAtts > 0 ? ' (' + imgAtts + ' detected)' : ''} + attachment manifest`;

  renderAttachmentList(data.att || {});
}

function renderAttachmentList(attMap) {
  const panel   = $('attPanel');
  const list    = $('attList');
  const entries = Object.entries(attMap);
  if (!entries.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  list.textContent = '';

  const fileIconSVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M3 1h4l2.5 2.5V10.5a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5v-9A.5.5 0 013 1z"/><path d="M7 1v3h3"/></svg>`;
  const imgIconSVG  = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><rect x="1" y="1" width="10" height="10" rx="1.5"/><circle cx="3.5" cy="3.5" r="1"/><path d="M1 8l3-3 2 2 2-2 3 3"/></svg>`;
  const linkIconSVG = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M5 7l4-4M8 3h3v3M5.5 3H3a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6.5"/></svg>`;

  entries.forEach(([, att]) => {
    const item  = document.createElement('div'); item.className = 'att-item';
    const icon  = document.createElement('span'); icon.className = 'att-icon';
    icon.innerHTML = att.type === 'image' ? imgIconSVG : att.type === 'source' ? linkIconSVG : fileIconSVG;
    const name  = document.createElement('span'); name.className = 'att-name';
    name.textContent = att.name || 'attachment';
    if (att.url) name.title = att.url;
    const badge = document.createElement('span');
    badge.className = 'att-badge ' + (att.type === 'image' ? 'b-img' : att.downloadable ? 'b-dl' : 'b-meta');
    badge.textContent = att.type === 'image' ? 'image' : att.downloadable ? 'downloadable' : 'metadata';
    item.appendChild(icon); item.appendChild(name); item.appendChild(badge);
    list.appendChild(item);
  });
}

// ── Export ───────────────────────────────────────────────────────────────────
async function fetchAndExport(onData) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setError('No active tab found', 'export'); return; }

  const skipCompress = (currentFormat === 'md' || currentFormat === 'pdf');
  chrome.tabs.sendMessage(tab.id, { action: 'EXPORT', skipCompress }, (res) => {
    if (chrome.runtime.lastError) { setError(chrome.runtime.lastError.message || '', 'export'); return; }
    if (!res) { setError('page did not respond', 'export'); return; }
    if (!res.ok) { setError(res.error || 'Export failed', 'export'); return; }
    try { validateCCMF(res.data); } catch(e) { setError(e.message, 'export'); return; }

    const rawData = res.data;
    if (!$('fileNameInput').value.trim()) $('fileNameInput').value = buildSmartFilename(rawData);

    // Always store the full compressed JSON version for AI continuation
    lastData = finaliseExportData(rawData, '');
    chrome.runtime.sendMessage({ action: 'STORE_DATA', data: lastData });
    showStats(lastData);
    enableAIButtons(lastData);
    onData(rawData);
  });
}

// Export Chat → direct download, no overlay
$('exportBtn').onclick = async () => {
  const btn = $('exportBtn');
  setStatus('Exporting…', 'dim');
  btn.disabled = true;
  await fetchAndExport((rawData) => {
    doFinalExport(rawData, null, currentFormat);
  });
  btn.disabled = false;
};

// Select & Export → opens message selector overlay
$('selectExportBtn') && ($('selectExportBtn').onclick = async () => {
  const btn = $('selectExportBtn');
  setStatus('Reading chat…', 'dim');
  btn.disabled = true;
  await fetchAndExport((rawData) => {
    showMessageSelector(rawData);
    setStatus('');
  });
  btn.disabled = false;
});

// ── Format Selector (top-level buttons sync with selector overlay) ────────────
(function initFormatSelector() {
  const extLabels = { json: '.json', csv: '.csv', md: '.md', pdf: '.pdf' };
  function syncFmtExt() {
    const el = $('fnameExt');
    if (el) el.textContent = extLabels[currentFormat] || '.json';
  }
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFormat = btn.dataset.fmt;
      syncFmtExt();
      // Also sync the overlay format picker
      document.querySelectorAll('.mso-fmt-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mfmt === currentFormat);
      });
      updateComprLabel();
    });
  });
  syncFmtExt();
})();

// ── Message Selector ──────────────────────────────────────────────────────────
// Data held for the current selector session (may be uncompressed for MD/PDF)
let _selRawData = null;

function getMsgText(msg) {
  const content = msg[2];
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') return content.txt || content.text || '';
  return '';
}

function getMsgCodeRefs(msg) {
  const content = msg[2];
  if (!content || typeof content !== 'object') return [];
  const c = content.c;
  if (!c) return [];
  return Array.isArray(c) ? c : [c];
}

function updateMsgSelCount() {
  const checked = document.querySelectorAll('#msgSelList input[type=checkbox]:checked').length;
  const total   = document.querySelectorAll('#msgSelList input[type=checkbox]').length;
  const countEl = $('msgSelCount');
  if (countEl) countEl.textContent = checked + ' / ' + total + ' selected';
  const exportBtn = $('msgSelExport');
  if (exportBtn) {
    exportBtn.disabled = checked === 0;
    exportBtn.textContent = '⬇ Export ' + checked + ' message' + (checked !== 1 ? 's' : '');
  }
}

function updateComprLabel() {
  const el = $('msgSelComprLabel');
  if (!el) return;
  const compressed = (currentFormat === 'json' || currentFormat === 'csv');
  el.textContent = compressed ? '🗜 Token compression ON' : '📄 Full text (no compression)';
  el.style.color = compressed ? 'var(--green)' : 'var(--amber)';
}

function showMessageSelector(rawData) {
  _selRawData = rawData;
  const overlay = $('msgSelOverlay');
  const list    = $('msgSelList');
  if (!overlay || !list) { doFinalExport(rawData, null, currentFormat); return; }

  list.textContent = '';
  const messages = rawData.m || [];

  messages.forEach((msg, i) => {
    const isUser  = msg[0] === 'u';
    const rawText = getMsgText(msg).trim();
    const preview = rawText.length > 100 ? rawText.slice(0, 100) + '…' : (rawText || '(empty)');

    const item = document.createElement('label');
    item.className = 'mso-item';
    item.htmlFor   = 'mso-cb-' + i;

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.id = 'mso-cb-' + i;
    cb.checked = true; cb.dataset.idx = i;
    cb.addEventListener('change', updateMsgSelCount);

    const body     = document.createElement('div'); body.className = 'mso-item-body';
    const top      = document.createElement('div'); top.className = 'mso-item-top';
    const roleSpan = document.createElement('span');
    roleSpan.className = 'mso-item-role ' + (isUser ? 'role-u' : 'role-a');
    roleSpan.textContent = isUser ? 'You' : 'AI';
    const turnSpan = document.createElement('span');
    turnSpan.className = 'mso-item-turn';
    turnSpan.textContent = 'Turn ' + (i + 1);
    top.appendChild(roleSpan); top.appendChild(turnSpan);

    const prevEl = document.createElement('span');
    prevEl.className = 'mso-item-preview';
    prevEl.textContent = preview;

    body.appendChild(top); body.appendChild(prevEl);
    item.appendChild(cb); item.appendChild(body);
    list.appendChild(item);
  });

  // Sync overlay format picker with currentFormat
  document.querySelectorAll('.mso-fmt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mfmt === currentFormat);
  });
  updateMsgSelCount();
  updateComprLabel();
  overlay.style.display = 'flex';
}

function hideMessageSelector() {
  const overlay = $('msgSelOverlay');
  if (overlay) overlay.style.display = 'none';
  _selRawData = null;
}

// Wire overlay controls
document.addEventListener('DOMContentLoaded', () => {}, false);

$('msgSelBack') && $('msgSelBack').addEventListener('click', () => {
  hideMessageSelector();
  setStatus('Export cancelled — data still ready for "Continue on"', 'dim');
});

$('msgSelAll') && $('msgSelAll').addEventListener('click', () => {
  document.querySelectorAll('#msgSelList input[type=checkbox]').forEach(cb => { cb.checked = true; });
  updateMsgSelCount();
});

$('msgSelNone') && $('msgSelNone').addEventListener('click', () => {
  document.querySelectorAll('#msgSelList input[type=checkbox]').forEach(cb => { cb.checked = false; });
  updateMsgSelCount();
});

// Overlay format picker buttons
document.querySelectorAll('.mso-fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mso-fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.mfmt;
    // Sync top-level format bar
    document.querySelectorAll('.fmt-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.fmt === currentFormat);
    });
    updateComprLabel();
  });
});

$('msgSelExport') && $('msgSelExport').addEventListener('click', () => {
  if (!_selRawData) return;
  const checked = [...document.querySelectorAll('#msgSelList input[type=checkbox]:checked')];
  if (!checked.length) return;
  const selectedIndices = checked.map(cb => parseInt(cb.dataset.idx, 10));

  // If format needs compression and we fetched uncompressed (MD/PDF was selected before),
  // we may need to re-export. But for simplicity: use data as-is (it's still readable).
  doFinalExport(_selRawData, selectedIndices, currentFormat);
  hideMessageSelector();
});

// ── Format Converters ─────────────────────────────────────────────────────────
function buildFilteredData(data, selectedIndices) {
  if (!selectedIndices || selectedIndices.length === (data.m || []).length) return data;
  const idxSet = new Set(selectedIndices);
  return Object.assign({}, data, {
    m: (data.m || []).filter((_, i) => idxSet.has(i)),
    _selective: true,
    _selectedCount: selectedIndices.length,
  });
}

function convertToCSV(data) {
  const messages = data.m || [];
  const codeMap  = data.c || {};
  // BOM for Excel UTF-8 compat
  const rows = ['\uFEFFturn,role,content,has_code,has_attachments'];
  messages.forEach((msg, i) => {
    const role    = msg[0] === 'u' ? 'User' : 'Assistant';
    let   text    = getMsgText(msg);
    const codeRefs = getMsgCodeRefs(msg);
    if (codeRefs.length > 0) {
      codeRefs.forEach(cid => {
        const c = codeMap[cid];
        if (c) text += '\n```' + (c[0] || '') + '\n' + c[1] + '\n```';
      });
    }
    const content  = msg[2];
    const attRefs  = (content && typeof content === 'object' && content.a)
      ? (Array.isArray(content.a) ? content.a : [content.a]) : [];
    const escapeCsv = s => '"' + String(s).replace(/"/g, '""') + '"';
    rows.push([i + 1, role, escapeCsv(text), codeRefs.length > 0, attRefs.length > 0].join(','));
  });
  return rows.join('\n');
}

function convertToMarkdown(data) {
  const messages  = data.m || [];
  const codeMap   = data.c || {};
  const platform  = (data.p || 'AI');
  const chatTitle = (data.chatTitle || 'Chat Export').trim();
  const date      = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  const totalMsgs = messages.length;

  let md = `# ${chatTitle}\n\n`;
  md += `> **Platform:** ${platform}  ·  **Messages:** ${totalMsgs}  ·  **Exported:** ${date}\n\n`;
  md += `---\n\n`;

  messages.forEach((msg, i) => {
    const isUser   = msg[0] === 'u';
    const roleLabel = isUser ? '👤 You' : '🤖 Assistant';
    let   text     = getMsgText(msg);
    const codeRefs = getMsgCodeRefs(msg);
    let   codeSection = '';
    codeRefs.forEach(cid => {
      const c = codeMap[cid];
      if (c) codeSection += '\n\n```' + (c[0] || '') + '\n' + c[1] + '\n```';
    });

    md += `### Turn ${i + 1} — ${roleLabel}\n\n`;
    md += (text || '*(empty)*') + codeSection;
    md += '\n\n---\n\n';
  });

  md += `*Exported with [MKAI](https://github.com)*\n`;
  return md;
}

function downloadCSV(data, filename) {
  const csv  = convertToCSV(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'MKAI/' + filename, saveAs: false }, () => URL.revokeObjectURL(url));
}

function downloadMarkdown(data, filename) {
  const md   = convertToMarkdown(data);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'MKAI/' + filename, saveAs: false }, () => URL.revokeObjectURL(url));
}

function openPdfExport(data, baseName) {
  if (!isExtensionValid() || !chrome?.storage?.local) return;
  // Store data keyed by timestamp, then open pdf_preview.html
  const key = 'pdf_' + Date.now();
  chrome.storage.local.set({ [key]: { data, fname: baseName, ts: Date.now() } }, () => {
    if (!isExtensionValid() || chrome.runtime?.lastError) return;
    const previewUrl = chrome.runtime.getURL('pdf_preview.html') + '?key=' + encodeURIComponent(key);
    chrome.tabs.create({ url: previewUrl });
    // Clean up after 30s if page never loaded
    setTimeout(() => {
      if (isExtensionValid() && chrome?.storage?.local) chrome.storage.local.remove(key);
    }, 30000);
  });
}

function doFinalExport(data, selectedIndices, format) {
  const filtered  = buildFilteredData(data, selectedIndices);
  const baseName  = getFilename('').replace(/\.(json|csv|md|html|pdf)$/i, '');
  const attCount  = Object.keys(filtered.att || {}).length;
  const msgCount  = (filtered.m || []).length;

  let savedName;
  switch (format) {
    case 'csv':
      savedName = baseName + '.csv';
      downloadCSV(filtered, savedName);
      setStatus(savedName + ' saved · ' + msgCount + ' msgs (compressed)', 'ok');
      saveToRecent(lastData || filtered, baseName);
      break;
    case 'md':
      savedName = baseName + '.md';
      downloadMarkdown(filtered, savedName);
      setStatus(savedName + ' saved · ' + msgCount + ' msgs (full text)', 'ok');
      saveToRecent(lastData || filtered, baseName);
      break;
    case 'pdf':
      openPdfExport(filtered, baseName);
      setStatus('PDF preview opened — use File → Print → Save as PDF', 'ok');
      saveToRecent(lastData || filtered, baseName);
      break;
    default: { // json
      savedName = baseName + '.json';
      const exportData = finaliseExportData(filtered, $('openingPrompt')?.value?.trim() || '');
      downloadJSON(exportData, savedName);
      setStatus(savedName + ' saved · ' + msgCount + ' msgs' + (attCount ? ' · ' + attCount + ' att.' : ''), 'ok');
      saveToRecent(lastData || filtered, baseName);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSAI SEMANTIC SEARCH ENGINE v2.0
// ─────────────────────────────────────────────────────────────────────────────
// Powered by semanticSearch.js (BM25 + TF-IDF cosine + trigram fuzzy + MMR/RRF)
// and folderIndex.js (File System Access API + IndexedDB folder scanning).
//
// All existing functionality preserved. New capabilities:
//   • Searches ALL .json files in the ContextSwitchAI folder on your Desktop
//   • BM25 replaces basic TF scoring
//   • TF-IDF cosine similarity — vector-space topic matching
//   • Character trigram fuzzy matching — handles typos & morphological variants
//   • 500+ synonym relationships across 40 domains
//   • MMR for result diversity, RRF for multi-signal fusion
//   • Faceted filters: platform, has-code, date range
//   • Dual highlighting: exact (cyan) + synonym (amber)
// ═════════════════════════════════════════════════════════════════════════════

let _srchLib      = [];
let _folderLib    = [];
let _termStats    = null;
let _srchResults  = [];
let _srchSel      = new Set();
let _srchDebounce = null;
let _srchPlatform = 'claude';
let _srchFolderLinked = false;

const _activeFacets = { platform: 'all', hasCode: false, dateRange: null };

function loadLibrary(cb) {
  if (!isExtensionValid() || !chrome?.storage?.local) { if (typeof cb === 'function') cb([]); return; }
  try {
    chrome.storage.local.get('exportLibrary', d => {
      if (!isExtensionValid() || chrome.runtime?.lastError) { if (typeof cb === 'function') cb([]); return; }
      if (typeof cb === 'function') cb(Array.isArray(d?.exportLibrary) ? d.exportLibrary : []);
    });
  } catch (err) {
    if (typeof cb === 'function') cb([]);
  }
}

function updateLibCountBadge(n) {
  const b = $('libCountBadge'); if (b) b.textContent = n + ' indexed';
  const sb = $('srchLibBadge'); if (sb) sb.textContent = n + ' indexed';
}

async function _initFolderState() {
  if (!window.CSAI_FolderIndex) return;
  try {
    const stats = await CSAI_FolderIndex.getStats();
    _srchFolderLinked = stats.total > 0 || await CSAI_FolderIndex.hasFolder();
    _folderLib  = await CSAI_FolderIndex.getAllIndexed();
    _termStats  = await CSAI_FolderIndex.getTermStats();
    _updateFolderUI(stats);
    _refreshTotalBadge();
  } catch (e) { console.warn('[CSAI Search] FolderIndex init error:', e); }
}

function _updateFolderUI(stats) {
  const nameEl  = $('srchFolderName');
  const linkBtn = $('srchFolderBtn');
  const scanBtn = $('srchScanBtn');
  if (!nameEl || !linkBtn) return;
  if (stats && (stats.total > 0 || _srchFolderLinked)) {
    const fname = stats.folderName || 'MKAI';
    nameEl.textContent = '\u{1F4C1} ' + fname + '  \u00B7  ' + stats.total + ' files  \u00B7  ' + (stats.totalMsgs||0).toLocaleString() + ' turns';
    nameEl.classList.add('linked');
    linkBtn.textContent = '\u2715 Unlink'; linkBtn.classList.add('linked');
    linkBtn.title = 'Unlink folder and clear index';
    if (scanBtn) scanBtn.style.display = '';
  } else {
    nameEl.textContent = 'No folder linked \u2014 searching saved exports only';
    nameEl.classList.remove('linked');
    linkBtn.textContent = '\u{1F4C1} Link Folder'; linkBtn.classList.remove('linked');
    if (scanBtn) scanBtn.style.display = 'none';
  }
}

function _refreshTotalBadge() {
  updateLibCountBadge(_srchLib.length + _folderLib.length);
}

function _buildMergedLibrary() {
  const folderNames = new Set(_folderLib.map(f => f.fileName || ''));
  const dedupedLib = _srchLib.filter(entry => {
    const nm = entry.name || (entry.data && entry.data.chatTitle) || '';
    return !folderNames.has(nm + '.json') && !folderNames.has(nm);
  });
  return [...dedupedLib, ..._folderLib];
}

function _getFacetOptions() {
  const opts = {};
  if (_activeFacets.platform !== 'all') opts.platform = _activeFacets.platform;
  if (_activeFacets.hasCode)             opts.hasCode  = true;
  if (_activeFacets.dateRange) {
    const now = Date.now();
    opts.dateFrom = _activeFacets.dateRange === 'week' ? now - 7*24*3600000 : now - 30*24*3600000;
  }
  return Object.keys(opts).length ? opts : null;
}

function runSearch(query) {
  const hint = $('srchHint');
  const lib  = _buildMergedLibrary();
  if (!query.trim()) {
    renderSearchEmpty(lib.length === 0
      ? { ttl: 'Your export library is empty', sub: 'Export some chats first.' }
      : { ttl: 'Start typing to search', sub: lib.length + ' file' + (lib.length!==1?'s':'') + ' indexed \u2014 platform, topic, code, anything.' });
    if (hint) { hint.textContent = 'Type to search across all your indexed exports'; hint.classList.remove('live'); }
    return;
  }
  if (hint) { hint.textContent = 'Searching ' + lib.length + ' file' + (lib.length!==1?'s':'') + '\u2026'; hint.classList.add('live'); }

  if (window.CSAI_SemanticSearch) {
    _srchResults = CSAI_SemanticSearch.search(query, lib, {
      termStats: _termStats, facets: _getFacetOptions(),
      recencyHalfLife: 14, maxResults: 20, diversify: true,
    });
  } else {
    _srchResults = csaiSearchLegacy ? csaiSearchLegacy(query, lib) : [];
  }

  renderSearchResults(_srchResults);
  if (hint) {
    hint.textContent = _srchResults.length
      ? _srchResults.length + ' result' + (_srchResults.length!==1?'s':'') + ' \u2014 click to select, then load'
      : 'No matches found';
    hint.classList.remove('live');
  }
}

function renderSearchEmpty(opts) {
  const c = $('srchResults'); if (!c) return;
  c.innerHTML = '<div class="srch-empty-state"><div class="srch-empty-ico">\u{1F9E0}</div>' +
    '<div class="srch-empty-ttl">' + (opts.ttl||'No results') + '</div>' +
    '<div class="srch-empty-sub">' + (opts.sub||'') + '</div></div>';
  const f = $('srchFooter'); if (f) f.style.display = 'none';
}

function renderSearchResults(results) {
  const c = $('srchResults'); if (!c) return;
  if (!results.length) { renderSearchEmpty({ ttl: 'No matches found', sub: 'Try different words, shorter phrases, or remove a filter.' }); return; }

  const PLAT_COLORS = { claude:'#f5a050',chatgpt:'#10b981',gemini:'#818cf8',grok:'#aaa',deepseek:'#00c8ff',perplexity:'#c084fc',copilot:'#60a5fa',quark:'#00c8ff',doubao:'#fbbf24',postman:'#FF6C37',lmarena:'#f59e0b',unknown:'#888' };
  const PLAT_ICONS  = { claude:'\u{1F52E}',chatgpt:'\u{1F916}',gemini:'\u2728',grok:'\u26A1',deepseek:'\u{1F52C}',perplexity:'\u{1F310}',copilot:'\u{1FA9F}',quark:'\u{1F537}',doubao:'\u{1FAD8}',postman:'\u{1F47D}',lmarena:'\u2694\uFE0F' };

  const html = results.map(r => {
    const pct    = r.pct;
    const barCls = pct>=75?'bar-hi':pct>=45?'bar-mid':pct>=25?'bar-lo':'bar-dim';
    const pctCls = pct>=75?'pct-hi':pct>=45?'pct-mid':pct>=25?'pct-lo':'pct-dim';
    const plat   = r.platform || (r.entry&&r.entry.data&&r.entry.data.p) || 'unknown';
    const platClr= PLAT_COLORS[plat]||'#888';
    const platIco= PLAT_ICONS[plat]||'\u{1F916}';
    const date   = r.ts ? new Date(r.ts).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
    const turns  = (r.entry&&(r.entry.msgCount||(r.entry.data&&r.entry.data.m&&r.entry.data.m.length)))||0;
    const srcBdg = r.isFolder
      ? '<span class="srch-src-badge src-folder">\u{1F4C1} folder</span>'
      : '<span class="srch-src-badge src-lib">\u{1F4BE} lib</span>';
    const id     = (r.entry&&r.entry.id)||'';
    const sel    = _srchSel.has(id);
    const tags   = (r.matched||[]).slice(0,4).map(t=>'<span class="srch-match-tag">'+t+'</span>').join('');
    const qtIco  = r.queryType==='code'?'\u{1F4BB}':r.queryType==='debug'?'\u{1F41B}':r.queryType==='write'?'\u270D\uFE0F':'\u{1F50D}';
    return '<div class="srch-card'+(sel?' sel':'')+'" data-id="'+id+'">' +
      '<div class="srch-card-top"><div class="srch-bar-col">' +
      '<div class="srch-bar-track"><div class="srch-bar-fill '+barCls+'" style="width:'+pct+'%"></div></div>' +
      '<div class="srch-score-detail">'+qtIco+' '+(r.queryType||'general')+'  \u00B7  rank #'+(r.rank||'?')+'</div></div>' +
      '<span class="'+pctCls+' srch-pct">'+pct+'%</span>' +
      '<div class="srch-chk">'+(sel?'\u2713':'')+'</div></div>' +
      '<div class="srch-card-body">' +
      '<div class="srch-card-ttl">'+(r.title||'Untitled')+'</div>' +
      '<div class="srch-card-snip">'+(r.snipHtml||'')+'</div>' +
      '<div class="srch-card-meta">' +
      '<span class="srch-plat-badge" style="background:'+platClr+'22;border:1px solid '+platClr+'44;color:'+platClr+'">'+platIco+' '+plat+'</span>' +
      srcBdg+'<span class="srch-meta-txt">'+date+'</span><span class="srch-meta-txt">'+turns+' turns</span></div>' +
      (tags?'<div class="srch-match-tags">'+tags+'</div>':'') +
      '</div></div>';
  }).join('');

  c.innerHTML = html;
  c.querySelectorAll('.srch-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id; if (!id) return;
      if (_srchSel.has(id)) { _srchSel.delete(id); card.classList.remove('sel'); card.querySelector('.srch-chk').textContent=''; }
      else { _srchSel.add(id); card.classList.add('sel'); card.querySelector('.srch-chk').textContent='\u2713'; }
      updateSrchFooter();
    });
  });
  if ($('srchFooter')) $('srchFooter').style.display = _srchSel.size ? '' : 'none';
}

function updateSrchFooter() {
  const sel = _srchSel.size;
  if ($('srchSelCount')) $('srchSelCount').textContent = sel + ' selected';
  const selRes = _srchResults.filter(r => _srchSel.has((r.entry&&r.entry.id)||''));
  const turns  = selRes.reduce((s,r)=>s+(r.entry&&(r.entry.msgCount||(r.entry.data&&r.entry.data.m&&r.entry.data.m.length))||0),0);
  if ($('srchTurnsInfo')) $('srchTurnsInfo').textContent = turns + ' turns';
  const lb = $('srchLoadBtn');
  if (lb) { lb.disabled = sel===0; lb.textContent = sel>0 ? '\u{1F680} Load into '+(AI_DISPLAY_NAMES[_srchPlatform]||_srchPlatform) : '\u{1F680} Load'; }
  if ($('srchFooter')) $('srchFooter').style.display = sel>0 ? '' : 'none';
}

async function showSearchOverlay() {
  const overlay = $('srchOverlay'); if (!overlay) return;
  overlay.style.display = 'flex'; overlay.style.flexDirection = 'column';
  _srchSel.clear(); _srchResults = [];
  loadLibrary(lib => {
    _srchLib = lib; _refreshTotalBadge();
    const merged = _buildMergedLibrary();
    if (merged.length === 0) renderSearchEmpty({ ttl: 'Your export library is empty', sub: 'Export some chats first.' });
    else renderSearchEmpty({ ttl: 'Start typing to search', sub: merged.length + ' file' + (merged.length!==1?'s':'') + ' indexed \u2014 platform, topic, code, anything.' });
    const hint = $('srchHint'); if (hint) hint.textContent = 'Type to search across ' + merged.length + ' indexed file' + (merged.length!==1?'s':'');
    setTimeout(() => { const inp=$('srchInput'); if(inp) inp.focus(); }, 80);
  });
  await _initFolderState();
}

function hideSearchOverlay() {
  const overlay = $('srchOverlay'); if (overlay) overlay.style.display = 'none';
}

// ── Event wiring ─────────────────────────────────────────────────────────────
$('openSearchBtn') && $('openSearchBtn').addEventListener('click', showSearchOverlay);
$('srchBackBtn')   && $('srchBackBtn').addEventListener('click', hideSearchOverlay);

$('srchClearLibBtn') && $('srchClearLibBtn').addEventListener('click', () => {
  const total = _srchLib.length + _folderLib.length;
  if (!confirm('Clear all ' + total + ' entries from your search library? (Your Desktop folder and downloaded files are unaffected.)')) return;
  if (!isExtensionValid() || !chrome?.storage?.local) return;
  chrome.storage.local.remove('exportLibrary', async () => {
    if (!isExtensionValid()) return;
    _srchLib = [];
    if (window.CSAI_FolderIndex) { await CSAI_FolderIndex.clearIndex(); _folderLib=[]; _termStats=null; _updateFolderUI({total:0}); }
    _refreshTotalBadge();
    renderSearchEmpty({ ttl: 'Library cleared', sub: 'Export some chats to rebuild your library.' });
    if ($('srchFooter')) $('srchFooter').style.display = 'none';
  });
});

$('srchXBtn') && $('srchXBtn').addEventListener('click', () => {
  const inp=$('srchInput'); if(inp){inp.value='';inp.focus();}
  $('srchXBtn').style.display='none'; runSearch('');
});

$('srchInput') && $('srchInput').addEventListener('input', e => {
  $('srchXBtn').style.display = e.target.value ? '' : 'none';
  clearTimeout(_srchDebounce);
  _srchDebounce = setTimeout(() => runSearch(e.target.value), 220);
});

$('srchInput') && $('srchInput').addEventListener('keydown', e => { if(e.key==='Escape') hideSearchOverlay(); });

$('srchFolderBtn') && $('srchFolderBtn').addEventListener('click', async () => {
  if (!window.CSAI_FolderIndex) return;
  const btn = $('srchFolderBtn');

  // ── Inside the FAB iframe: showDirectoryPicker is blocked by the browser.
  // Set a flag in storage so the main popup picks it up and auto-triggers the picker.
  if (IS_PANEL && !btn.classList.contains('linked')) {
    const nameEl = $('srchFolderName');
    if (nameEl) {
      nameEl.textContent = '📌 Opening main popup to link folder…';
      nameEl.style.color = 'var(--amber)';
      setTimeout(() => { nameEl.style.color = ''; nameEl.textContent = 'No folder linked — link from the main popup'; }, 4000);
    }
    // Signal the main popup to open search + auto-click Link Folder
    if (isExtensionValid() && chrome?.storage?.local) {
      chrome.storage.local.set({ csai_openFolderPicker: true });
      chrome.runtime.sendMessage({ action: 'OPEN_POPUP' });
    }
    return;
  }

  if (btn.classList.contains('linked')) {
    if (!confirm('Unlink folder and clear all indexed entries from it?')) return;
    await CSAI_FolderIndex.forgetFolder(); _folderLib=[]; _termStats=null; _srchFolderLinked=false;
    _updateFolderUI({total:0}); _refreshTotalBadge();
    const q=$('srchInput')?.value||'';
    if(q) runSearch(q); else renderSearchEmpty({ttl:'Folder unlinked',sub:'Your saved exports are still searchable.'});
    return;
  }
  btn.textContent='\u2026picking'; btn.disabled=true;
  try {
    await CSAI_FolderIndex.requestFolder();
    btn.textContent='\u21BB Scanning\u2026'; btn.classList.add('scanning');
    const { added, updated, total, error } = await CSAI_FolderIndex.scanAndIndex(n => { if(btn) btn.textContent='\u21BB '+n+' scanned\u2026'; });
    if (error) { btn.textContent='\u{1F4C1} Link Folder'; btn.disabled=false; btn.classList.remove('scanning'); alert('Scan error: '+error); return; }
    _folderLib=await CSAI_FolderIndex.getAllIndexed(); _termStats=await CSAI_FolderIndex.getTermStats();
    _srchFolderLinked=true; const stats=await CSAI_FolderIndex.getStats();
    _updateFolderUI(stats); _refreshTotalBadge();
    const q=$('srchInput')?.value||'';
    if(q) runSearch(q); else renderSearchEmpty({ttl:'Folder linked!', sub:total+' files indexed ('+added+' new, '+updated+' updated). Start typing to search.'});
  } catch(e) {
    if(e.name!=='AbortError') alert('Could not link folder: '+e.message);
    btn.textContent='\u{1F4C1} Link Folder'; btn.classList.remove('scanning','linked');
  } finally { btn.disabled=false; }
});

$('srchScanBtn') && $('srchScanBtn').addEventListener('click', async () => {
  if (!window.CSAI_FolderIndex) return;
  const btn=$('srchScanBtn'); const orig=btn.textContent;
  btn.textContent='\u21BB Scanning\u2026'; btn.disabled=true;
  const { added, updated, removed, error } = await CSAI_FolderIndex.scanAndIndex(n=>{ btn.textContent='\u21BB '+n+'\u2026'; });
  btn.disabled=false; btn.textContent=orig;
  if (error) { alert('Scan error: '+error); return; }
  _folderLib=await CSAI_FolderIndex.getAllIndexed(); _termStats=await CSAI_FolderIndex.getTermStats();
  const stats=await CSAI_FolderIndex.getStats(); _updateFolderUI(stats); _refreshTotalBadge();
  const q=$('srchInput')?.value||''; if(q) runSearch(q);
  const hint=$('srchHint');
  if(hint){ hint.textContent='Scan complete \u2014 '+added+' new, '+updated+' updated, '+removed+' removed'; hint.classList.add('live');
    setTimeout(()=>{ hint.textContent=q?_srchResults.length+' results':_buildMergedLibrary().length+' files indexed'; hint.classList.remove('live'); },2500); }
});

document.querySelectorAll('.srch-facet').forEach(btn => {
  btn.addEventListener('click', () => {
    const facet=btn.dataset.facet; const val=btn.dataset.val;
    if (facet==='platform') {
      document.querySelectorAll('.srch-facet[data-facet="platform"]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); _activeFacets.platform=val;
    } else if (facet==='hasCode') {
      _activeFacets.hasCode=btn.classList.toggle('active');
    } else if (facet==='dateRange') {
      const wasActive=btn.classList.contains('active');
      document.querySelectorAll('.srch-facet[data-facet="dateRange"]').forEach(b=>b.classList.remove('active'));
      if(!wasActive){ btn.classList.add('active'); _activeFacets.dateRange=val; } else _activeFacets.dateRange=null;
    }
    const q=$('srchInput')?.value||''; if(q) runSearch(q);
  });
});

document.querySelectorAll('.srch-plat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.srch-plat-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); _srchPlatform=btn.dataset.sp; updateSrchFooter();
  });
});

$('srchLoadBtn') && $('srchLoadBtn').addEventListener('click', () => {
  if (!_srchSel.size) return;
  const allEntries=_buildMergedLibrary();
  const eMap=new Map();
  for (const e of allEntries) {
    const normed = window.CSAI_SemanticSearch ? CSAI_SemanticSearch._normaliseEntry(e) : e;
    eMap.set(normed.id||e.name||'', e);
  }
  const selected=_srchResults.filter(r=>_srchSel.has((r.entry&&r.entry.id)||'')).map(r=>eMap.get((r.entry&&r.entry.id)||'')||r.entry).filter(Boolean);
  if(!selected.length) return;
  const query=($('srchInput')?.value||'').trim();
  const merged=mergeForUpload(selected,query);
  try { validateCCMF(merged); } catch(e){ setError('Merge failed: '+e.message,'search'); return; }
  lastData=merged;
  chrome.runtime.sendMessage({action:'STORE_DATA',data:merged},()=>{
    chrome.runtime.sendMessage({action:'CONTINUE_ON',platform:_srchPlatform},res=>{
      if(!res?.ok) setError(res?.error||'Could not open '+_srchPlatform,'search');
      else setStatus('Opening '+AI_DISPLAY_NAMES[_srchPlatform]+' with '+selected.length+' session'+(selected.length!==1?'s':'')+' loaded\u2026','ok');
    });
  });
  hideSearchOverlay();
});


// ── MULTI-SESSION MERGE ────────────────────────────────────────────────────────
function mergeForUpload(entries, query) {
  const allMsgs = [];
  const codeMap = {};
  const attMap  = {};
  let   cIdx    = 0;

  entries.forEach((entry, si) => {
    const data = entry.data || {};
    const msgs = data.m || [];
    const srcC = data.c || {};
    const srcA = data.att || {};

    const divTxt =
      '\n' + '\u2550'.repeat(52) + '\n' +
      'SESSION ' + (si+1) + '/' + entries.length + '  \u00B7  ' + (data.p||'AI').toUpperCase() + '  \u00B7  ' +
      (data.chatTitle || entry.name || entry.chatTitle || 'Chat') + '\n' +
      msgs.length + ' turns  \u00B7  ' +
      new Date(entry.ts||Date.now()).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) + '\n' +
      '\u2550'.repeat(52) + '\n';
    allMsgs.push(['u', '__div'+si, { txt: divTxt }]);

    const cRemap = {};
    for (const [cid, val] of Object.entries(srcC)) {
      const nid = 'c'+cIdx++;
      cRemap[cid] = nid;
      codeMap[nid] = val;
    }
    const aRemap = {};
    for (const [aid, val] of Object.entries(srcA)) {
      const nid = 'f'+si+'_'+aid;
      aRemap[aid] = nid;
      attMap[nid] = val;
    }

    for (const [role, tid, content] of msgs) {
      let nc = content;
      if (content && typeof content === 'object') {
        nc = Object.assign({}, content);
        if (content.c) {
          const refs = Array.isArray(content.c) ? content.c : [content.c];
          const re2  = refs.map(r => cRemap[r] || r);
          nc.c = re2.length === 1 ? re2[0] : re2;
        }
        if (content.a) {
          const refs = Array.isArray(content.a) ? content.a : [content.a];
          nc.a = refs.map(r => aRemap[r] || r);
        }
      }
      allMsgs.push([role, 's'+si+'_'+tid, nc]);
    }
  });

  const totalTurns = entries.reduce((s,e) => s + ((e.data?.m?.length)||0), 0);
  const preamble = [
    '=== MKAI \u2014 MULTI-SESSION CONTEXT BUNDLE ===',
    'Query: "' + query + '"',
    'Sessions: ' + entries.length + '  |  Total turns: ' + totalTurns + '  |  Generated: ' + new Date().toISOString().slice(0,10),
    '',
    'INSTRUCTIONS: This file bundles multiple AI conversation sessions',
    'relevant to the query "' + query + '". Each session is separated by a',
    'divider header. Read all sessions, then help me continue from where',
    'I left off \u2014 synthesizing knowledge across all sessions as needed.',
    '',
    'SESSIONS INCLUDED:',
    ...entries.map((e,i) => {
      const d = e.data||{};
      return '  ' + (i+1) + '. [' + ((d.p||'AI').toUpperCase()) + '] ' + (d.chatTitle||e.name||e.chatTitle||'Untitled') + ' \u2014 ' + ((d.m||[]).length) + ' turns';
    }),
  ].join('\n');

  return {
    v: 2, p: 'claude',
    m: allMsgs, c: codeMap, att: attMap,
    chatTitle : 'Context: "' + query + '" (' + entries.length + ' sessions)',
    _context  : preamble,
    _multiCtx : true, _query: query, _sessionCount: entries.length,
    tokenStats: {
      rawChatTokens: totalTurns * 80,
      compressedTokens: totalTurns * 80,
      reductionPercent: 0,
      note: 'Multi-session bundle \u2014 ' + entries.length + ' chats merged',
    },
  };
}

// Init library badge on startup
loadLibrary(lib => {
  _srchLib = lib;
  _initFolderState().then(() => _refreshTotalBadge());
});


// ── ZIP Export ───────────────────────────────────────────────────────────────
$('zipBtn').onclick = async () => {
  if (!lastData) { setError('Export a chat first', 'zip'); return; }
  const btn = $('zipBtn');
  btn.disabled = true;
  setStatus('Fetching images…', 'dim');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { setError('No active tab', 'zip'); btn.disabled = false; return; }

  chrome.tabs.sendMessage(tab.id, { action: 'BUILD_ZIP' }, (res) => {
    btn.disabled = false;
    if (chrome.runtime.lastError) { setError(chrome.runtime.lastError.message || 'ZIP failed', 'zip'); return; }
    if (!res?.ok) { setError(res?.error || 'Could not build ZIP', 'zip'); return; }
    const binary = atob(res.b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url  = URL.createObjectURL(blob);
    const fn   = getFilename('.zip');
    chrome.downloads.download({ url, filename: 'MKAI/' + fn, saveAs: false }, () => URL.revokeObjectURL(url));
    setStatus(fn + ' saved · ' + res.imageCount + ' image(s) + manifest.txt', 'ok');
  });
};

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'MKAI/' + filename, saveAs: false }, () => URL.revokeObjectURL(url));
}

// ── Load & Switch — with recent history + clipboard copy ────────────────────
// Loads a .json export, shows it in a recent-files list, opens Continue panel.
// Also adds a "Copy to clipboard" button — useful for AIs that block auto-upload.

const MAX_RECENT = 5;
const MAX_LIBRARY = 50;

// ── Export Library (persists up to 50 exports for Smart Search) ───────────────
function saveToLibrary(data, fileName) {
  if (!isExtensionValid() || !chrome?.storage?.local) return;
  try {
    chrome.storage.local.get('exportLibrary', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      try {
        const lib = Array.isArray(res?.exportLibrary) ? res.exportLibrary : [];
        const now = Date.now();
        const entry = {
          id       : 'lib_' + now + '_' + (Math.random() * 1e6 | 0),
          name     : fileName,
          platform : data?.p || '?',
          chatTitle: (data?.chatTitle || '').slice(0, 80),
          msgs     : (data?.m || []).length,
          ts       : now,
          data     : data,
        };
        // Deduplicate: same platform + title + msgCount within 30s = same export
        const isDupe = lib.some(r =>
          r &&
          r.platform === entry.platform &&
          r.chatTitle === entry.chatTitle &&
          r.msgs === entry.msgs &&
          Math.abs((r.ts || 0) - now) < 30000
        );
        if (isDupe) return;
        lib.unshift(entry);
        const trimmed = lib.slice(0, MAX_LIBRARY);
        chrome.storage.local.set({ exportLibrary: trimmed }, () => {
          if (!isExtensionValid() || chrome.runtime?.lastError) {
            // Quota hit — trim more aggressively and retry with half the entries
            console.warn('[CSAI] Library quota exceeded, trimming to', Math.floor(trimmed.length / 2), 'entries');
            const emergency = trimmed.slice(0, Math.max(Math.floor(trimmed.length / 2), 5));
            if (isExtensionValid()) {
              chrome.storage.local.set({ exportLibrary: emergency }, () => {
                if (isExtensionValid()) updateLibCountBadge(emergency.length);
              });
            }
            return;
          }
          if (isExtensionValid()) updateLibCountBadge(trimmed.length);
        });
      } catch (e) {
        console.warn('[MKAI] Error in saveToLibrary inner:', e);
      }
    });
  } catch (err) {
    console.warn('[MKAI] Exception in saveToLibrary:', err);
  }
}

function loadLibrary(cb) {
  if (!isExtensionValid() || !chrome?.storage?.local) { if (typeof cb === 'function') cb([]); return; }
  try {
    chrome.storage.local.get('exportLibrary', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) { if (typeof cb === 'function') cb([]); return; }
      if (typeof cb === 'function') cb(Array.isArray(res?.exportLibrary) ? res.exportLibrary : []);
    });
  } catch (err) {
    if (typeof cb === 'function') cb([]);
  }
}

function updateLibCountBadge(count) {
  const b1 = $('libCountBadge');
  const b2 = $('srchLibBadge');
  const label = count + ' saved';
  if (b1) b1.textContent = label;
  if (b2) b2.textContent = label;
}

function saveToRecent(data, fileName) {
  if (!isExtensionValid() || !chrome?.storage?.local) return;
  try {
    saveToLibrary(data, fileName); // also persist to searchable library
    chrome.storage.local.get('recentFiles', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      try {
        const list = (res && Array.isArray(res.recentFiles)) ? res.recentFiles : [];
        const now = Date.now();
        const entry = {
          name     : fileName,
          platform : data?.p || '?',
          msgs     : (data?.m || []).length,
          chatTitle: (data?.chatTitle || '').slice(0, 60),
          ts       : now,
          data     : data,
        };
        // Only dedup if this exact same export was added within the last 10 seconds
        const isDuplicate = list.some(r =>
          r &&
          r.platform === entry.platform &&
          (r.chatTitle || '') === (entry.chatTitle || '') &&
          r.msgs === entry.msgs &&
          Math.abs((r.ts || 0) - now) < 10000
        );
        if (isDuplicate) return; // silently skip the redundant save
        list.unshift(entry);
        const trimmed = list.slice(0, MAX_RECENT);
        chrome.storage.local.set({ recentFiles: trimmed });
      } catch (err) {
        console.warn('[MKAI] Error in saveToRecent:', err);
      }
    });
  } catch (e) {
    console.warn('[MKAI] Exception in saveToRecent:', e);
  }
}

function renderRecentFiles(list) {
  if (!isExtensionValid()) return;
  try {
    const panel = $('recentPanel');
    const ul    = $('recentList');
    const clearBtn = $('clearRecentBtn');
    if (!panel || !ul) return;
    if (!Array.isArray(list) || list.length === 0) {
      ul.textContent = '';
      panel.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    panel.style.display = 'block'; // auto-open — no manual toggle needed
    if (clearBtn) clearBtn.style.display = 'inline-block';
    ul.textContent = '';
    list.forEach((entry, i) => {
      if (!isExtensionValid() || !entry || typeof entry !== 'object') return;
      const li   = document.createElement('div');
      li.className = 'recent-item';
      // SECURITY: build with DOM API — no innerHTML on user-controlled data
      const age    = Math.round((Date.now() - (entry.ts || 0)) / 60000);
      const ageStr = age < 60 ? age + 'm ago' : age < 1440 ? Math.round(age/60) + 'h ago'
        : Math.round(age/1440) + 'd ago';

      const platform = (typeof entry.platform === 'string' ? entry.platform : '?').slice(0, 12);
      const icon = document.createElement('span');
      icon.className = 'recent-icon ri-' + platform.toLowerCase();
      icon.textContent = platform.slice(0,1).toUpperCase();

      const meta   = document.createElement('span'); meta.className = 'recent-meta';
      const nname  = document.createElement('span'); nname.className = 'recent-name';
      nname.textContent = (typeof entry.name === 'string' ? entry.name : 'export').replace(/\.json$/i,'');
      const detail = document.createElement('span'); detail.className = 'recent-detail';
      detail.textContent = (typeof entry.msgs === 'number' ? entry.msgs : 0) + ' msgs · ' + ageStr;
      meta.appendChild(nname); meta.appendChild(detail);

      // ── Button 1: Load into state for use with "Continue on" ──
      const loadBtn = document.createElement('button');
      loadBtn.className = 'recent-load';
      loadBtn.title = 'Load chat — then use Continue on to send to any AI';
      loadBtn.textContent = '↗ Load';
      loadBtn.addEventListener('click', () => {
        if (!isExtensionValid()) return;
        handleLoadedData(entry.data, entry.name, true);
      });

      // ── Button 2: Inject directly into the current AI tab ──
      const injectBtn = document.createElement('button');
      injectBtn.className = 'recent-inject';
      injectBtn.title = 'Inject directly into the AI tab you have open';
      injectBtn.textContent = '⤵ Inject';
      injectBtn.addEventListener('click', async () => {
        if (!isExtensionValid()) return;
        lastData = entry.data;
        const prompt = $('lcmPromptInput')?.value?.trim().slice(0, 1000) || $('openingPrompt')?.value?.trim().slice(0, 1000) || entry.data?._openingPrompt || '';
        if ($('openingPrompt') && prompt) $('openingPrompt').value = prompt;
        const exportData = finaliseExportData(entry.data, prompt);
        chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, async () => {
          if (!isExtensionValid() || chrome.runtime?.lastError) return;
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) { setStatus('No active tab found', 'err'); return; }
            let host = '';
            try { host = new URL(tab.url).hostname; } catch(e) {}
            const currentPlatform = Object.entries(HOST_PLATFORM).find(
              ([k]) => host === k || host.endsWith('.' + k)
            )?.[1];
            if (currentPlatform) {
              chrome.tabs.sendMessage(tab.id, { action: 'INJECT_CONTINUATION', platform: currentPlatform }, (res) => {
                if (!isExtensionValid()) return;
                if (!chrome.runtime?.lastError && res?.ok) {
                  setStatus('Injected into ' + currentPlatform + ' ✓', 'ok');
                } else {
                  setError('Could not inject — try refreshing the AI page', 'inject');
                }
              });
            } else {
              setError('Not on a supported AI page — open ChatGPT, Claude, Gemini, LM Arena, Postman first', 'inject');
            }
          } catch (e) {
            console.warn('[MKAI] Inject exception:', e);
          }
        });
      });

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'recent-actions';
      actionsWrap.appendChild(loadBtn);
      actionsWrap.appendChild(injectBtn);

      // ── Button 3: Share this export ──
      const shareBtn = document.createElement('button');
      shareBtn.className = 'recent-inject recent-share';
      shareBtn.title = 'Share this export';
      shareBtn.textContent = '↗ Share';
      shareBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!isExtensionValid()) return;
        openShareMenu(shareBtn, entry);
      });
      actionsWrap.appendChild(shareBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'recent-del'; delBtn.title = 'Remove from history';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (!isExtensionValid()) return;
        try {
          if (!chrome?.storage?.local) {
            console.warn('[MKAI] Storage not available');
            return;
          }
          chrome.storage.local.get('recentFiles', (r) => {
            if (!isExtensionValid() || chrome.runtime?.lastError) {
              console.warn('[MKAI] Storage error:', chrome.runtime?.lastError?.message);
              return;
            }
            try {
              const current = (r && Array.isArray(r.recentFiles)) ? r.recentFiles : [];
              const targetTs = entry.ts;
              const updated = current.filter((item, j) => {
                if (targetTs && item?.ts) return item.ts !== targetTs;
                return j !== i;
              });
              chrome.storage.local.set({ recentFiles: updated }, () => {
                if (!isExtensionValid() || chrome.runtime?.lastError) return;
                renderRecentFiles(updated);
              });
            } catch (err) {
              console.warn('[MKAI] Error removing recent file:', err);
            }
          });
        } catch (e) {
          console.warn('[MKAI] Error in delBtn handler:', e);
        }
      });

      li.appendChild(icon); li.appendChild(meta); li.appendChild(actionsWrap); li.appendChild(delBtn);
      ul.appendChild(li);
    });
  } catch (err) {
    console.warn('[MKAI] Error rendering recent files:', err);
  }
}

function loadRecentFiles() {
  if (!isExtensionValid() || !chrome?.storage?.local) return;
  try {
    chrome.storage.local.get('recentFiles', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      try {
        if (res && Array.isArray(res.recentFiles) && res.recentFiles.length > 0) {
          renderRecentFiles(res.recentFiles);
        }
      } catch (err) {
        console.warn('[MKAI] Error loading recent files:', err);
      }
    });
  } catch (e) {
    console.warn('[MKAI] Exception in loadRecentFiles:', e);
  }
}

function handleLoadedData(data, sourceName, skipRecent = false) {
  if (!data || typeof data !== 'object') {
    setError('Invalid chat data', 'load');
    return;
  }
  try { validateCCMF(data); } catch(err) { setError(err.message, 'load'); return; }

  lastData = data;
  if (Array.isArray(data.notes)) { notes = data.notes.slice(0, 100); saveNotes(); renderNotes(); }

  let rawName = '';
  if (typeof sourceName === 'string' && sourceName.trim() && !/^export(\.json)?$/i.test(sourceName.trim())) {
    rawName = sourceName.trim();
  } else {
    rawName = buildSmartFilename(data);
  }

  const safeName = String(rawName || 'Chat')
    .replace(/\.(json|zip)$/i, '')
    .replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    .slice(0, 80) || 'Chat';

  const fnInput = $('fileNameInput');
  if (fnInput) fnInput.value = safeName;

  if (data._openingPrompt) {
    const pInput = $('openingPrompt');
    if (pInput) pInput.value = data._openingPrompt;
    const lcmInput = $('lcmPromptInput');
    if (lcmInput) lcmInput.value = data._openingPrompt;
  }

  chrome.runtime.sendMessage({ action: 'STORE_DATA', data });
  showStats(data);
  enableAIButtons(data);
  if (!skipRecent) saveToRecent(data, safeName);

  // Flash load button green
  const wrap = $('importWrap');
  if (wrap) { wrap.classList.add('loaded'); setTimeout(() => wrap.classList.remove('loaded'), 2000); }

  // Show clipboard copy button
  const copyBtn = $('copyJsonBtn');
  if (copyBtn) copyBtn.style.display = 'inline-flex';

  const src = data.p || 'unknown';
  setStatus('Loaded · ' + (data.m||[]).length + ' msgs from ' + src + ' — pick a platform below', 'ok');

  // Show quick-action bar and open the continue modal
  showLoadedShareBar(data, safeName);
  openLoadContinueModal(data, safeName);
}

// Clipboard copy — paste the JSON manually into any AI chat
// Uses execCommand fallback so it works inside the iframe overlay
// (navigator.clipboard is blocked by Permissions-Policy in cross-origin iframes)
function copyTextToClipboard(text) {
  // Try modern API first (works in standalone popup window)
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => {
      return copyViaExecCommand(text);
    });
  }
  return Promise.resolve(copyViaExecCommand(text));
}
function copyViaExecCommand(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch(e) { return false; }
}

$('copyJsonBtn') && ($('copyJsonBtn').onclick = async () => {
  if (!lastData) { setError('No data to copy', 'copy'); return; }
  try {
    const text = JSON.stringify(finaliseExportData(lastData, $('openingPrompt').value.trim()), null, 2);
    const ok = await copyTextToClipboard(text);
    if (!ok) throw new Error('copy returned false');
    const btn = $('copyJsonBtn');
    const prev = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = prev; }, 1800);
  } catch(e) { setError('Clipboard copy failed — try exporting first', 'copy'); }
});

// ── Import any file → inject into current tab's AI input ────────────────────
const importAnyBtn   = $('importAnyBtn');
const importAnyInput = $('importAnyInput');

if (importAnyBtn && importAnyInput) {
  importAnyBtn.addEventListener('click', () => importAnyInput.click());
  importAnyInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importAnyInput.value = '';
    if (file.size > 20 * 1024 * 1024) { setError('File too large (max 20 MB)', 'import'); return; }
    setStatus('Injecting ' + file.name + '…', 'dim');

    // Read as base64
    const b64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = ev => { const r = ev.target.result; const i = r.indexOf(','); res(i>=0?r.slice(i+1):r); };
      reader.onerror = () => rej(new Error('read error'));
      reader.readAsDataURL(file);
    }).catch(err => { setError(err.message, 'import'); return null; });
    if (!b64) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setError('No active tab', 'import'); return; }

    chrome.tabs.sendMessage(tab.id, {
      action: 'INJECT_RAW_FILE',
      b64,
      fileName: file.name,
      // Restrict MIME type to safe list to prevent type-confusion attacks
      mimeType: /^(text\/|image\/|application\/(json|pdf|zip|octet-stream))/.test(file.type) ? file.type : 'application/octet-stream',
    }, res => {
      if (chrome.runtime.lastError) { setError(chrome.runtime.lastError.message, 'import'); return; }
      if (res?.ok) setStatus(file.name + ' injected into ' + (tab.url ? new URL(tab.url).hostname : 'page'), 'ok');
      else setError(res?.error || 'Injection failed', 'import');
    });
  });
}

$('jsonFileInput').onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setError('file too large', 'load'); e.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      handleLoadedData(data, file.name);
    } catch(err) { setError(err.message || 'Invalid JSON file', 'load'); }
  };
  reader.readAsText(file);
  e.target.value = '';
};

// ── Context panel toggle (Notes & Prompt inside Continue on) ────────────────
const contextToggleBtn = $('contextToggleBtn');
if (contextToggleBtn) {
  contextToggleBtn.addEventListener('click', () => {
    const panel  = $('contextPanel');
    const isOpen = panel.style.display === 'block';
    panel.style.display = isOpen ? 'none' : 'block';
    contextToggleBtn.classList.toggle('active', !isOpen);
    if (!isOpen) {
      // Auto-fill noteInput with any selected text on page
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) return;
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, func: () => window.getSelection()?.toString().trim().slice(0, 500) || '' },
          (results) => {
            const sel = results?.[0]?.result;
            if (sel && sel.length > 3) $('noteInput').value = sel;
          }
        );
      });
    }
  });
}

// ── AI grid buttons (unified — passes notes + opening prompt) ────────────────
document.querySelectorAll('.ai-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const platform = btn.dataset.platform;
    if (!ALLOWED_PLATFORMS.has(platform)) return;

    function doOpen(data) {
      const prompt = $('openingPrompt')?.value?.trim().slice(0, 1000) || data._openingPrompt || '';
      const exportData = finaliseExportData(data, prompt);
      chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, () => {
        chrome.runtime.sendMessage({ action: 'CONTINUE_ON', platform }, (res) => {
          if (!res?.ok) setError(res?.error || 'Could not connect to ' + platform, 'open');
          else if (res?.reusedTab) setStatus('Injected into open ' + platform + ' tab ✓', 'ok');
          else setStatus('Opening ' + platform + ' — memory file attaching…', 'ok');
        });
      });
    }

    if (lastData) {
      doOpen(lastData);
    } else {
      chrome.storage.local.get('ccmf', (res) => {
        if (!res.ccmf || typeof res.ccmf !== 'object') {
          setError('No exported chat found — please Export Chat first', 'open'); return;
        }
        try { validateCCMF(res.ccmf); lastData = res.ccmf; doOpen(res.ccmf); }
        catch(e) { setError('Stored data is invalid — please Export Chat again', 'open'); }
      });
    }
  });
});

// ── Download attachments ─────────────────────────────────────────────────────
$('dlBtn').onclick = async () => {
  if (!lastData?.att) return;
  const entries = Object.entries(lastData.att).filter(([, v]) => v.downloadable && safeDownloadUrl(v.url));
  if (!entries.length) { setStatus('No downloadable attachments found.', 'dim'); return; }
  setStatus('Downloading ' + entries.length + ' file(s)…', 'dim');
  let ok = 0;
  for (const [id, att] of entries) {
    const safeUrl = safeDownloadUrl(att.url);
    if (!safeUrl) continue;
    try {
      const raw = (att.name || id).replace(/[/\\:*?"<>|]/g, '_').slice(0, 120);
      const ext = raw.includes('.') ? '' : (att.type === 'image' ? '.png' : '');
      await chrome.downloads.download({ url: safeUrl, filename: 'MKAI/attachments/' + raw + ext, saveAs: false });
      ok++;
    } catch(err) { console.warn('[LLM-Exporter] Download failed:', err); }
  }
  if (ok > 0) setStatus(ok + ' download(s) started', 'ok');
  else setError('Download failed — these files may need an active login session', 'download');
};

// ── Notes ─────────────────────────────────────────────────────────────────────
$('noteAddBtn').onclick = addNote;
$('noteInput').addEventListener('keydown', e => { if (e.key === 'Enter') addNote(); });

function addNote() {
  const text = $('noteInput').value.trim().slice(0, 500);
  if (!text) return;
  notes.push({ text, ts: new Date().toISOString() });
  saveNotes(); renderNotes();
  $('noteInput').value = '';
  if (lastData) $('statNotes').textContent = notes.length;
}

function saveNotes() {
  chrome.storage.local.set({ notes });
  if (lastData) {
    lastData = finaliseExportData(lastData, (lastData._openingPrompt || ''));
    chrome.runtime.sendMessage({ action: 'STORE_DATA', data: lastData });
  }
}

function renderNotes() {
  const list = $('notesList');
  list.textContent = '';
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'note-empty';
    empty.textContent = 'No notes yet. Select text on the page, open Continue, then click Add.';
    list.appendChild(empty); return;
  }
  notes.forEach((note, i) => {
    const item      = document.createElement('div'); item.className = 'note-item';
    const textWrap  = document.createElement('div'); textWrap.className = 'note-txt';
    textWrap.textContent = note.text;
    if (note.ts) {
      const dateEl = document.createElement('span'); dateEl.className = 'note-date';
      dateEl.textContent = new Date(note.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      textWrap.appendChild(dateEl);
    }
    const del = document.createElement('button');
    del.className = 'note-del'; del.textContent = '✕'; del.title = 'Remove'; del.dataset.idx = i;
    del.onclick = () => {
      notes.splice(Number(del.dataset.idx), 1);
      saveNotes(); renderNotes();
      if (lastData) $('statNotes').textContent = notes.length;
    };
    item.appendChild(textWrap); item.appendChild(del); list.appendChild(item);
  });
}

// ── Reset ────────────────────────────────────────────────────────────────────
function resetUI() {
  lastData = null;
  chrome.storage.local.remove(['ccmf', 'rlModalSeen']);
  $('stats').style.display         = 'none';
  $('tokenRow').style.display      = 'none';
  $('actionRow').style.display     = 'none';
  $('resetBtn').style.display      = 'none';
  $('attPanel').style.display      = 'none';
  // Re-show the attachment stat row so it's visible next export
  const attRow = $('statAttRow');
  if (attRow) attRow.style.display = '';
  const ctxPanel = $('contextPanel');
  if (ctxPanel) ctxPanel.style.display = 'none';
  const ctxBtn = $('contextToggleBtn');
  if (ctxBtn) ctxBtn.classList.remove('active');
  document.querySelectorAll('.ai-btn').forEach(btn => btn.classList.remove('ready'));
  $('fileNameInput').value = ''; $('openingPrompt').value = '';
  const cpb = $('copyJsonBtn'); if (cpb) cpb.style.display = 'none';
  setStatus('');
}
$('resetBtn').onclick = resetUI;


// ── Rate Limit Modal ─────────────────────────────────────────────────────────
function showRateLimitModal(host) {
  const modal = $('rlModal');
  if (!modal) return;
  // Update body text with the host that hit the limit
  const body = $('rlModalBody');
  if (body && host) {
    body.textContent = 'You\'ve hit the usage limit on ' + host + '. Continue your conversation on another AI below — your memory export will auto-attach.';
  }
  modal.style.display = 'flex';
  // Mark as seen so it doesn't re-appear this session
  chrome.storage.local.set({ rlModalSeen: true });
}

function checkRateLimitModal() {
  chrome.storage.local.get(['rateLimitAlert', 'rlModalSeen'], (res) => {
    if (!res.rateLimitAlert) return;
    const age = Date.now() - (res.rateLimitAlert.ts || 0);
    if (age > 15 * 60 * 1000) {
      // Stale — clear it
      chrome.storage.local.remove(['rateLimitAlert', 'rlModalSeen']);
      return;
    }
    if (res.rlModalSeen) return; // already shown this session
    showRateLimitModal(res.rateLimitAlert.host || '');
  });
}

// Dismiss button
$('rlDismiss') && $('rlDismiss').addEventListener('click', () => {
  const modal = $('rlModal');
  if (modal) modal.style.display = 'none';
  chrome.storage.local.remove(['rateLimitAlert', 'rlModalSeen']);
});

// Backdrop click to dismiss
$('rlModal') && $('rlModal').addEventListener('click', (e) => {
  if (e.target === $('rlModal')) {
    $('rlModal').style.display = 'none';
    chrome.storage.local.remove(['rateLimitAlert', 'rlModalSeen']);
  }
});

// Platform buttons inside modal
document.querySelectorAll('.rl-ai-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const platform = btn.dataset.platform;
    if (!ALLOWED_PLATFORMS.has(platform)) return;
    $('rlModal').style.display = 'none';
    chrome.storage.local.remove(['rateLimitAlert', 'rlModalSeen']);

    function doOpen(data) {
      const exportData = data ? finaliseExportData(data, '') : null;
      const send = () => chrome.runtime.sendMessage({ action: 'CONTINUE_ON', platform }, (res) => {
        if (res?.ok) setStatus('Opening ' + platform + ' — memory file attaching…', 'ok');
        else setError(res?.error || 'Could not open ' + platform, 'open');
      });
      if (exportData) {
        chrome.runtime.sendMessage({ action: 'STORE_DATA', data: exportData }, send);
      } else {
        send();
      }
    }

    if (lastData) {
      doOpen(lastData);
    } else {
      chrome.storage.local.get('ccmf', (res) => {
        if (res.ccmf) {
          try { validateCCMF(res.ccmf); lastData = res.ccmf; doOpen(res.ccmf); return; } catch(e) {}
        }
        // No data — still open the platform, user will start fresh
        doOpen(null);
      });
    }
  });
});

// Listen for rate limit messages from content/overlay scripts during popup lifetime
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'RATE_LIMIT_DETECTED') {
    showRateLimitModal(msg.host || '');
  }
});

// ── T&C toggle ────────────────────────────────────────────────────────────────
// Back from T&C without agreeing — if already agreed, just close
const tcBackFromShow = () => {
  chrome.storage.local.get('tcAgreed', (r) => {
    if (r.tcAgreed) {
      $('tcScreen').classList.add('hidden');
      $('appScreen').classList.add('visible');
    }
  });
};

// ── Review link ──────────────────────────────────────────────────────────────
const reviewLink = $('reviewLink');
if (reviewLink) {
  reviewLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://chromewebstore.google.com/detail/contextswitchai/oodgeokclkgibmnnhegmdgcmaekblhof/reviews' });
  });
}

// ── FAB Toggle (Feature 4) ───────────────────────────────────────────────────
function updateFabToggleBtn(enabled) {
  const btn = $('fabToggleBtn');
  if (!btn) return;
  if (enabled) {
    btn.classList.remove('fab-off');
    btn.title = 'Hide floating button';
    btn.textContent = '🫧';
  } else {
    btn.classList.add('fab-off');
    btn.title = 'Show floating button';
    btn.textContent = '⊘';
  }
}

(function initFabToggle() {
  const btn = $('fabToggleBtn');
  if (!btn) return;
  // Read stored state (default: enabled)
  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get('fabEnabled', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      const enabled = res?.fabEnabled !== false;
      updateFabToggleBtn(enabled);
    });
  }
  btn.addEventListener('click', () => {
    if (!isExtensionValid() || !chrome?.storage?.local) return;
    chrome.storage.local.get('fabEnabled', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      const wasEnabled = res?.fabEnabled !== false;
      const next = !wasEnabled;
      chrome.storage.local.set({ fabEnabled: next });
      updateFabToggleBtn(next);
    });
  });
})();

// ── Share Export (Feature 5) ─────────────────────────────────────────────────
let _activeShareAnchor = null;

function closeShareMenu() {
  const menu = $('shareMenu');
  if (menu) {
    menu.classList.remove('open');
    menu.style.cssText = 'display:none';
  }
  _activeShareAnchor = null;
}

function openShareMenu(anchorBtn, entry) {
  const menu = $('shareMenu');
  if (!menu) return;

  // Toggle closed if already open for this same button
  if (_activeShareAnchor === anchorBtn && menu.classList.contains('open')) {
    closeShareMenu(); return;
  }
  _activeShareAnchor = anchorBtn;

  // Move to body so not clipped by overflow:hidden ancestor
  if (menu.parentNode !== document.body) document.body.appendChild(menu);

  // Position with fixed coords relative to button
  const rect  = anchorBtn.getBoundingClientRect();
  const menuW = 168;
  let   left  = rect.right - menuW;
  if (left < 4) left = 4;
  const approxMenuH = 110;
  const top = rect.top > approxMenuH ? rect.top - approxMenuH - 4 : rect.bottom + 4;

  menu.style.cssText = [
    'display:block', 'position:fixed',
    `top:${top}px`, `left:${left}px`,
    'z-index:2147483640', `min-width:${menuW}px`,
    'background:var(--s1)', 'border:1px solid var(--b2)',
    'border-radius:var(--r)', 'box-shadow:0 8px 28px rgba(0,0,0,.6)',
    'overflow:hidden',
  ].join(';');
  menu.classList.add('open');

  // Encode the CCMF data as base64 once — reused by all targets
  const data     = entry?.data || {};
  const safeName = (entry?.name || buildSmartFilename(data))
    .replace(/\.json$/i, '').replace(/[/\\:*?"<>|]/g, '_').slice(0, 80) + '.json';
  const jsonStr  = JSON.stringify(data, null, 2);
  const b64      = btoa(unescape(encodeURIComponent(jsonStr)));

  // Wire up share options fresh each time
  menu.querySelectorAll('.share-opt').forEach(opt => {
    const fresh = opt.cloneNode(true);
    opt.parentNode.replaceChild(fresh, opt);
    fresh.addEventListener('click', (e) => {
      e.stopPropagation();
      closeShareMenu();
      if (!isExtensionValid()) return;
      const target = fresh.dataset.share;

      // Send to background which opens the tab and injects the file
      chrome.runtime.sendMessage(
        { action: 'SHARE_FILE_TO', target, b64, fileName: safeName },
        (res) => {
          if (!isExtensionValid()) return;
          if (chrome.runtime?.lastError || !res?.ok) {
            setStatus('Could not open ' + target + ' — try again', 'err');
          } else {
            setStatus('Opening ' + target + '… file will auto-attach to your message', 'ok');
          }
        }
      );
    });
  });
}

// Close share menu when clicking anywhere outside it
document.addEventListener('click', (e) => {
  const menu = $('shareMenu');
  if (!menu || !menu.classList.contains('open')) return;
  if (!menu.contains(e.target) && !e.target.classList.contains('recent-share')) {
    closeShareMenu();
  }
}, true);

// ── Load File button ─────────────────────────────────────────────────────────
// loadJsonBtn triggers the hidden jsonFileInput file picker
const loadJsonBtn = $('loadJsonBtn');
if (loadJsonBtn) {
  loadJsonBtn.addEventListener('click', () => $('jsonFileInput').click());
}

const clearRecentBtn = $('clearRecentBtn');
if (clearRecentBtn) {
  clearRecentBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!isExtensionValid()) return;
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ recentFiles: [] }, () => {
          if (!isExtensionValid() || chrome.runtime?.lastError) return;
          renderRecentFiles([]);
        });
      }
    } catch(err) {
      console.warn('[MKAI] Error clearing recent files:', err);
    }
  });
}

// ── Light / Dark mode ────────────────────────────────────────────────────────
(function initTheme() {
  const btn = $('themeToggleBtn');
  if (!btn) return;

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    btn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    // Sun icon for light mode (click to go dark), moon for dark mode (click to go light)
    btn.innerHTML = theme === 'light'
      ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></svg>`
      : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z"/></svg>`;
  }

  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get('theme', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      applyTheme(res?.theme || 'light');
    });
  }

  btn.addEventListener('click', () => {
    if (!isExtensionValid() || !chrome?.storage?.local) return;
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    chrome.storage.local.set({ theme: next });
  });
})();

// ── Auto-refresh recent exports when storage changes ─────────────────────────
// Keeps the list current even if an export happens while popup is open
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionValid()) return;
    if (area !== 'local') return;
    try {
      // If T&C agreed in the main popup, auto-transition the FAB panel without reload
      if (IS_PANEL && changes.tcAgreed && changes.tcAgreed.newValue === true) {
        const nudge = document.getElementById('csai-panel-nudge');
        if (nudge) nudge.remove();
        $('tcScreen')?.classList.add('hidden');
        $('appScreen')?.classList.add('visible');
        initApp();
      }
      if (changes.recentFiles) {
        const newList = changes.recentFiles.newValue;
        renderRecentFiles(Array.isArray(newList) ? newList : []);
      }
      // Sync theme across popup and FAB panel (Feature 3)
      if (changes.theme) {
        const newTheme = changes.theme.newValue || 'light';
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (newTheme !== currentTheme) {
          document.documentElement.setAttribute('data-theme', newTheme);
          const btn = $('themeToggleBtn');
          if (btn) {
            btn.title = newTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
            btn.innerHTML = newTheme === 'light'
              ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></svg>`
              : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z"/></svg>`;
          }
        }
      }
      // Sync FAB toggle state (Feature 3 + 4)
      if (changes.fabEnabled) {
        updateFabToggleBtn(changes.fabEnabled.newValue !== false);
      }
      // FAB panel requested folder picker — open search overlay and trigger it
      if (!IS_PANEL && changes.csai_openFolderPicker && changes.csai_openFolderPicker.newValue === true) {
        if (isExtensionValid()) chrome.storage.local.remove('csai_openFolderPicker');
        _triggerFolderPickerFromPopup();
      }
    } catch (e) {
      console.warn('[MKAI] Error in storage.onChanged:', e);
    }
  });
}

// ── Auto-open folder picker if FAB panel requested it ────────────────────────
function _triggerFolderPickerFromPopup() {
  showSearchOverlay().then(() => {
    setTimeout(() => {
      const btn = $('srchFolderBtn');
      const strip = $('srchFolderStrip');
      if (!btn || btn.classList.contains('linked')) return;

      // Scroll strip into view and pulse-highlight the button
      if (strip) strip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      btn.classList.add('csai-folder-nudge');
      btn.textContent = '👆 Tap to link folder';

      // Remove highlight after user clicks or after 8s
      const cleanup = () => {
        btn.classList.remove('csai-folder-nudge');
        btn.textContent = '📁 Link Folder';
        btn.removeEventListener('click', cleanup);
      };
      btn.addEventListener('click', cleanup);
      setTimeout(cleanup, 8000);
    }, 150);
  });
}

// ── Boot
if (IS_PANEL) {
  // Remove the fixed 580px body height so the panel can shrink to T&C nudge size
  // and grow naturally when the app screen loads.
  document.documentElement.style.height = 'auto';
  document.body.style.height = 'auto';
  document.body.style.maxHeight = 'none';
  document.body.style.overflow = 'visible';

  // FAB iframe: never show T&C — it must be agreed in the main popup first.
  // Read tcAgreed directly; if not yet agreed show a minimal nudge instead.
  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get('tcAgreed', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      if (res?.tcAgreed) {
        $('tcScreen').classList.add('hidden');
        $('appScreen').classList.add('visible');
        initApp();
      } else {
        // Not agreed yet — show a soft nudge inside the panel, no full T&C wall
        $('tcScreen').classList.add('hidden');
        const nudge = document.createElement('div');
        nudge.id = 'csai-panel-nudge';
        nudge.style.cssText = [
          'display:flex','flex-direction:column','align-items:center',
          'justify-content:center','min-height:240px','padding:28px 24px',
          'text-align:center','gap:14px','box-sizing:border-box'
        ].join(';');
        nudge.innerHTML = [
          '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">',
          '<rect width="32" height="32" rx="8" fill="#F0F0F5"/>',
          '<path d="M16 9v8M16 21v2" stroke="#6B6B80" stroke-width="2" stroke-linecap="round"/>',
          '</svg>',
          '<div style="font-size:13px;font-weight:600;color:var(--t1,#0C0C0E)">One step needed</div>',
          '<div style="font-size:11.5px;color:var(--t3,#6B6B80);line-height:1.5">',
          'Open the MKAI extension<br>icon in your toolbar to agree to<br>Terms &amp; Conditions first.',
          '</div>',
        ].join('');
        document.body.appendChild(nudge);
      }
    });
  }
} else {
  // Main popup: full T&C flow
  initTCScreen();
  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get(['tcAgreed', 'tutorialSeen', 'csai_openFolderPicker'], (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      if (res?.tcAgreed) {
        $('tcScreen').classList.add('hidden');
        $('appScreen').classList.add('visible');
        initApp().then(() => {
          initTutorialControls();
          if (!res.tutorialSeen) {
            startTutorial();
          }
          // FAB panel requested folder picker — consume flag and trigger immediately
          if (res.csai_openFolderPicker && isExtensionValid()) {
            chrome.storage.local.remove('csai_openFolderPicker');
            _triggerFolderPickerFromPopup();
          }
        });
      }
    });
  }
}

// ── Resize reporting for FAB iframe context ──────────────────────────────────
// When loaded as panel.html inside the FAB iframe, report height changes so the
// host can size the iframe correctly. This replaces the old panel.js resize logic.
if (IS_PANEL) {
  let _rt = null;
  function _reportHeight() {
    const app = $('appScreen');
    const tc  = $('tcScreen');
    const nudge = document.getElementById('csai-panel-nudge');
    const el = nudge ? nudge
             : (app && app.classList.contains('visible')) ? app
             : (tc && !tc.classList.contains('hidden'))   ? tc
             : document.body;
    const h = Math.ceil(el.getBoundingClientRect().height || el.offsetHeight || document.body.scrollHeight);
    window.parent.postMessage({ type: 'csai_resize', h: Math.max(h, 220) }, '*');
  }
  function _debounce() { clearTimeout(_rt); _rt = setTimeout(_reportHeight, 80); }
  new ResizeObserver(_debounce).observe(document.body);
  window.addEventListener('load', () => setTimeout(_reportHeight, 150));
}
