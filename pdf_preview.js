// pdf_preview.js — ContextSwitchAI
// Extracted to a separate file to comply with MV3 CSP (no inline scripts allowed).
'use strict';

function isExtensionValid() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome?.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

window.addEventListener('error', function(e) {
  var msg = (e && (e.message || (e.error && e.error.message))) || '';
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return true;
  }
}, true);

window.addEventListener('unhandledrejection', function(e) {
  var msg = (e && (e.reason && (e.reason.message || e.reason))) || '';
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (e.preventDefault) e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    return true;
  }
}, true);

const params  = new URLSearchParams(location.search);
const dataKey = params.get('key');

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getMsgText(msg) {
  const content = msg[2];
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') return content.txt || content.text || '';
  return '';
}

function renderData(data) {
  const page    = document.getElementById('page');
  const loading = document.getElementById('loadingMsg');
  if (loading) loading.remove();

  const messages  = data.m  || [];
  const codeMap   = data.c  || {};
  const platform  = (data.p || 'AI').toUpperCase();
  const chatTitle = (data.chatTitle || 'Chat Export').trim();
  const dateStr   = new Date().toLocaleString();
  const msgCount  = messages.length;

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'doc-header';
  hdr.innerHTML =
    '<div class="doc-title">' + escHtml(chatTitle) + '</div>' +
    '<div class="doc-meta">' +
      '<span><span class="badge badge-platform">' + escHtml(platform) + '</span></span>' +
      '<span>&#x1F4AC; ' + msgCount + ' message' + (msgCount !== 1 ? 's' : '') + '</span>' +
      '<span>&#x1F4C5; ' + escHtml(dateStr) + '</span>' +
      '<span style="color:#94a3b8;font-size:10px">MKAI Export</span>' +
    '</div>';
  page.appendChild(hdr);

  // Messages
  messages.forEach(function(msg, i) {
    var isUser  = msg[0] === 'u';
    var rawText = getMsgText(msg);

    // Build code block HTML
    var codeHtml = '';
    var content  = msg[2];
    if (content && typeof content === 'object') {
      var rawC     = content.c;
      var codeRefs = rawC ? (Array.isArray(rawC) ? rawC : [rawC]) : [];
      codeRefs.forEach(function(cid) {
        var entry = codeMap[cid];
        if (!entry) return;
        var lang = entry[0] || 'text';
        var body = entry[1] || '';
        codeHtml += '<pre><span class="code-lang">' + escHtml(lang) + '</span>' + escHtml(body) + '</pre>';
      });
    }

    var div = document.createElement('div');
    div.className = 'msg ' + (isUser ? 'msg-u' : 'msg-a');
    div.innerHTML =
      '<div class="msg-header">' +
        (isUser ? '&#x1F464; You' : '&#x1F916; Assistant') +
        '<span class="msg-turn">Turn ' + (i + 1) + '</span>' +
      '</div>' +
      '<div class="msg-body">' + escHtml(rawText) + codeHtml + '</div>';
    page.appendChild(div);
  });

  document.getElementById('printBar').style.display = 'flex';
  document.title = chatTitle + ' \u2014 MKAI';

  // Auto-trigger print so the user just hits Save as PDF
  setTimeout(function() { window.print(); }, 800);
}

function showError(msg) {
  var page    = document.getElementById('page');
  var loading = document.getElementById('loadingMsg');
  if (loading) loading.remove();
  var err = document.createElement('div');
  err.className   = 'error-msg';
  err.textContent = '\u26A0 ' + msg;
  page.appendChild(err);
}

// Wire up print-bar buttons
document.addEventListener('DOMContentLoaded', function() {
  var closeBtn = document.getElementById('closeBtn');
  var printBtn = document.getElementById('printBtn');
  if (closeBtn) closeBtn.addEventListener('click', function() { window.close(); });
  if (printBtn) printBtn.addEventListener('click', function() { window.print(); });
});

if (!isExtensionValid() || !dataKey) {
  showError('No data key found in URL. Please re-export from the extension.');
} else {
  chrome.storage.local.get(dataKey, function(res) {
    if (!isExtensionValid() || chrome.runtime?.lastError) {
      showError('Could not read storage: ' + (chrome.runtime?.lastError?.message || 'Context invalidated'));
      return;
    }
    var entry = res[dataKey];
    if (!entry || !entry.data) {
      showError('Chat data not found or expired. Please export again from the extension.');
      return;
    }
    renderData(entry.data);
    // Clean up storage after reading
    if (isExtensionValid()) chrome.storage.local.remove(dataKey);
  });
}
