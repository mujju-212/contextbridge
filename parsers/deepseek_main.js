// ContextSwitchAI — deepseek_main.js  (MAIN world)
// Delegates to window.__csai_universalAttach (inject_core.js, loaded first).
(function () {
  'use strict';
  function buildFile(d) {
    if (d.b64) {
      var bin = atob(d.b64), u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new File([u8], d.fileName, { type: d.mimeType || 'application/octet-stream' });
    }
    return new File([d.fileContent || ''], d.fileName, { type: 'application/json' });
  }
  document.addEventListener('csai_deepseek_attach', function (e) {
    var file = buildFile(e.detail);
    window.__csai_universalAttach(file, function (result) {
      document.dispatchEvent(new CustomEvent('csai_deepseek_done', { detail: { result: result } }));
    });
  });
  console.log('[CSAI] deepseek_main.js ready (universal engine)');
})();
