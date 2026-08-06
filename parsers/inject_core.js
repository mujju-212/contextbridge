// ContextSwitchAI — inject_core.js  (MAIN world, loaded before platform scripts)
// Universal DOM-independent file injection engine.
// Exposes: window.__csai_universalAttach(file, doneFn)
//          window.__csai_triggerFramework(input, file) → 'fiber'|'vue'|'native'
// Also listens for 'csai_universal_attach' CustomEvent so content.js can route
// ChatGPT and Perplexity through the same engine.
(function () {
  'use strict';

  // ── 1. Universal framework onChange trigger ─────────────────────────────
  // Works with: React (all versions), Vue 2, Vue 3, Svelte, Angular, plain DOM
  // Key improvement over old code: uses Object.getOwnPropertyNames + prototype
  // chain walk so non-enumerable fiber keys (minified React builds) are found.
  function triggerFramework(input, file) {
    // Set files on the input via DataTransfer
    var dt = new DataTransfer();
    dt.items.add(file);
    try {
      Object.defineProperty(input, 'files', {
        configurable: true, enumerable: true,
        get: function () { return dt.files; }
      });
    } catch (e) {}

    // ── React fiber key discovery ─────────────────────────────────────────
    // Collect keys from: own enumerable, own all (incl. non-enumerable),
    // and up to 4 prototype hops. React sometimes stores fiber on __proto__.
    var fiberKey = null;
    var seen = {};
    function scanKeys(obj) {
      if (!obj || fiberKey) return;
      var keys;
      try { keys = Object.getOwnPropertyNames(obj); } catch (e) { return; }
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (seen[k]) continue;
        seen[k] = true;
        if (k.indexOf('__reactFiber') === 0 ||
            k.indexOf('__reactInternalInstance') === 0 ||
            k.indexOf('__reactFibers') === 0) {
          fiberKey = k; return;
        }
      }
    }
    scanKeys(input);
    var proto = Object.getPrototypeOf(input);
    for (var hop = 0; hop < 5 && !fiberKey && proto; hop++) {
      scanKeys(proto);
      proto = Object.getPrototypeOf(proto);
    }

    // ── React fiber walk ──────────────────────────────────────────────────
    var usedFiber = false;
    if (fiberKey) {
      var fib = input[fiberKey];
      var depth = 0;
      while (fib && depth++ < 120) {
        var props = fib.memoizedProps || fib.pendingProps;
        if (props && typeof props.onChange === 'function') {
          var nev = new Event('change', { bubbles: true, cancelable: true });
          try { Object.defineProperty(nev, 'target', { writable: false, value: input }); } catch (e) {}
          try {
            props.onChange({
              _reactName: 'onChange', _targetInst: fib,
              type: 'change', bubbles: true, cancelable: false,
              target: input, currentTarget: input, nativeEvent: nev,
              defaultPrevented: false, isTrusted: false, timeStamp: Date.now(),
              isDefaultPrevented: function () { return false; },
              isPropagationStopped: function () { return false; },
              preventDefault: function () { this.defaultPrevented = true; },
              stopPropagation: function () {},
              stopImmediatePropagation: function () {},
              persist: function () {},
            });
            usedFiber = true;
          } catch (e) {}
          break;
        }
        fib = fib.return;
      }
    }

    // ── Vue 3 ─────────────────────────────────────────────────────────────
    if (!usedFiber) {
      try {
        var vei = input._vei;
        if (vei && vei.onChange) {
          var handlers = Array.isArray(vei.onChange) ? vei.onChange : [vei.onChange];
          handlers.forEach(function (h) { if (typeof h === 'function') h({ target: input }); });
          usedFiber = true;
        }
      } catch (e) {}
    }

    // ── Vue 2 ─────────────────────────────────────────────────────────────
    if (!usedFiber && input.__vue__) {
      try {
        input.__vue__.$emit('change', { target: input });
        usedFiber = true;
      } catch (e) {}
    }

    // ── Angular (NgModel) ─────────────────────────────────────────────────
    if (!usedFiber && input.ngModelChange) {
      try { input.ngModelChange(dt.files[0]); usedFiber = true; } catch (e) {}
    }

    // ── Native DOM fallback (plain HTML, Svelte, etc.) ────────────────────
    if (!usedFiber) {
      try { input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true })); } catch (e) {
        input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    }

    return usedFiber ? 'fiber' : 'native';
  }

  // ── 2. Deep shadow DOM file input scan ─────────────────────────────────
  function findFileInputDeep(root) {
    if (!root) return null;
    try {
      var inputs = root.querySelectorAll('input[type="file"]');
      if (inputs.length) return inputs[0];
    } catch (e) {}
    try {
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var sr = all[i].shadowRoot;
        if (sr) {
          var inner = findFileInputDeep(sr);
          if (inner) return inner;
        }
      }
    } catch (e) {}
    return null;
  }

  // ── 3. Smart attach-button finder — NO hardcoded selectors ─────────────
  // Scores every visible interactive element semantically.
  // Works on any platform without knowing the DOM structure.
  var ATTACH_KEYWORDS = /\b(attach|upload|file|add\s+file|add\s+content|photo|image|clip|paperclip|document|browse)\b/i;
  var SEND_KEYWORDS   = /\b(send|submit|post|enter|search|go)\b/i;
  var ICON_HINTS      = /paperclip|attach|upload|clip|file-add/i;

  function findAttachTrigger() {
    var candidates = [];
    var viewportH = window.innerHeight;

    var els = document.querySelectorAll(
      'button, label, [role="button"], [role="menuitem"], [tabindex="0"], ' +
      '[aria-label], a[href="#"], [aria-haspopup]'
    );

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var r  = el.getBoundingClientRect();
      // Must be visible
      if (r.width === 0 || r.height === 0) continue;
      // Must be in lower 60% of page (compose area, not top nav)
      if (r.bottom < viewportH * 0.25) continue;

      var score = 0;
      var labelText = [
        el.getAttribute('aria-label') || '',
        el.getAttribute('title')       || '',
        el.getAttribute('data-testid') || '',
        el.id                          || '',
        (el.textContent || '').slice(0, 80),
      ].join(' ');

      if (ATTACH_KEYWORDS.test(labelText)) score += 25;
      if (SEND_KEYWORDS.test(labelText))   score -= 40; // definitely not attach

      // SVG / icon content hints
      var inner = el.innerHTML || '';
      if (ICON_HINTS.test(inner)) score += 15;
      // Common paperclip SVG path fragment
      if (inner.indexOf('21.44') !== -1 || inner.indexOf('18.5') !== -1) score += 10;

      // Direct label[for] linking to a file input — strongest signal
      var forAttr = el.getAttribute('for') || el.htmlFor;
      if (forAttr) {
        var linked = document.getElementById(forAttr);
        if (linked && linked.type === 'file') score += 60;
      }

      // Small square buttons near textarea are likely toolbar actions
      if (r.width < 55 && r.height < 55 && score > 0) score += 5;

      if (score > 10) candidates.push({ el: el, score: score });
    }

    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.score - a.score; });
    return candidates[0].el;
  }

  // ── 4. Submenu resolver — clicks "Upload from computer" if a menu opened ─
  function clickUploadSubmenuIfPresent() {
    var SUB = /\b(upload|computer|device|local|file|browse|from\s+device|your\s+device)\b/i;
    var items = document.querySelectorAll(
      '[role="menuitem"], [role="option"], [role="listitem"], li, button'
    );
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var r    = item.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (SUB.test(item.textContent || '')) { item.click(); return true; }
    }
    return false;
  }

  // ── 5. Main universal attach function ───────────────────────────────────
  window.__csai_universalAttach = function (file, doneFn) {
    var done = false;

    // Set up intercepts BEFORE any clicking
    var origClick             = HTMLInputElement.prototype.click;
    var origCreate            = null;
    var origShowOpenFilePicker = window.showOpenFilePicker;
    var mo                    = null;

    function cleanup() {
      done = true;
      HTMLInputElement.prototype.click = origClick;
      if (origCreate) { document.createElement = origCreate; origCreate = null; }
      try {
        if (origShowOpenFilePicker !== undefined)
          window.showOpenFilePicker = origShowOpenFilePicker;
      } catch (e) {}
      if (mo) { try { mo.disconnect(); } catch (e) {} mo = null; }
    }

    function finish(method) {
      if (done) return;
      cleanup();
      doneFn(method || 'ok');
    }

    function onFileInput(input) {
      if (done) return;
      finish(triggerFramework(input, file));
    }

    // ── Strategy 1: input already in DOM (incl. shadow roots) ────────────
    var existing = findFileInputDeep(document);
    if (existing) {
      triggerFramework(existing, file);
      doneFn('direct');
      return;
    }

    // ── Strategy 2: intercept HTMLInputElement.prototype.click ───────────
    // Catches any file input that gets .click() called on it — framework
    // agnostic, works regardless of how the input was created or hidden.
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && !done) {
        onFileInput(this); return;
      }
      return origClick.apply(this, arguments);
    };

    // ── Strategy 3: intercept document.createElement ─────────────────────
    // Catches file inputs the moment they are created — before they're even
    // added to the DOM. React/Vue/Svelte all go through this.
    origCreate = document.createElement.bind(document);
    document.createElement = function (tag, opts) {
      var el = origCreate(tag, opts);
      if (typeof tag === 'string' && tag.toLowerCase() === 'input' && !done) {
        var typeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'type');
        if (typeDesc && typeDesc.set) {
          var origSetter = typeDesc.set;
          Object.defineProperty(el, 'type', {
            configurable: true,
            get: function () {
              return typeDesc.get ? typeDesc.get.call(this) : this.getAttribute('type') || '';
            },
            set: function (v) {
              origSetter.call(this, v);
              if ((v + '').toLowerCase() === 'file' && !done) {
                var self = this;
                // defer so the framework can finish configuring the element
                setTimeout(function () { onFileInput(self); }, 0);
              }
            }
          });
        }
      }
      return el;
    };

    // ── Strategy 4: intercept showOpenFilePicker (File System Access API) ─
    // Newer apps may call this instead of creating <input type=file>.
    // We can't fully fake the FileSystemFileHandle return, so we let it
    // proceed — but we also trigger our own injection via a fake input.
    if (typeof window.showOpenFilePicker === 'function') {
      window.showOpenFilePicker = function (opts) {
        window.showOpenFilePicker = origShowOpenFilePicker;
        if (!done) {
          // Create a synthetic input, set our file on it, trigger framework
          var synth = origCreate('input');
          synth.type = 'file';
          onFileInput(synth);
        }
        return origShowOpenFilePicker
          ? origShowOpenFilePicker.call(window, opts)
          : Promise.reject(new DOMException('AbortError', 'AbortError'));
      };
    }

    // ── Strategy 5: MutationObserver — watch for dynamically added inputs ─
    mo = new MutationObserver(function (mutations) {
      if (done) return;
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          if (nodes[j].nodeType !== 1) continue;
          var inp = (nodes[j].tagName === 'INPUT' && nodes[j].type === 'file')
            ? nodes[j]
            : findFileInputDeep(nodes[j]);
          if (inp) { onFileInput(inp); return; }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // ── Strategy 6: smart button trigger ─────────────────────────────────
    var btn = findAttachTrigger();
    if (btn) {
      btn.click();
      // After 500ms check if a submenu appeared (e.g. ChatGPT "Upload from computer")
      setTimeout(function () {
        if (!done) clickUploadSubmenuIfPresent();
      }, 500);
    }

    // ── Strategy 7: safety timeout — final deep scan + cleanup ───────────
    setTimeout(function () {
      if (done) return;
      cleanup();
      var inp = findFileInputDeep(document);
      if (inp) {
        triggerFramework(inp, file);
        doneFn('timeout-scan');
      } else {
        doneFn(false);
      }
    }, 7000);
  };

  // ── 6. Generic CustomEvent bridge for content.js ────────────────────────
  // ChatGPT / Perplexity / any future platform can fire 'csai_universal_attach'
  // from the isolated world, and inject_core.js handles it here in MAIN world.
  function buildFileFromDetail(d) {
    if (d.b64) {
      var bin = atob(d.b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], d.fileName, { type: d.mimeType || 'application/octet-stream' });
    }
    return new File([d.fileContent || ''], d.fileName, { type: 'application/json' });
  }

  document.addEventListener('csai_universal_attach', function (e) {
    var file = buildFileFromDetail(e.detail);
    window.__csai_universalAttach(file, function (result) {
      document.dispatchEvent(new CustomEvent('csai_universal_done', {
        detail: { result: result }
      }));
    });
  });

  // Expose helper for platform _main.js scripts
  window.__csai_triggerFramework  = triggerFramework;
  window.__csai_findFileInputDeep = findFileInputDeep;

  console.log('[CSAI] inject_core.js ready — universal DOM-independent attach engine v1');
})();
