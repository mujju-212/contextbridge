// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// content.js — v2.0
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

console.log('[LLM-Exporter] v2.0 on', location.hostname);

const ALLOWED_PLATFORMS = new Set([
  'chatgpt','claude','gemini','grok','deepseek','perplexity','copilot','quark','doubao','postman','lmarena'
]);

// FIX: Guard against multiple INJECT_CONTINUATION calls.
// Previous bug: background.js retried because content.js never called sendResponse(),
// triggering "port closed" lastError and up to 6 attach chains on the same page.
let _continuationInjected = false;

const PARSERS = {
  'chatgpt.com'       : () => typeof parseChatGPT   !== 'undefined' ? parseChatGPT()   : null,
  'claude.ai'         : () => typeof parseClaude     !== 'undefined' ? parseClaude()     : null,
  'gemini.google.com' : () => typeof parseGemini     !== 'undefined' ? parseGemini()     : null,
  'grok.com'          : () => typeof parseGrok       !== 'undefined' ? parseGrok()       : null,
  'x.com'             : () => typeof parseGrok       !== 'undefined' ? parseGrok()       : null,
  'deepseek.com'      : () => typeof parseDeepSeek   !== 'undefined' ? parseDeepSeek()   : null,
  'perplexity.ai'     : () => typeof parsePerplexity !== 'undefined' ? parsePerplexity() : null,
  'microsoft.com'     : () => typeof parseCopilot    !== 'undefined' ? parseCopilot()    : null,
  'bing.com'          : () => typeof parseCopilot    !== 'undefined' ? parseCopilot()    : null,
  'quark.cn'          : () => typeof parseQuark      !== 'undefined' ? parseQuark()      : null,
  'doubao.com'        : () => typeof parseDoubao     !== 'undefined' ? parseDoubao()     : null,
  'postman.co'        : () => typeof parsePostman    !== 'undefined' ? parsePostman()    : null,
  'postman.com'       : () => typeof parsePostman    !== 'undefined' ? parsePostman()    : null,
  'lmarena.ai'        : () => typeof parseLMArena    !== 'undefined' ? parseLMArena()    : null,
  'arena.ai'          : () => typeof parseLMArena    !== 'undefined' ? parseLMArena()    : null,
  'lmsys.org'         : () => typeof parseLMArena    !== 'undefined' ? parseLMArena()    : null,
};

function getParser() {
  const h = location.hostname;
  for (const [key, fn] of Object.entries(PARSERS)) {
    if (h === key || h.endsWith('.' + key)) return fn;
  }
  // Universal fallback — works on any AI site via smart DOM heuristics
  if (typeof parseUniversal !== 'undefined') return parseUniversal;
  return null;
}

// ── Image fetching — fetch by URL with canvas fallback ────────────────────────
async function fetchImageAsBase64(url, name) {
  if (!url) return null;
  // Try direct fetch first (works for CDN images, Bing/Copilot, etc.)
  try {
    const resp = await fetch(url, { credentials: 'include' });
    if (resp.ok) {
      const ct   = resp.headers.get('content-type') || 'image/png';
      const mime = ct.split(';')[0].trim();
      if (!mime.startsWith('image/')) return null;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 12 * 1024 * 1024) return null;
      const bytes  = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      const ext  = mime.split('/')[1]?.replace('jpeg','jpg') || 'png';
      const safeName = (name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '') + '.' + ext;
      return { name: safeName, mimeType: mime, base64: b64 };
    }
  } catch(e) { /* fall through to canvas */ }
  return null;
}

// Canvas capture: grabs a rendered <img> element as PNG bytes regardless of CORS
function captureImgViaCanvas(imgEl) {
  return new Promise(resolve => {
    try {
      const w = imgEl.naturalWidth  || imgEl.width  || 0;
      const h = imgEl.naturalHeight || imgEl.height || 0;
      if (w < 20 || h < 20) { resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width  = Math.min(w, 2048);
      canvas.height = Math.min(h, 2048);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = e => {
          const b64 = e.target.result.split(',')[1];
          resolve({ base64: b64, mimeType: 'image/png' });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }, 'image/png', 0.92);
    } catch(e) { resolve(null); }
  });
}

// Per-platform DOM image selectors (expanded, per platform)
const PLATFORM_IMG_SELS = {
  'chatgpt.com': [
    'img[src*="oaiusercontent"]',
    'img[src*="blob:"]',
    'img[src*="dalle"]',
    '[data-testid*="image"] img',
    '[class*="imageGen"] img',
    '[class*="dalle"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"])',
  ],
  'claude.ai': [
    '[data-testid="human-turn"] img',
    '[data-testid="assistant-turn"] img',
    'img[src*="blob:"]',
    'img[src*="anthropic"]',
    'img[src*="amazonaws"]',
    'img[src*="upload"]',
    '.prose img', '[class*="prose"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"])',
  ],
  'gemini.google.com': [
    'img[src*="blob:"]',
    'img[src*="gemini"]',
    'img[src*="googleusercontent"]',
    'img[src*="gstatic"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'grok.com': [
    'img[src*="blob:"]',
    'img[src*="grok"]',
    'img[src*="pbs.twimg"]',
    'img[src*="x.com"]',
    '[class*="imageContainer"] img',
    '[class*="generatedImage"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"])',
  ],
  'deepseek.com': [
    'img[src*="blob:"]',
    'img[src*="deepseek"]',
    '[class*="userMessage"] img',
    '[class*="ds-markdown"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"])',
  ],
  'perplexity.ai': [
    'img[src*="blob:"]',
    'img[src*="perplexity"]',
    'img[src*="upload"]',
    '.prose img', '[class*="prose"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"])',
  ],
  'microsoft.com': [
    'img[src*="th.bing.com"]',       // DALL-E / Designer — actually fetchable
    'img[src*="www.bing.com/images"]',
    'img[src*="blob:"]',
    'img[src*="copilot"]',
    '[class*="imageCard"] img',
    '[class*="ImageAttachment"] img',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'postman.co': [
    'img[src*="blob:"]',
    'img[src*="postman"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'postman.com': [
    'img[src*="blob:"]',
    'img[src*="postman"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'lmarena.ai': [
    'img[src*="blob:"]',
    'img[src*="lmarena"]',
    'img[src*="arena"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'arena.ai': [
    'img[src*="blob:"]',
    'img[src*="arena"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
  'lmsys.org': [
    'img[src*="blob:"]',
    'img[src*="lmsys"]',
    'img[alt]:not([alt=""]):not([src*="icon"]):not([src*="logo"]):not([src*="avatar"])',
  ],
};

// Noise filter — skip tiny icons, avatars, UI elements
const IMG_NOISE = /favicon|s2\/favicons|icon\.png|logo\.png|avatar|spinner|loading|badge|emoji/i;

// Collect all images from the page using platform-specific selectors + canvas capture
async function collectAllImages(platform) {
  const hostname = location.hostname;
  const key = Object.keys(PLATFORM_IMG_SELS).find(k => hostname === k || hostname.endsWith('.' + k));
  const sels = (key ? PLATFORM_IMG_SELS[key] : []).concat([
    'img[src*="blob:"]',
    'img[src*="upload"]',
  ]);

  const seen  = new Set();
  const tasks = [];
  let   idx   = 0;

  const allImgs = new Set();
  sels.forEach(sel => {
    try { document.querySelectorAll(sel).forEach(img => allImgs.add(img)); } catch(e) {}
  });

  for (const img of allImgs) {
    if (!img.src || img.src === location.href) continue;
    if (IMG_NOISE.test(img.src)) continue;
    if (img.getAttribute('aria-hidden') === 'true') continue;
    if (img.getAttribute('role') === 'presentation') continue;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w > 0 && w < 60) continue;
    if (h > 0 && h < 60) continue;

    const key = img.src;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tasks.length >= 40) break; // cap at 40 images

    const rawName = img.alt || img.getAttribute('data-filename') || img.getAttribute('title') ||
      (img.src.startsWith('blob:') ? `image_${++idx}.png` : decodeURIComponent(img.src.split('/').pop().split('?')[0])) ||
      `image_${++idx}`;

    tasks.push({ img, url: img.src, rawName });
  }

  const results = [];
  await Promise.all(tasks.map(async ({ img, url, rawName }, i) => {
    let fetched = null;

    // 1. Try direct fetch (good for Bing/CDN images)
    fetched = await Promise.race([
      fetchImageAsBase64(url, rawName),
      new Promise(r => setTimeout(() => r(null), 8000))
    ]);

    // 2. Canvas fallback — works for rendered images even behind auth
    if (!fetched) {
      const captured = await Promise.race([
        captureImgViaCanvas(img),
        new Promise(r => setTimeout(() => r(null), 5000))
      ]);
      if (captured) {
        const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '') + '.png';
        fetched = { name: safeName, mimeType: 'image/png', base64: captured.base64 };
      }
    }

    if (fetched) {
      // Ensure unique filenames
      const ext = fetched.name.includes('.') ? '' : '.png';
      fetched.name = `image_${String(i + 1).padStart(3, '0')}_${fetched.name}${ext}`;
      results.push(fetched);
    }
  }));

  return results;
}

// Legacy fetchAllImages used by EXPORT_WITH_IMAGES (keep for compat)
async function fetchAllImages(data) {
  if (!data.att) return {};
  const result  = {};
  const entries = Object.entries(data.att).filter(([, v]) => v.type === 'image' && v.url);
  const fetches = entries.slice(0, 10).map(async ([fId, att]) => {
    const img = await Promise.race([
      fetchImageAsBase64(att.url, att.name),
      new Promise(r => setTimeout(() => r(null), 10000))
    ]);
    if (img) result[fId] = img;
  });
  await Promise.all(fetches);
  return result;
}

// Build a human-readable manifest for non-image attachments
function buildAttachmentManifest(ccmf, downloadedImgNames, scannedImgCount) {
  const platform = ccmf.p || 'unknown';
  const date     = new Date().toISOString().slice(0, 10);
  const atts     = Object.values(ccmf.att || {});
  const nonImgs  = atts.filter(a => a.type !== 'image');
  const imgAtts  = atts.filter(a => a.type === 'image');

  const lines = [];
  lines.push('=== MKAI Attachment Manifest ===');
  lines.push(`Platform: ${platform}  |  Exported: ${date}`);
  lines.push(`Images captured from page: ${downloadedImgNames.length} of ${scannedImgCount} found`);
  lines.push(`Attachments referenced in chat: ${atts.length}`);
  lines.push('');

  if (downloadedImgNames.length) {
    lines.push('─── IMAGES SAVED IN images/ FOLDER ───');
    downloadedImgNames.forEach((n, i) => lines.push(`  ${i + 1}. ${n}`));
    lines.push('');
  }

  if (imgAtts.length) {
    const notDownloaded = imgAtts.filter(a =>
      !downloadedImgNames.some(n => n.includes(a.name?.replace(/[^a-zA-Z0-9._-]/g, '_')))
    );
    if (notDownloaded.length) {
      lines.push('─── IMAGES DETECTED BUT COULD NOT SAVE (auth-gated or not rendered) ───');
      notDownloaded.forEach((a, i) => {
        lines.push(`  ${i + 1}. ${a.name || 'image'}${a.url ? '  →  ' + a.url : ''}`);
      });
      lines.push('');
    }
  }

  if (nonImgs.length) {
    lines.push('─── OTHER ATTACHMENTS (name only — cannot auto-download) ───');
    lines.push('NOTE: These files were uploaded/referenced but cannot be downloaded');
    lines.push('automatically. Filenames are preserved here for reference.');
    lines.push('');
    nonImgs.forEach((a, i) => {
      const type = a.type === 'source' ? 'web source' : a.type === 'file' ? 'file' : a.type;
      lines.push(`  ${i + 1}. [${type}]  ${a.name || 'attachment'}${a.url ? '  →  ' + a.url : ''}`);
    });
    lines.push('');
  }

  if (!downloadedImgNames.length && !nonImgs.length) {
    lines.push('No attachments detected in this conversation.');
  }

  lines.push('─────────────────────────────────────────────');
  lines.push('Generated by MKAI  |  By Aditya & Manas');
  return lines.join('\n');
}

// ── ZIP builder ───────────────────────────────────────────────────────────────
function buildZip(files) {
  const encoder = new TextEncoder();
  function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); return b; }
  function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,true); return b; }
  function crc32(data) {
    let c = 0xFFFFFFFF;
    const table = crc32.t || (crc32.t = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let v = i;
        for (let j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
        t[i] = v;
      }
      return t;
    })());
    for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const localHeaders = [], centralDirs = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data      = file.data instanceof Uint8Array ? file.data : new TextEncoder().encode(file.data);
    const crc       = crc32(data);
    const size      = data.length;
    const lh = concat([
      new Uint8Array([0x50,0x4B,0x03,0x04]),
      u16(20),u16(0),u16(0),u16(0),u16(0),
      u32(crc),u32(size),u32(size),
      u16(nameBytes.length),u16(0),
      nameBytes, data,
    ]);
    localHeaders.push(lh);
    centralDirs.push(concat([
      new Uint8Array([0x50,0x4B,0x01,0x02]),
      u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),
      u32(crc),u32(size),u32(size),
      u16(nameBytes.length),u16(0),u16(0),u16(0),u16(0),
      u32(0),u32(offset),nameBytes,
    ]));
    offset += lh.length;
  }
  const cdOffset = offset;
  const cdData   = concat(centralDirs);
  const eocd = concat([
    new Uint8Array([0x50,0x4B,0x05,0x06]),
    u16(0),u16(0),
    u16(files.length),u16(files.length),
    u32(cdData.length),u32(cdOffset),u16(0),
  ]);
  return concat([...localHeaders, cdData, eocd]);
}

function concat(arrays) {
  const total = arrays.reduce((s,a) => s + a.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const a of arrays) { out.set(a, pos); pos += a.length; }
  return out;
}

// ── Main-world script execution ───────────────────────────────────────────────
// ChatGPT's CSP blocks inline <script> injection (the old runInMainWorld approach).
// Instead we ask background.js to call chrome.scripting.executeScript with
// world: "MAIN" — this runs in the page JS context (React fiber access) without
// any inline script, fully bypassing the CSP restriction.
// Background writes the return value to chrome.storage.local under a one-time key;
// we poll that key and resolve once it appears.
// ── Preloaded-main-world script execution (Claude & Grok) ────────────────────
// Calls window.__csai_*Attach which was pre-registered by claude_main.js / grok_main.js
// (MAIN-world content scripts loaded from file — no eval/new Function, works under strict CSP).
// DOM-event bridge to MAIN-world scripts (claude_main.js, grok_main.js, deepseek_main.js)
// Accepts a File of ANY type — encodes as base64 so MAIN world can reconstruct it correctly.
async function attachViaMainEvent(reqEvent, resEvent, file) {
  const b64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload  = e => { const r = e.target.result; const i = r.indexOf(','); res(i >= 0 ? r.slice(i+1) : r); };
    reader.onerror = () => rej(new Error('read failed'));
    reader.readAsDataURL(file);
  });
  return new Promise(resolve => {
    const timeout = setTimeout(() => { document.removeEventListener(resEvent, handler); resolve(null); }, 12000);
    function handler(e) {
      clearTimeout(timeout);
      document.removeEventListener(resEvent, handler);
      resolve(e.detail && e.detail.result ? e.detail.result : null);
    }
    document.addEventListener(resEvent, handler);
    document.dispatchEvent(new CustomEvent(reqEvent, {
      detail: { b64, fileName: file.name, mimeType: file.type || 'application/octet-stream' }
    }));
  });
}

function runInMainWorld(fn, args) {
  return new Promise(resolve => {
    if (!isExtensionValid()) { resolve(null); return; }
    const resultKey = '__cswai_mw_' + Date.now() + '_' + (Math.random() * 1e9 | 0);
    const timeout   = setTimeout(() => { clearInterval(poll); resolve(null); }, 12000);

    const poll = setInterval(() => {
      if (!isExtensionValid() || !chrome?.storage?.local) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(null);
        return;
      }
      chrome.storage.local.get(resultKey, (res) => {
        if (!isExtensionValid() || chrome.runtime?.lastError) return;
        if (res && res[resultKey] !== undefined) {
          clearInterval(poll);
          clearTimeout(timeout);
          const val = res[resultKey];
          if (isExtensionValid()) chrome.storage.local.remove(resultKey);
          resolve(val === '__cswai_null__' ? null : val);
        }
      });
    }, 80);

    try {
      chrome.runtime.sendMessage({
        action   : 'EXEC_IN_MAIN_WORLD',
        fnString : fn.toString(),
        args     : args,
        resultKey: resultKey,
      });
    } catch (e) {
      clearInterval(poll);
      clearTimeout(timeout);
      resolve(null);
    }
  });
}

// ── File attachment helpers ───────────────────────────────────────────────────
function buildCCMFFile(data) {
  const json = JSON.stringify(data, null, 2);
  return new File([new Blob([json], { type: 'application/json' })], 'memory_ccmf.json', { type: 'application/json' });
}

function dropFileOnElement(el, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  ['dragenter','dragover','drop'].forEach(type =>
    el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
  );
}

function pasteFileOnElement(el, file) {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    el.focus();
    ['paste'].forEach(type =>
      el.dispatchEvent(new ClipboardEvent(type, {
        clipboardData: dt, bubbles: true, cancelable: true
      }))
    );
    return true;
  } catch(e) { return false; }
}

function waitForElement(findFn, timeoutMs) {
  return new Promise(resolve => {
    const el = findFn();
    if (el) { resolve(el); return; }
    const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
    const obs = new MutationObserver(() => {
      const found = findFn();
      if (found) { clearTimeout(timer); obs.disconnect(); resolve(found); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function findVisible(selectors) {
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) return el;
      }
    } catch(e) {}
  }
  return null;
}

function findVisibleDeep(selectors) {
  function walk(root, visited) {
    if (visited.has(root)) return null;
    visited.add(root);
    for (const sel of selectors) {
      try {
        const els = root.querySelectorAll(sel);
        for (const el of els) {
          if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) return el;
        }
      } catch(e) {}
    }
    try {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot, visited);
          if (found) return found;
        }
      }
    } catch(e) {}
    return null;
  }
  return walk(document, new WeakSet());
}

function findAnyDeep(selectors) {
  function walk(root, visited) {
    if (visited.has(root)) return null;
    visited.add(root);
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch(e) {}
    }
    try {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          const found = walk(el.shadowRoot, visited);
          if (found) return found;
        }
      }
    } catch(e) {}
    return null;
  }
  return walk(document, new WeakSet());
}

function findAllDeep(sel) {
  const found = [];
  const visited = new WeakSet();
  function walk(root) {
    if (visited.has(root)) return;
    visited.add(root);
    try { root.querySelectorAll(sel).forEach(n => found.push(n)); } catch(e) {}
    try {
      root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) walk(el.shadowRoot); });
    } catch(e) {}
  }
  walk(document);
  return found;
}

function findInShadow(hostSel, innerSel) {
  const host = document.querySelector(hostSel);
  return host?.shadowRoot?.querySelector(innerSel) || null;
}

function findFileInput(platformHints) {
  if (platformHints) {
    for (const sel of platformHints) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
  }
  const direct = document.querySelector('input[type="file"]');
  if (direct) return direct;

  function walkShadow(root, visited) {
    if (visited.has(root)) return null;
    visited.add(root);
    const inp = root.querySelector('input[type="file"]');
    if (inp) return inp;
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const found = walkShadow(el.shadowRoot, visited);
        if (found) return found;
      }
    }
    return null;
  }
  return walkShadow(document, new WeakSet());
}

function attachFileToInput(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);

  let filesSet = false;

  try {
    Object.defineProperty(input, 'files', {
      configurable: true,
      enumerable  : true,
      get()       { return dt.files; },
    });
    filesSet = true;
  } catch(e) {}

  if (!filesSet) {
    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (desc && desc.set) { desc.set.call(input, dt.files); filesSet = true; }
    } catch(e) {}
  }

  if (!filesSet) {
    try { input.files = dt.files; } catch(_) {}
  }

  input.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

  if (input.form) {
    input.form.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ── Platform-specific upload button selectors ─────────────────────────────────
// Updated 2025: revised selectors to match current DOM of each platform
const UPLOAD_BTN_SELECTORS = {
  chatgpt    : [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Add photos and files" i]',
    'button[data-testid*="attach" i]',
    'button[data-testid="composer-footer-actions-button"]',
    'button[data-testid="fruitjuice-attach-btn"]',
    '[class*="attachButton"]',
  ],
  claude     : [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    '[data-testid*="attach" i]',
    // Claude 2025 updated selector
    'button[aria-label*="Add content" i]',
    'button[data-testid="file-upload"]',
  ],
  gemini     : [
    // Gemini uses shadow DOM; these are for inside shadow roots
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Add" i]',
    'button[aria-label*="Attach" i]',
    '[data-tooltip*="Upload" i]',
    '[jsname][aria-label*="file" i]',
    'ms-upload-button',
  ],
  grok       : [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    '[class*="attachment"]',
    // Grok 2025
    'button[data-testid*="upload" i]',
    'label[for*="file" i]',
  ],
  deepseek   : [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    '[class*="upload"]',
    // DeepSeek 2025
    'label[class*="upload" i]',
    'div[class*="file-upload" i]',
  ],
  perplexity : [
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Upload" i]',
    '[data-testid*="attach" i]',
    '[class*="attach" i]',
    // Perplexity 2025
    'button[aria-label*="file" i]',
  ],
  copilot    : ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
  quark      : ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
  doubao     : ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
  postman    : ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]', 'textarea[placeholder*="Postbot" i]', 'textarea[placeholder*="Ask" i]', '[data-test*="postbot-input"]'],
  lmarena    : ['textarea[name="message"]', 'button[aria-label*="Add files" i]', 'button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
};

const DROP_ZONE_SELECTORS = [
  'textarea', '[contenteditable="true"]', '[role="textbox"]',
  '[class*="chatInput"]', '[class*="chat-input"]', '[class*="inputArea"]', 'main',
];

// ── Main attach logic ─────────────────────────────────────────────────────────
async function attachFileToPlatform(platform, file) {
  // ── Universal engine (inject_core.js runs in MAIN world on every platform) ──
  // Every platform routes through csai_universal_attach → inject_core.js.
  // inject_core.js uses 7-layer DOM-independent strategy:
  //   1. Existing input[type=file] in DOM (incl. shadow roots)
  //   2. HTMLInputElement.prototype.click intercept
  //   3. document.createElement intercept — catches inputs the moment they're created
  //   4. showOpenFilePicker intercept (File System Access API)
  //   5. MutationObserver for dynamically added inputs
  //   6. Semantic button scoring (no hardcoded selectors)
  //   7. Safety timeout scan
  // Frameworks: React (all versions), Vue 2/3, Angular, Svelte, plain DOM.

  // Gemini uses Angular + shadow DOM — find file input directly without triggering
  // button click (most reliable approach for Angular Web Components).
  if (platform === 'gemini') {
    let fileInput = findFileInput(['input[type="file"]']);
    if (fileInput) {
      attachFileToInput(fileInput, file);
      console.log('[LLM-Exporter] Gemini: direct input ✓');
      insertContinuationPromptAfterAttach(file);
      return true;
    }
    // Wait for shadow DOM to resolve
    fileInput = await waitForElement(() => findFileInput(['input[type="file"]']), 5000);
    if (fileInput) {
      attachFileToInput(fileInput, file);
      console.log('[LLM-Exporter] Gemini: observed input ✓');
      insertContinuationPromptAfterAttach(file);
      return true;
    }
    // Shadow-root upload button hosts
    for (const hostSel of ['ms-upload-button','upload-button','bard-upload-button']) {
      const host = findAnyDeep([hostSel]);
      if (host?.shadowRoot) {
        const inner = host.shadowRoot.querySelector('input[type="file"]');
        if (inner) {
          attachFileToInput(inner, file);
          insertContinuationPromptAfterAttach(file);
          return true;
        }
      }
    }
    // Paste fallback into rich textarea
    const ta = findAnyDeep(['rich-textarea','ms-text-input','[contenteditable="true"]','textarea','[role="textbox"]']);
    if (ta) {
      const ok = pasteFileOnElement(ta, file) || dropFileOnElement(ta, file);
      if (ok) insertContinuationPromptAfterAttach(file);
      return ok;
    }
    return false;
  }

async function insertContinuationPromptAfterAttach(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const openingReq = (data._openingPrompt || '').trim();
    const sourcePlat = data.p ? (data.p.charAt(0).toUpperCase() + data.p.slice(1)) : 'prior session';
    const continuationMsg = openingReq
      ? `Please review the attached conversation memory (${sourcePlat}) and proceed with this request:\n\n${openingReq}`
      : `I have attached our previous conversation memory file from ${sourcePlat}. Please review the context and continue seamlessly from where we left off!`;

    // Attempt insertion multiple times as file uploads can temporarily disable or recreate input DOM
    let attempts = 0;
    const tryInsert = () => {
      attempts++;
      const ok = insertTextIntoChatInput(continuationMsg);
      if (ok) {
        console.log('[LLM-Exporter] Continuation prompt injected into chat input ✓');
      } else if (attempts < 6) {
        setTimeout(tryInsert, 600);
      }
    };
    setTimeout(tryInsert, 400);
  } catch(e) {
    console.warn('[LLM-Exporter] Could not prepare continuation prompt:', e);
  }
}

function formatMemoryContinuationPrompt(data) {
  if (!data) return '';
  const lines = [];
  const sourcePlat = data.p ? (data.p.charAt(0).toUpperCase() + data.p.slice(1)) : 'AI';
  const msgCount = Array.isArray(data.m) ? data.m.length : 0;
  const title = (data.chatTitle || '').trim();
  const rawPrompt = (data._openingPrompt || '').trim();
  const instruction = rawPrompt || 'Please review our prior discussion from this session and continue where we left off. Acknowledge what we covered and help me with the next step!';
  const notesArr = Array.isArray(data.notes) ? data.notes : [];

  // Prompt / Task placed prominently at the TOP so it is immediately visible
  lines.push('🎯 [CURRENT TASK / NEXT PROMPT]:');
  lines.push(instruction);
  lines.push('');
  lines.push('════════════════════════════════════════════════════════════════');
  lines.push(`📜 [CONVERSATION MEMORY & CONTEXT from ${sourcePlat}${title ? ' - "' + title + '"' : ''} (${msgCount} messages)]`);
  lines.push('════════════════════════════════════════════════════════════════');
  lines.push('Please absorb this entire context into your memory and continue our conversation seamlessly without repeating prior explanations.');
  lines.push('');

  if (notesArr.length > 0) {
    lines.push('--- KEY NOTES FROM USER ---');
    notesArr.forEach((n, i) => lines.push(`${i + 1}. ${n.text}`));
    lines.push('');
  }

  lines.push('--- CONVERSATION HISTORY ---');
  if (Array.isArray(data.m) && data.m.length > 0) {
    data.m.forEach(([role, , content]) => {
      const speaker = role === 'u' ? 'User' : (sourcePlat + ' Assistant');
      let body = '';
      if (typeof content === 'string') {
        body = content;
      } else if (content && typeof content === 'object') {
        body = content.txt || '';
        if (content.c && data.c) {
          const refs = Array.isArray(content.c) ? content.c : [content.c];
          refs.forEach(cId => {
            if (data.c[cId]) {
              const [lang, codeBody] = data.c[cId];
              body += `\n\n\`\`\`${lang || ''}\n${codeBody}\n\`\`\``;
            }
          });
        }
      }
      if (body && body.trim()) {
        lines.push(`[${speaker}]:\n${body.trim()}\n`);
      }
    });
  }

  lines.push('════════════════════════════════════════════════════════════════');
  lines.push('🎯 [PROCEED WITH REQUEST]:');
  lines.push(instruction);
  lines.push('════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function insertTextIntoChatInput(text) {
  if (!text) return false;
  let inputEl = findAnyDeep([
    'rich-textarea div[contenteditable="true"]',
    'rich-textarea p',
    'rich-textarea [role="textbox"]',
    'div[role="textbox"][contenteditable="true"]',
    '.ai-chat-input div[role="textbox"]',
    '[data-testid*="ai-chat-input"]',
    '#prompt-textarea',
    'div.ProseMirror',
    'textarea[placeholder*="Describe" i]',
    'textarea[name="message"]',
    'textarea[placeholder*="Postbot" i]',
    'textarea[placeholder*="Ask" i]',
    'textarea[placeholder*="agent" i]',
    '[data-testid*="textbox"]',
    '[data-test*="postbot-input"]',
    '[data-test*="chat-input"]',
    '[data-testid*="chat-input"]',
    '.ai-chat-input textarea',
    '.ai-chat-container textarea',
    'aside textarea',
    '[class*="side-view"] textarea',
    '[class*="agentMode"] textarea',
    'rich-textarea',
    'div[contenteditable="true"]',
    'textarea',
    '[role="textbox"]',
  ]);
  if (!inputEl) {
    console.warn('[LLM-Exporter] No chat input element found');
    return false;
  }

  // If a wrapper component like rich-textarea was found, locate its inner editable child
  if (inputEl.tagName === 'RICH-TEXTAREA') {
    const inner = inputEl.querySelector('[contenteditable="true"]') || inputEl.querySelector('p') || inputEl.querySelector('textarea');
    if (inner) inputEl = inner;
  }

  inputEl.focus();

  const isEditableDiv = inputEl.isContentEditable ||
                        inputEl.getAttribute('contenteditable') === 'true' ||
                        inputEl.tagName === 'DIV' ||
                        inputEl.tagName === 'P';

  if (isEditableDiv) {
    // 1. Clear contents and select range
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch(e) {}

    // 2. Set rich text HTML paragraphs (for Postman, Draft.js, ProseMirror)
    const paragraphs = text.split('\n')
      .map(line => `<p>${line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>'}</p>`)
      .join('');
    try {
      inputEl.innerHTML = paragraphs;
    } catch(e) {}

    // 3. Try execCommand fallback if innerHTML didn't stick
    if (!inputEl.textContent || !inputEl.textContent.trim()) {
      try {
        document.execCommand('insertText', false, text);
      } catch(e) {}
    }

    // 4. Try clipboard event injection
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      inputEl.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    } catch(e) {}

    // 5. Fire input & change events for framework listeners
    try {
      inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } catch(e) {}

    // 6. Enable send button
    const sendBtn = findAnyDeep([
      '.ai-chat-input-send-button',
      '[class*="send-button"]',
      'button[aria-label*="Send" i]',
      'button[data-testid*="send"]',
      'button[aria-label*="Submit" i]',
    ]);
    if (sendBtn && sendBtn.disabled) {
      sendBtn.disabled = false;
    }

    return true;
  } else {
    // Standard <textarea> or <input>
    let ok = false;
    try {
      document.execCommand('selectAll', false, null);
      ok = document.execCommand('insertText', false, text);
    } catch(e) {}

    if (!ok || inputEl.value !== text) {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const sendBtn = findAnyDeep([
      '.ai-chat-input-send-button',
      '[class*="send-button"]',
      'button[aria-label*="Send" i]',
      'button[data-testid*="send"]',
      'button[aria-label*="Submit" i]',
    ]);
    if (sendBtn && sendBtn.disabled) {
      sendBtn.disabled = false;
    }

    return true;
  }
}

  // Postman uses text chat input (no file uploads) — inject readable conversation context directly
  if (platform === 'postman') {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const promptText = formatMemoryContinuationPrompt(data);
      const ok = insertTextIntoChatInput(promptText);
      if (ok) {
        console.log('[LLM-Exporter] Postman: full memory context + prompt injected into input ✓');
        return true;
      } else {
        console.warn('[LLM-Exporter] Postman: insertTextIntoChatInput could not find input yet');
      }
    } catch (e) {
      console.warn('[LLM-Exporter] Postman text injection error:', e);
    }
    return false;
  }

  // LM Arena uses text chat input (does not accept JSON file uploads) — inject readable conversation context directly
  if (platform === 'lmarena') {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const promptText = formatMemoryContinuationPrompt(data);
      const ok = insertTextIntoChatInput(promptText);
      if (ok) {
        console.log('[LLM-Exporter] LM Arena: full memory context + prompt injected into input ✓');
        return true;
      } else {
        console.warn('[LLM-Exporter] LM Arena: insertTextIntoChatInput could not find input yet');
      }
    } catch (e) {
      console.warn('[LLM-Exporter] LM Arena text injection error:', e);
    }
    return false;
  }

  // All other platforms: universal engine via MAIN-world event bridge
  const result = await attachViaMainEvent('csai_universal_attach', 'csai_universal_done', file);
  if (result) {
    console.log('[LLM-Exporter]', platform, ': universal attach →', result);
    // After file attaches, insert continuation prompt into the chat input
    insertContinuationPromptAfterAttach(file);
    return true;
  }

  // Last resort: paste/drop into any visible text input area
  console.warn('[LLM-Exporter]', platform, ': universal timed out — paste fallback');
  const ta = findAnyDeep([
    '[contenteditable="true"]', 'textarea', '[role="textbox"]',
    '#prompt-textarea', '[data-testid="chat-input"]',
  ]);
  if (ta) {
    const ok = pasteFileOnElement(ta, file) || dropFileOnElement(ta, file);
    if (ok) insertContinuationPromptAfterAttach(file);
    return ok;
  }
  return false;
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
function attachWithRetry(platform, file) {
  let attempts = 0;
  const MAX = 15, INTERVAL = 1000;
  const initialDelay = (platform === 'chatgpt' || platform === 'gemini') ? 4000
                      : (platform === 'claude' || platform === 'grok') ? 3000
                      : 1800;
  const tryOnce = async () => {
    attempts++;
    console.log('[LLM-Exporter] Attach attempt', attempts, 'for', platform);
    const ok = await attachFileToPlatform(platform, file);
    if (ok) { console.log('[LLM-Exporter] ✓ Attached on attempt', attempts); return; }
    if (attempts < MAX) setTimeout(tryOnce, INTERVAL);
    else console.warn('[LLM-Exporter] Attach failed after', MAX, 'attempts on', platform);
  };
  setTimeout(tryOnce, initialDelay);
}


// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.tab) return;

  if (msg.action === 'EXPORT') {
    // Set compression skip flag — read by tokenReducer.js (same content-script context)
    if (typeof __csai_skipCompress !== 'undefined') {
      __csai_skipCompress = msg.skipCompress === true;
    }
    const parser = getParser();
    if (!parser) { sendResponse({ ok: false, error: 'No parser for ' + location.hostname }); return true; }

    (async () => {
      try {
        const data = await parser();
        if (!data || !Array.isArray(data.m) || data.m.length === 0) {
          const isPostman = location.hostname.includes('postman');
          const err = isPostman
            ? 'No Postbot conversation found — make sure the Postbot / AI Agent panel is open with messages.'
            : 'No messages found — try scrolling to load the full conversation';
          sendResponse({ ok: false, error: err });
          return;
        }
        // Capture the page title as chat name for smart filename generation
        const rawTitle = (document.title || '').trim();
        // Strip common platform suffixes: "My topic - Claude", "Chat | ChatGPT" etc.
        const chatTitle = rawTitle
          .replace(/\s*[-|–]\s*(Claude|ChatGPT|Gemini|Grok|DeepSeek|Perplexity|Copilot|Quark|Doubao|Postman|Postbot|LMSYS|LM Arena|Chatbot Arena)\s*$/i, '')
          .replace(/^(Claude|ChatGPT|Gemini|Grok|DeepSeek|Perplexity|Copilot|Quark|Doubao|Postman|Postbot|LMSYS|LM Arena|Chatbot Arena)\s*[-|–]\s*/i, '')
          .trim()
          .slice(0, 60);
        if (!data.chatTitle && chatTitle) data.chatTitle = chatTitle;
        console.log('[LLM-Exporter] Exported:', data.m.length, 'msgs');
        // Always reset skip flag after export
        if (typeof __csai_skipCompress !== 'undefined') __csai_skipCompress = false;
        sendResponse({ ok: true, data });
      } catch (e) {
        if (typeof __csai_skipCompress !== 'undefined') __csai_skipCompress = false;
        sendResponse({ ok: false, error: e.message || 'Export failed' });
      }
    })();
    return true;
  }

  if (msg.action === 'EXPORT_WITH_IMAGES') {
    const parser = getParser();
    if (!parser) { sendResponse({ ok: false, error: 'No parser for ' + location.hostname }); return true; }

    (async () => {
      try {
        const data = await parser();
        if (!data || !Array.isArray(data.m) || data.m.length === 0) {
          sendResponse({ ok: false, error: 'No messages found' });
          return;
        }
        fetchAllImages(data).then(imgMap => {
          sendResponse({ ok: true, data, imgMap });
        }).catch(() => {
          sendResponse({ ok: true, data, imgMap: {} });
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || 'Export failed' });
      }
    })();
    return true;
  }

  if (msg.action === 'BUILD_ZIP') {
    chrome.storage.local.get('ccmf', async ({ ccmf }) => {
      if (!ccmf) { sendResponse({ ok: false, error: 'No data' }); return; }

      // 1. Collect all images from the page (fetch + canvas fallback)
      const capturedImgs = await collectAllImages(location.hostname);

      // 2. Also try legacy URL-based fetch for any in ccmf.att
      const legacyMap = await fetchAllImages(ccmf);
      for (const [fId, img] of Object.entries(legacyMap)) {
        const alreadyCaptured = capturedImgs.some(c => c.base64 === img.base64);
        if (!alreadyCaptured) capturedImgs.push(img);
      }

      // 3. Build image files for ZIP
      const imageFiles = [];
      const downloadedNames = [];
      const usedNames = new Set();
      for (const img of capturedImgs) {
        // Ensure unique filename
        let fn = img.name || 'image.png';
        if (usedNames.has(fn)) {
          const parts = fn.split('.');
          const ext = parts.length > 1 ? '.' + parts.pop() : '.png';
          fn = parts.join('.') + '_' + Date.now() + ext;
        }
        usedNames.add(fn);
        const bytes = Uint8Array.from(atob(img.base64), c => c.charCodeAt(0));
        imageFiles.push({ name: 'images/' + fn, data: bytes });
        downloadedNames.push(fn);
      }

      // 4. Build manifest TXT
      const manifestTxt = buildAttachmentManifest(ccmf, downloadedNames, capturedImgs.length);
      const manifestBytes = new TextEncoder().encode(manifestTxt);

      // 5. Build JSON (mark embedded images)
      const exportData = JSON.parse(JSON.stringify(ccmf));
      for (const [fId, att] of Object.entries(exportData.att || {})) {
        if (att.type === 'image') att.note = 'See images/ folder in ZIP';
      }

      const jsonBytes = new TextEncoder().encode(JSON.stringify(exportData, null, 2));

      // 6. Build ZIP
      const zipFiles = [
        { name: 'memory_ccmf.json', data: jsonBytes },
        { name: 'attachments_manifest.txt', data: manifestBytes },
        ...imageFiles,
      ];
      const zipBytes = buildZip(zipFiles);
      let binary = '';
      for (let i = 0; i < zipBytes.length; i++) binary += String.fromCharCode(zipBytes[i]);
      sendResponse({ ok: true, b64: btoa(binary), imageCount: imageFiles.length });
    });
    return true;
  }

  if (msg.action === 'INJECT_RAW_FILE') {
    // Inject any file (image, pdf, doc, json, etc.) into the current AI's input
    const { b64, fileName, mimeType } = msg;
    if (!b64 || !fileName) { sendResponse({ ok: false, error: 'Missing file data' }); return true; }
    const bytes  = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const file   = new File([bytes], fileName, { type: mimeType || 'application/octet-stream' });
    const platform = (() => {
      const h = location.hostname;
      const map = {
        'chatgpt.com':'chatgpt','claude.ai':'claude','gemini.google.com':'gemini',
        'grok.com':'grok','x.com':'grok','deepseek.com':'deepseek','perplexity.ai':'perplexity',
        'microsoft.com':'copilot','bing.com':'copilot','quark.cn':'quark','doubao.com':'doubao',
        'postman.co':'postman','postman.com':'postman'
      };
      for (const [k,v] of Object.entries(map)) { if (h===k||h.endsWith('.'+k)) return v; }
      return null;
    })();
    if (!platform) { sendResponse({ ok: false, error: 'Unsupported platform' }); return true; }
    attachFileToPlatform(platform, file)
      .then(ok => sendResponse({ ok }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'INJECT_SHARE_FILE') {
    // Inject the CCMF file into ANY page (WhatsApp Web, Gmail, Twitter) using
    // the universal attach engine — no platform check needed here.
    const { b64, fileName } = msg;
    if (!b64 || !fileName) { sendResponse({ ok: false, error: 'Missing file data' }); return true; }
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const file  = new File([bytes], fileName, { type: 'application/json' });

    // Route through the universal MAIN-world engine via CustomEvent bridge
    // (same path used for ChatGPT / Perplexity in attachFileToPlatform)
    attachViaMainEvent('csai_universal_attach', 'csai_universal_done', file)
      .then(result => {
        if (result) {
          console.log('[LLM-Exporter] INJECT_SHARE_FILE: universal attach →', result);
          sendResponse({ ok: true });
        } else {
          // Last resort: paste/drop directly on any visible input
          const ta = findVisibleDeep([
            '[contenteditable="true"]', 'textarea', '[role="textbox"]',
            'input[type="text"]', '#main', '.copyable-area',   // WhatsApp
            '[data-testid="tweetTextarea_0"]',                  // Twitter
            'div[aria-label*="compose" i]',                     // Gmail
          ]);
          if (ta) {
            pasteFileOnElement(ta, file) || dropFileOnElement(ta, file);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'No input found on page' });
          }
        }
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'INJECT_CONTINUATION') {
    if (!ALLOWED_PLATFORMS.has(msg.platform)) {
      console.warn('[LLM-Exporter] Invalid platform:', msg.platform);
      sendResponse({ ok: false, error: 'Invalid platform' });
      return true;
    }

    // Reset flag on each new inject so the same tab can receive multiple
    // sequential injections (e.g. user loads a different export and injects again).
    // Background retry-stop logic (checking response.ok with no lastError) already
    // prevents duplicate chains — this flag is no longer needed as a gate.
    _continuationInjected = true;

    chrome.storage.local.get('ccmf', ({ ccmf }) => {
      if (!ccmf || typeof ccmf !== 'object') {
        console.warn('[LLM-Exporter] No CCMF data in storage');
        sendResponse({ ok: false, error: 'No data' });
        return;
      }
      attachWithRetry(msg.platform, buildCCMFFile(ccmf));
      // CRITICAL FIX: call sendResponse so background.js sees no lastError
      // and stops retrying immediately after first delivery.
      sendResponse({ ok: true });
    });
    return true;
  }
});


// ── Rate Limit Detector (Feature 1) ──────────────────────────────────────────
// Watches for platform-specific error notifications injected into the DOM
// ONLY when the AI itself shows a limit-exceeded message — not on page load.
(function watchForRateLimit() {
  const hostname = location.hostname;

  // Exact phrases each platform actually displays when the limit is hit.
  // These are tight on purpose — must match the real error notification text.
  // NO broad terms like "rate limit" alone — too many false positives.
  const RL_PATTERNS = {
    'chatgpt.com': [
      /you.{0,6}(reached|hit) (your )?(message |usage |daily |free )?(limit|cap)/i,
      /message limit reached/i,
      /ChatGPT is at capacity right now/i,
      /you.{0,10}used all (of )?(your )?messages/i,
      /free plan.{0,20}limit/i,
      /upgrade (your plan|to (ChatGPT )?Plus) to (send|get)/i,
    ],
    'claude.ai': [
      /you.{0,6}(reached|hit) (your )?(message |usage |daily )?limit/i,
      /you.{0,10}(run|ran) out of (usage|messages)/i,
      /your (free )?(message |usage )?limit (for today|has been reached)/i,
      /free (plan|tier).{0,20}(limit|maximum)/i,
      /Claude is currently unavailable/i,
    ],
    'gemini.google.com': [
      /you.{0,6}(reached|exceeded) (your )?(daily |usage |free )?quota/i,
      /Gemini.{0,10}(currently unavailable|at capacity)/i,
      /you.{0,10}used (up )?(your )?Gemini (Advanced |Pro )?(quota|limit)/i,
    ],
    'grok.com': [
      /you.{0,6}(reached|hit) (your )?(daily |usage )?limit/i,
      /you.{0,10}out of (free )?(Grok )?messages/i,
      /daily message (limit|cap) reached/i,
    ],
    'chat.deepseek.com': [
      /too many requests.{0,20}please (try again|slow down)/i,
      /you.{0,6}(reached|exceeded) (the |your )?(daily |usage )?limit/i,
      /server (is )?busy.{0,20}please (try|come back)/i,
    ],
    'www.perplexity.ai': [
      /you.{0,6}(reached|used up|hit) (your )?(daily |free )?query (limit|quota)/i,
      /daily (query |search )?limit (reached|exceeded)/i,
      /upgrade (to Pro )?to (send|get|ask) more/i,
    ],
    'copilot.microsoft.com': [
      /you.{0,6}reached (the |your )?conversation (limit|maximum)/i,
      /you.{0,10}hit (the |your )?daily (message |turn )?limit/i,
      /too many requests.{0,15}please (try again|slow down)/i,
    ],
    'postman.co': [
      /you.{0,6}(reached|hit) (your )?(postbot |ai )?(limit|quota|cap)/i,
      /postbot.{0,15}(limit reached|credits exhausted)/i,
      /upgrade (your plan|to enterprise) to (continue|use postbot)/i,
    ],
    'postman.com': [
      /you.{0,6}(reached|hit) (your )?(postbot |ai )?(limit|quota|cap)/i,
      /postbot.{0,15}(limit reached|credits exhausted)/i,
      /upgrade (your plan|to enterprise) to (continue|use postbot)/i,
    ],
  };

  const patterns = Object.entries(RL_PATTERNS).find(
    ([key]) => hostname === key || hostname.endsWith('.' + key)
  )?.[1];

  if (!patterns || !patterns.length) return;

  let alreadyFired = false;

  function checkText(text) {
    if (alreadyFired) return;
    // Only test short snippets (actual notification messages, not whole page dumps)
    if (!text || text.length < 8 || text.length > 600) return;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        alreadyFired = true;
        chrome.storage.local.set({ rateLimitAlert: { host: hostname, ts: Date.now() } });
        try { chrome.runtime.sendMessage({ action: 'RATE_LIMIT_DETECTED', host: hostname }); } catch(e) {}
        console.log('[LLM-Exporter] Rate limit detected on', hostname);
        rlObserver.disconnect();
        return;
      }
    }
  }

  // Only observe NEW nodes added after page load — never scan the full body.
  // This prevents false positives from help text, documentation, etc.
  const rlObserver = new MutationObserver((mutations) => {
    if (alreadyFired) { rlObserver.disconnect(); return; }
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Only check leaf nodes or small containers — not large content blocks
        const text = (node.innerText || node.textContent || '').trim();
        checkText(text);
      }
    }
  });

  const bodyEl = document.body || document.documentElement;
  if (bodyEl) {
    rlObserver.observe(bodyEl, { childList: true, subtree: true });
  }
})();

// ── Floating Action Button — embeds panel.html as iframe ────────────────────
// panel.html is a dedicated copy of popup.html for the FAB context.
// Uses inverse CSS transform to neutralise host-page browser zoom so the
// panel always looks identical in size to the extension popup.
(function injectFloatingButton() {
  // Only inject the FAB on supported AI platforms — not on YouTube, Google, etc.
  const _fabHost = location.hostname;
  const _supportedHosts = [
    'chatgpt.com', 'claude.ai', 'gemini.google.com',
    'grok.com', 'x.com',
    'chat.deepseek.com',
    'www.perplexity.ai', 'perplexity.ai',
    'copilot.microsoft.com', 'www.bing.com',
    'quark.cn', 'www.quark.cn',
    'www.doubao.com', 'doubao.com',
    'postman.co', 'postman.com',
    'lmarena.ai', 'www.lmarena.ai',
    'arena.ai', 'www.arena.ai',
    'chat.lmsys.org', 'lmsys.org',
  ];
  const _isSupported = _supportedHosts.some(h => _fabHost === h || _fabHost.endsWith('.' + h));
  if (!_isSupported) return;
  // On x.com, only show FAB on Grok path — not on the general feed, profiles, DMs etc.
  if (_fabHost === 'x.com' && !location.pathname.startsWith('/i/grok')) return;

  if (document.getElementById('__cswai_fab_host__')) return;

  // Respect fabEnabled preference — create the FAB but keep hidden if disabled
  // (We still create it so re-enabling works without a page reload)
  const host = document.createElement('div');
  host.id = '__cswai_fab_host__';
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;pointer-events:auto;';
  const shadow = host.attachShadow({ mode: 'open' });

  // Use the real extension logo — loaded from the extension package, so it's
  // never blocked by the host page's CSP (chrome-extension:// URLs are exempt).
  const _logoUrl = chrome.runtime.getURL('icons/icon128.png');
  const LOGO_IMG = `<img src="${_logoUrl}" width="34" height="34" style="pointer-events:none;display:block;border-radius:9px;" alt="MKAI">`;

  const panelUrl = chrome.runtime.getURL('panel.html');

  // ── Zoom correction ──────────────────────────────────────────────────────
  // The extension popup opens in its own Chrome window that ignores browser
  // page-zoom. The FAB iframe lives in the host tab and DOES inherit page zoom.
  // We detect the current page zoom via visualViewport.scale (most reliable)
  // and apply an inverse CSS transform so the panel matches the popup size.
  const PANEL_W = 380; // design width in CSS px
  let   iframeH = 260; // initial height — sized for T&C nudge; grows to full height once app loads

  function getZoom() {
    return (window.visualViewport && window.visualViewport.scale) || 1;
  }

  function applyZoom() {
    const z  = getZoom();
    const iz = 1 / z; // inverse zoom to counter host-page zoom

    // The iframe element is 380px CSS → at zoom z that's 380*z physical px.
    // We want it to be 380 physical px → scale it down by 1/z.
    frame.style.transform       = `scale(${iz})`;
    frame.style.transformOrigin = 'bottom right';
    frame.style.width           = PANEL_W + 'px';
    frame.style.height          = iframeH + 'px';

    // The panel wrapper clips the (now transformed) iframe.
    // Visible size = 380 * iz CSS px = 380 physical px.
    const visW = Math.ceil(PANEL_W * iz);
    const visH = Math.ceil(iframeH * iz);
    panel.style.width  = visW + 'px';
    panel.style.height = visH + 'px';
    panel.style.overflow = 'hidden';
  }

  shadow.innerHTML = `
    <style>
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      :host{display:block}

      .fab{
        width:50px;height:50px;border-radius:14px;background:#0d1017;
        border:1.5px solid rgba(0,200,255,.35);cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 16px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04);
        transition:transform .12s,box-shadow .12s,border-color .12s;
        position:relative;user-select:none;overflow:hidden;
      }
      .fab:hover{
        transform:translateY(-2px);
        box-shadow:0 6px 28px rgba(0,0,0,.75),0 0 12px rgba(0,200,255,.3);
        border-color:rgba(0,200,255,.65);
      }
      .fab:active{transform:translateY(0) scale(.95)}
      .fab img{pointer-events:none;display:block;flex-shrink:0;border-radius:9px;}

      /* green dot — shown when memory is stored */
      .dot{
        position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;
        background:#00e676;border:2px solid #07080c;display:none;
        animation:pulse 2.4s ease-in-out infinite;
      }
      .dot.show{display:block}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}

      /* tooltip */
      .tooltip{
        position:absolute;bottom:calc(100% + 8px);right:0;
        background:#18181e;border:1px solid #28282f;border-radius:7px;
        padding:5px 9px;white-space:nowrap;
        font-family:-apple-system,system-ui,sans-serif;font-size:11px;color:#c0c0cc;
        box-shadow:0 4px 14px rgba(0,0,0,.5);
        opacity:0;transform:translateY(3px);pointer-events:none;
        transition:opacity .12s,transform .12s;
      }
      .fab:hover .tooltip{opacity:1;transform:translateY(0)}

      /* panel wrapper — sized dynamically by applyZoom() */
      .panel{
        position:absolute;bottom:62px;right:0;
        display:none;
        border-radius:14px;overflow:hidden;
        box-shadow:0 8px 40px rgba(0,0,0,.75),0 0 0 1px rgba(0,200,255,.15);
      }
      .panel.open{display:block}

      /* iframe — transform applied by applyZoom() */
      iframe{
        display:block;width:380px;height:520px;border:none;
        border-radius:14px;transform-origin:bottom right;
      }
    </style>

    <div class="fab" id="fab" role="button" aria-label="MKAI">
      ${LOGO_IMG}
      <div class="dot" id="dot"></div>
      <div class="tooltip">MKAI</div>
    </div>

    <div class="panel" id="panel">
      <iframe id="frame" src="${panelUrl}" allowtransparency="true"></iframe>
    </div>
  `;

  (document.documentElement || document.body).appendChild(host);

  const fab   = shadow.getElementById('fab');
  const panel = shadow.getElementById('panel');
  const dot   = shadow.getElementById('dot');
  const frame = shadow.getElementById('frame');

  // Apply zoom correction now and whenever viewport zoom changes
  applyZoom();
  window.visualViewport && window.visualViewport.addEventListener('resize', applyZoom);

  // Auto-resize iframe height when panel content height changes (reported by popup.js)
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'csai_resize' && typeof e.data.h === 'number') {
      iframeH = Math.max(e.data.h, 220);
      applyZoom(); // re-apply with new height
    }
  });

  // Periodic heartbeat: if extension was reloaded/uninstalled, remove the orphaned FAB host
  // and iframe from the page DOM so it never fires dead callbacks or throws invalidation errors.
  const _invalidationHeartbeat = setInterval(() => {
    if (!isExtensionValid()) {
      clearInterval(_invalidationHeartbeat);
      try {
        const h = document.getElementById('__cswai_fab_host__');
        if (h) h.remove();
      } catch (_) {}
    }
  }, 1200);

  // ── FAB click toggle ─────────────────────────────────────────────────────
  // stopPropagation prevents the click from reaching the document listener below,
  // so FAB clicks ONLY trigger the toggle — never the "close on outside click".
  // Clicks anywhere outside the FAB/panel bubble up freely and close the panel.
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!isExtensionValid()) {
      try { host.remove(); } catch(_) {}
      return;
    }
    panel.classList.toggle('open');
  });

  // Close when clicking outside — bubble phase (no capture) so FAB's
  // stopPropagation above reliably blocks it from running on FAB clicks.
  document.addEventListener('click', () => {
    if (!isExtensionValid()) {
      try { host.remove(); } catch(_) {}
      return;
    }
    panel.classList.remove('open');
  });

  // Green dot — show if stored memory exists
  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get('ccmf', res => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      if (res?.ccmf && Array.isArray(res.ccmf.m) && res.ccmf.m.length > 0) dot.classList.add('show');
    });
  }

  // ── FAB visibility toggle (Feature 4) ──────────────────────────────────
  // Check storage on load and listen for changes from popup toggle
  if (isExtensionValid() && chrome?.storage?.local) {
    chrome.storage.local.get('fabEnabled', (res) => {
      if (!isExtensionValid() || chrome.runtime?.lastError) return;
      const enabled = res?.fabEnabled !== false; // default true
      host.style.display = enabled ? 'block' : 'none';
    });
  }

  if (isExtensionValid() && chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isExtensionValid()) return;
      if (area === 'local') {
        if (changes.ccmf) {
          const val = changes.ccmf.newValue;
          dot.classList.toggle('show', !!(val && Array.isArray(val.m) && val.m.length > 0));
        }
        // Show/hide FAB when popup toggles it (Feature 4 sync)
        if (changes.fabEnabled !== undefined) {
          const enabled = changes.fabEnabled.newValue !== false;
          host.style.display = enabled ? 'block' : 'none';
          // If disabled, also close the panel so it doesn't stay open while hidden
          if (!enabled) panel.classList.remove('open');
        }
      }
    });
  }
})();
