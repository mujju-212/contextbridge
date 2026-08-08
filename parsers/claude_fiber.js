// ContextSwitchAI — parsers/claude_fiber.js v3
// RUNS IN MAIN WORLD
// Strategy 1: intercept fetch/XHR to capture real working file URLs as Claude loads them
// Strategy 2: scan performance entries for already-loaded file URLs
// Strategy 3: walk React fiber to stamp UUIDs (fallback)
(function() {
  'use strict';

  // ── Global URL registry ──────────────────────────────────────────────────────
  // Maps file UUID → { url, orgUuid, fname }
  if (!window.__csaiFileRegistry) window.__csaiFileRegistry = {};
  var reg = window.__csaiFileRegistry;

  // ── Helper: parse a Claude file URL ─────────────────────────────────────────
  function parseFileUrl(url) {
    if (!url || typeof url !== 'string') return null;
    // Matches: /api/{org}/files/{uuid}/...  OR  /files/{uuid}/...
    var m = url.match(/\/api\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})/i);
    if (m) return { orgUuid: m[1], uuid: m[2], url: url };
    var m2 = url.match(/\/files\/([0-9a-f-]{36})/i);
    if (m2) return { orgUuid: '', uuid: m2[1], url: url };
    return null;
  }

  function registerUrl(url) {
    var p = parseFileUrl(url);
    if (!p) return;
    if (!reg[p.uuid]) reg[p.uuid] = { url: url, orgUuid: p.orgUuid, fname: '' };
    else if (p.orgUuid && !reg[p.uuid].orgUuid) reg[p.uuid].orgUuid = p.orgUuid;
    // Store org on body for isolated world to read
    if (p.orgUuid) document.body.setAttribute('data-csai-org', p.orgUuid);
  }

  // ── Strategy 1: Intercept fetch ──────────────────────────────────────────────
  var _origFetch = window.fetch;
  window.fetch = function(input) {
    var url = (input && typeof input === 'object') ? input.url : String(input || '');
    if (url && url.includes('/files/')) registerUrl(url);
    return _origFetch.apply(this, arguments);
  };

  // ── Strategy 2: Intercept XHR ────────────────────────────────────────────────
  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (url && url.includes('/files/')) registerUrl(String(url));
    return _origOpen.apply(this, arguments);
  };

  // ── Strategy 3: Scan performance entries for already-loaded file URLs ────────
  function scanPerformance() {
    try {
      performance.getEntriesByType('resource').forEach(function(e) {
        if (e.name && e.name.includes('/files/')) registerUrl(e.name);
      });
    } catch(e) {}
  }
  scanPerformance();

  // ── Strategy 4: Scan img srcs already in DOM ─────────────────────────────────
  function scanImgs() {
    document.querySelectorAll('img[src*="/files/"]').forEach(function(img) {
      registerUrl(img.src);
    });
  }
  scanImgs();

  // ── Strategy 5: React fiber walk to get fname + stamp chips ─────────────────
  function stampChips() {
    var chipSels = [
      '[data-testid="file-thumbnail"]',
      '[data-testid="user-attachment"]',
      '[data-testid="user-attachment-image"]',
      '[data-testid*="attachment"]',
      '[data-testid*="file-chip"]',
      '[data-testid*="image-chip"]',
    ];
    var seen = new Set(), chips = [];
    chipSels.forEach(function(sel) {
      try { document.querySelectorAll(sel).forEach(function(el) {
        if (!seen.has(el)) { seen.add(el); chips.push(el); }
      }); } catch(e) {}
    });
    // Also img[src*="/files/"] wrappers
    document.querySelectorAll('img[src*="/files/"]').forEach(function(img) {
      var c = img.closest('[data-testid]') || img.parentElement;
      if (c && !seen.has(c)) { seen.add(c); chips.push(c); }
    });

    var orgUuid = document.body.getAttribute('data-csai-org') || '';

    chips.forEach(function(chip) {
      // Try to extract uuid from img src first (most reliable)
      var img = chip.querySelector('img[src*="/files/"]') || (chip.tagName === 'IMG' && chip.src && chip.src.includes('/files/') ? chip : null);
      if (img) {
        registerUrl(img.src);
        var p = parseFileUrl(img.src);
        if (p) {
          chip.setAttribute('data-csai-uuid', p.uuid);
          if (p.orgUuid) { chip.setAttribute('data-csai-org-local', p.orgUuid); orgUuid = p.orgUuid; }
        }
      }

      // Then try React fiber for fname
      if (chip.getAttribute('data-csai-uuid') && chip.getAttribute('data-csai-fname')) return;

      var candidates = [chip].concat(Array.from(chip.children || []));
      for (var ci = 0; ci < candidates.length; ci++) {
        var node = candidates[ci];
        if (!node) continue;
        var fk = Object.keys(node).find(function(k) {
          return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance') || k.startsWith('__reactProps');
        });
        if (!fk) continue;
        var cur = node[fk], depth = 0;
        while (cur && depth < 80) {
          var props = cur.memoizedProps || cur.pendingProps || {};
          var fileObj = props.file || props.attachment || props.image || props.fileData || props.item || null;
          if (fileObj && typeof fileObj === 'object' && !fileObj.nodeType) {
            var uuid  = fileObj.file_uuid || fileObj.uuid || fileObj.id || fileObj.fileUuid || '';
            var fname = fileObj.file_name  || fileObj.name || fileObj.fileName || fileObj.filename || '';
            if (uuid) { chip.setAttribute('data-csai-uuid', uuid); if (fname) reg[uuid] = reg[uuid] || {}; if (fname) reg[uuid].fname = fname; }
            if (fname) chip.setAttribute('data-csai-fname', fname);
          }
          if (!orgUuid && typeof props.organizationUuid === 'string' && props.organizationUuid.length > 10) {
            orgUuid = props.organizationUuid;
          }
          cur = cur.return; depth++;
        }
        break;
      }
    });

    if (orgUuid) document.body.setAttribute('data-csai-org', orgUuid);

    // Stamp registry onto body as JSON for isolated world to read
    try { document.body.setAttribute('data-csai-registry', JSON.stringify(reg)); } catch(e) {}
  }

  // Run stamp immediately and also after a short delay (React may not be ready yet)
  stampChips();
  setTimeout(stampChips, 500);
  setTimeout(stampChips, 1500);

  // Re-scan on DOM mutations (lazy-loaded images / new chips)
  var mo = new MutationObserver(function() { scanImgs(); });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: false });

})();
