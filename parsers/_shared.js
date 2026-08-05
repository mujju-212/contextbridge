// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// _shared.js — v2.0  shared utilities
// Compression & deduplication is fully delegated to tokenReducer.js
// which MUST be loaded before this file in every content_script entry.
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CODE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function normaliseCodeBlock(codeEl) {
  let lang = '';
  for (const cls of codeEl.classList) {
    if (cls.startsWith('language-')) { lang = cls.slice(9).toLowerCase(); break; }
  }
  let body = (codeEl.innerText || codeEl.textContent || '').trim();
  if (!lang && body) {
    const nl = body.indexOf('\n');
    if (nl > 0) {
      const first = body.slice(0, nl).trim();
      if (/^[A-Za-z][A-Za-z0-9+#\-.]*$/.test(first) && first.length <= 20) {
        lang = first.toLowerCase();
        body = body.slice(nl + 1).trim();
      }
    }
  }
  return { lang: lang || 'text', body };
}

function extractCode(node, codeMap, cIdx) {
  const codeRefs = [];
  node.querySelectorAll('pre').forEach(pre => {
    const el = pre.querySelector('code') || pre;
    const { lang, body } = normaliseCodeBlock(el);
    if (!body || body.length < 15) return;
    if (!body.includes('\n') && !body.includes(' ') && body.length < 40) return;
    const cId = 'c' + cIdx++;
    codeMap[cId] = [lang, body];
    codeRefs.push(cId);
  });
  return { codeRefs, cIdx };
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTACHMENT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
function extractAttachments(node, attachMap, fIdx, tId, opts) {
  opts = opts || {};
  const refs = [];

  const chipSels = (opts.chipSels || []).concat([
    '[data-testid*="file"]',
    '[data-testid*="attachment"]',
    '[data-testid*="upload"]',
    '[class*="fileChip"]',
    '[class*="file-chip"]',
    '[class*="attachment-chip"]',
    '[class*="attachmentChip"]',
    '[class*="uploadChip"]',
    '[class*="filePreview"]',
    '[class*="file-preview"]',
    '[class*="fileThumbnail"]',
    '[class*="file-thumbnail"]',
    '[class*="uploadedFile"]',
    '[class*="uploaded-file"]',
    // PDF and document-specific
    '[class*="pdfChip"]',
    '[class*="pdf-chip"]',
    '[class*="docChip"]',
    '[class*="doc-chip"]',
    '[class*="FileCard"]',
    '[class*="file-card"]',
    '[class*="DocumentPreview"]',
    '[class*="document-preview"]',
    '[class*="AttachmentPreview"]',
    '[class*="attachment-preview"]',
  ]);
  const seen = new Set();
  const addAttach = (type, name, url) => {
    const key = type + '::' + name + '::' + url;
    if (seen.has(key)) return;
    seen.add(key);
    const fId = 'f' + fIdx++;
    attachMap[fId] = { mid: tId, name, type, url: url || '', downloadable: isDownloadable(url) };
    refs.push(fId);
  };

  for (const sel of chipSels) {
    node.querySelectorAll(sel).forEach(chip => {
      const name = chip.getAttribute('aria-label')
        || chip.getAttribute('data-filename')
        || chip.getAttribute('title')
        || chip.querySelector('[class*="fileName"],[class*="file-name"],[class*="name"]')?.textContent?.trim()
        || chip.querySelector('span,p')?.textContent?.trim()
        || 'attachment';
      const url = chip.querySelector('a[href]')?.href || chip.getAttribute('href') || '';
      const isImg = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i.test(name)
        || !!chip.querySelector('img');
      addAttach(isImg ? 'image' : 'file', name, url);
    });
  }

  const imgSels = (opts.imgSels || []).concat(['img']);
  node.querySelectorAll(imgSels.join(',')).forEach(img => {
    if (img.closest(chipSels.join(','))) return;
    const src = img.src
      || img.getAttribute('data-src')
      || img.getAttribute('data-original')
      || img.getAttribute('data-lazy-src') || '';
    if (!src) return;
    if (/favicon|s2\/favicons|icon\.png|logo\.png|avatar|spinner|loading/i.test(src)) return;
    if (src.includes('_next/image') && /[?&]w=(16|32|48|64|96)/.test(src)) return;
    if (img.getAttribute('aria-hidden') === 'true') return;
    if (img.getAttribute('role') === 'presentation') return;
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w > 0 && w < 80) return;
    if (h > 0 && h < 80) return;
    if (src.startsWith('data:image/svg')) return;
    const name = img.alt
      || img.getAttribute('data-filename')
      || img.getAttribute('title')
      || (src.startsWith('blob:') ? 'uploaded-image.png'
          : decodeURIComponent(src.split('/').pop().split('?')[0]))
      || ('image_' + fIdx);
    addAttach('image', name, src);
  });

  const FILE_EXT = /\.(pdf|zip|csv|txt|docx|xlsx|pptx|doc|xls|ppt|odt|epub|png|jpg|jpeg|gif|webp|mp4|mp3|json|py|js|ts|html|css|md)(\?|$)/i;
  node.querySelectorAll('a[href]').forEach(a => {
    const href = a.href || '';
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
    if (a.closest(chipSels.join(','))) return;
    const hasDownload = a.hasAttribute('download');
    const matchesExt  = FILE_EXT.test(href);
    const inContainer = !!a.closest('[class*="file"],[class*="attachment"],[class*="upload"],[class*="document"],[class*="pdf"]');
    if (!hasDownload && !matchesExt && !inContainer) return;
    const name = a.download || a.getAttribute('data-filename')
      || a.textContent.trim()
      || href.split('/').pop().split('?')[0] || 'file';
    addAttach('file', name, href);
  });

  return { refs, fIdx };
}

function isDownloadable(url) {
  if (!url) return false;
  if (url.startsWith('blob:')) return false;
  if (url.startsWith('data:')) return false;
  if (/oaiusercontent\.com/.test(url)) return false;
  if (/anthropic\.com/.test(url)) return false;
  if (/gemini\.google\.com/.test(url)) return false;
  if (/grok\.com/.test(url)) return false;
  return url.startsWith('http');
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
function stripAndGetText(node, extra) {
  const clone = node.cloneNode(true);
  ["pre", "button", "svg", "[aria-hidden='true']", ".sr-only"]
    .concat(extra || [])
    .forEach(s => { try { clone.querySelectorAll(s).forEach(e => e.remove()); } catch(e){} });
  const raw = clone.innerText || clone.textContent || (node && (node.innerText || node.textContent)) || '';
  return raw.trim().replace(/\n{3,}/g, '\n\n');
}

function cleanMessageText(t) {
  return t
    .replace(/\s*\d{1,2}:\d{2}\s*(AM|PM)\s*$/i, '')
    .replace(/^Done\s*/i, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildContent(txt, codeRefs, attRefs) {
  const hasT = !!(txt && txt.length > 0);
  const hasC = !!(codeRefs && codeRefs.length > 0);
  const hasA = !!(attRefs  && attRefs.length  > 0);
  if (!hasT && !hasC && !hasA) return null;
  if (!hasC && !hasA) return txt;
  const c = {};
  if (hasT) c.txt = txt;
  if (hasC) c.c   = codeRefs.length === 1 ? codeRefs[0] : codeRefs;
  if (hasA) c.att = attRefs.length  === 1 ? attRefs[0]  : attRefs;
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// CCMF ASSEMBLER  — delegates compression+dedup to tokenReducer.js
//
// Load order in manifest MUST be:
//   ["parsers/tokenReducer.js", "parsers/_shared.js", "parsers/<platform>.js", "content.js"]
//
// tokenReducer.js exposes: runTokenReduction(messages) → { messages, stats }
// ─────────────────────────────────────────────────────────────────────────────
function assembleCCMF(platform, messages, timestamps, codeMap, attachMap) {
  // Delegate ALL compression + deduplication to tokenReducer.js
  const { messages: compressed, stats } = runTokenReduction(messages);

  const cleanTs = {};
  compressed.forEach(m => { if (timestamps[m[1]]) cleanTs[m[1]] = timestamps[m[1]]; });

  const out = { v: 2, p: platform, m: compressed, t: cleanTs };
  if (Object.keys(codeMap).length   > 0) out.c   = codeMap;
  if (Object.keys(attachMap).length > 0) out.att  = attachMap;

  out.tokenStats = {
    rawChatTokens   : stats.raw,
    compressedTokens: stats.compressed,
    reductionPercent: stats.reductionPercent,
    note            : stats.note,
  };

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT PREAMBLE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildContextPreamble(platform, messageCount, notes, openingPrompt) {
  const lines = [];
  lines.push('=== LLM MEMORY EXPORT ===');
  lines.push('Source: ' + platform + ' | ' + messageCount + ' messages');
  lines.push('Exported: ' + new Date().toISOString().slice(0,10));
  lines.push('');
  lines.push('INSTRUCTIONS FOR AI: This file contains a compressed export of a prior');
  lines.push('conversation. Please read the notes and context below, then resume');
  lines.push('naturally as if continuing from where we left off.');
  lines.push('');

  if (notes && notes.length > 0) {
    lines.push('--- NOTES FROM USER ---');
    notes.forEach((n, i) => {
      lines.push((i + 1) + '. ' + n.text);
    });
    lines.push('');
  }

  if (openingPrompt && openingPrompt.trim()) {
    lines.push('--- OPENING REQUEST ---');
    lines.push(openingPrompt.trim());
    lines.push('');
  }

  lines.push('--- CONVERSATION FOLLOWS ---');
  return lines.join('\n');
}

function injectContextPreamble(data) {
  const notes         = Array.isArray(data.notes) ? data.notes : [];
  const openingPrompt = data._openingPrompt || '';
  data._context = buildContextPreamble(
    data.p || 'unknown',
    (data.m || []).length,
    notes,
    openingPrompt
  );
  return data;
}
