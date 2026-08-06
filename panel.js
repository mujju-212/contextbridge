// ── panel.js — runs only inside the FAB iframe (panel.html) ──────────────────
(function () {
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
  var _t = null;
  function _send() {
    // Measure whichever screen is currently visible, not the whole document
    var app = document.getElementById('appScreen');
    var tc  = document.getElementById('tcScreen');
    var el  = (app && app.classList.contains('visible')) ? app
            : (tc  && !tc.classList.contains('hidden'))  ? tc
            : document.body;
    var h = Math.ceil(el.getBoundingClientRect().height || el.offsetHeight);
    if (h < 100) h = document.body.scrollHeight; // fallback
    window.parent.postMessage({ type: 'csai_resize', h: h }, '*');
  }
  function _debounce() { clearTimeout(_t); _t = setTimeout(_send, 80); }
  new ResizeObserver(_debounce).observe(document.body);
  window.addEventListener('load', function(){ setTimeout(_send, 150); });
})();
