// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// background.js — v2.0  service worker
'use strict';

// Check if the extension runtime context is still alive
function isExtensionValid() {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome?.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

self.addEventListener('error', (event) => {
  const msg = event?.message || event?.error?.message || (typeof event === 'string' ? event : '');
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return true;
  }
});

self.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || String(event?.reason || '');
  if (typeof msg === 'string' && /extension context invalidated/i.test(msg)) {
    if (event.preventDefault) event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    return true;
  }
});

const ALLOWED_PLATFORMS = new Set([
  'chatgpt','claude','gemini','grok','deepseek','perplexity','copilot','quark','doubao','postman','lmarena'
]);

const PLATFORM_URLS = {
  chatgpt    : 'https://chatgpt.com/',
  claude     : 'https://claude.ai/new',
  gemini     : 'https://gemini.google.com/app',
  grok       : 'https://grok.com/',
  deepseek   : 'https://chat.deepseek.com/',
  perplexity : 'https://www.perplexity.ai/',
  copilot    : 'https://copilot.microsoft.com/',
  quark      : 'https://quark.cn/',
  doubao     : 'https://www.doubao.com/',
  postman    : 'https://web.postman.co/',
  lmarena    : 'https://lmarena.ai/',
};

function isSafeUrl(url) {
  return Object.values(PLATFORM_URLS).includes(url);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isExtensionValid()) return;
  const fromContentScript = !!sender.tab;

  if (fromContentScript) {
    const allowedFromContent = new Set(['EXPORT', 'INJECT_CONTINUATION', 'STORE_DATA', 'OPEN_POPUP', 'EXEC_IN_MAIN_WORLD', 'CONTINUE_ON', 'INJECT_RAW_FILE', 'SHARE_FILE_TO']);
    if (!allowedFromContent.has(msg.action)) return;
  }

  // Open the extension popup when the FAB is clicked on a supported page
  if (msg.action === 'OPEN_POPUP') {
    try {
      chrome.action.openPopup();
    } catch(e) {
      // openPopup() may fail in some contexts — silently ignore
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── EXEC_IN_MAIN_WORLD ─────────────────────────────────────────────────────
  // Content scripts cannot call chrome.scripting directly. They send this message
  // so background can call executeScript({ world: 'MAIN' }) — which runs in the
  // page's JS context (React fiber access etc.) without any inline <script> tag,
  // completely sidestepping the page's Content Security Policy.
  // The return value is written to chrome.storage.local under resultKey so the
  // content-script poll in runInMainWorld() can pick it up.
  // ── EXEC_PRELOADED_MAIN ────────────────────────────────────────────────────
  // Used for Claude and Grok — calls a pre-registered window.__csai_*Attach function
  // that was loaded via a MAIN-world content script file.
  // Unlike EXEC_IN_MAIN_WORLD, this does NOT use new Function() / eval, so it
  // works even on pages with strict CSP (no 'unsafe-eval') like claude.ai and grok.com.
  if (msg.action === 'EXEC_PRELOADED_MAIN') {
    const { winFnName, fileText, fileName, resultKey } = msg;
    const tabId = sender.tab && sender.tab.id;
    if (!tabId || !winFnName || !resultKey) { sendResponse({ ok: false }); return true; }

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (fnName, ft, fn) => {
        var attachFn = window[fnName];
        if (typeof attachFn !== 'function') return '__cswai_null__';
        try {
          var ret = attachFn(ft, fn);
          return ret;
        } catch (e) {
          return '__cswai_null__';
        }
      },
      args: [winFnName, fileText, fileName],
    }).then(results => {
      const val = results?.[0]?.result;
      if (isExtensionValid()) {
        chrome.storage.local.set({ [resultKey]: (val === null || val === undefined) ? '__cswai_null__' : val });
      }
    }).catch(err => {
      console.warn('[LLM-Exporter] EXEC_PRELOADED_MAIN failed:', err.message);
      if (isExtensionValid()) {
        chrome.storage.local.set({ [resultKey]: '__cswai_null__' });
      }
    });

    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'EXEC_IN_MAIN_WORLD') {
    const { fnString, args, resultKey } = msg;
    const tabId = sender.tab && sender.tab.id;
    if (!tabId || !fnString || !resultKey) {
      sendResponse({ ok: false }); return true;
    }
    chrome.scripting.executeScript({
      target : { tabId },
      world  : 'MAIN',
      func   : (fnStr, fnArgs) => {
        try {
          // eslint-disable-next-line no-new-func
          const fn  = new Function('return (' + fnStr + ')')();
          return fn.apply(null, fnArgs);
        } catch(e) {
          return '__cswai_null__';
        }
      },
      args: [fnString, args],
    }).then(results => {
      const val = results?.[0]?.result;
      if (isExtensionValid()) {
        chrome.storage.local.set({ [resultKey]: val === null || val === undefined ? '__cswai_null__' : val });
      }
    }).catch(err => {
      console.warn('[LLM-Exporter] EXEC_IN_MAIN_WORLD failed:', err.message);
      if (isExtensionValid()) {
        chrome.storage.local.set({ [resultKey]: '__cswai_null__' });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // FAB panel export — background asks the active tab's content script to export
  if (msg.action === 'CSAI_EXPORT_CURRENT') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tab' }); return true; }
    chrome.tabs.sendMessage(tabId, { action: 'EXPORT' }, res => {
      if (chrome.runtime.lastError || !res?.ok) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || res?.error || 'Export failed' });
        return;
      }
      // Store and reply
      chrome.storage.local.set({ ccmf: res.data }, () => {
        sendResponse({ ok: true, msgs: (res.data?.m || []).length });
      });
    });
    return true;
  }

  if (msg.action === 'STORE_DATA') {
    if (!msg.data || typeof msg.data !== 'object') {
      sendResponse({ ok: false, error: 'Invalid data' }); return true;
    }
    chrome.storage.local.set({ ccmf: msg.data }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'CONTINUE_ON') {
    const platform = msg.platform;
    if (!ALLOWED_PLATFORMS.has(platform)) {
      sendResponse({ ok: false, error: 'Unknown platform' }); return true;
    }
    const targetUrl = PLATFORM_URLS[platform];
    if (!targetUrl || !isSafeUrl(targetUrl)) {
      sendResponse({ ok: false, error: 'Invalid URL' }); return true;
    }

    const PLATFORM_HOSTS = {
      chatgpt    : ['chatgpt.com'],
      claude     : ['claude.ai'],
      gemini     : ['gemini.google.com'],
      grok       : ['grok.com', 'x.com'],
      deepseek   : ['deepseek.com'],
      perplexity : ['perplexity.ai'],
      copilot    : ['copilot.microsoft.com', 'bing.com'],
      quark      : ['quark.cn'],
      doubao     : ['doubao.com'],
      postman    : ['postman.co', 'postman.com'],
      lmarena    : ['lmarena.ai', 'arena.ai', 'lmsys.org'],
    };

    const tabMatchesPlatform = (tab) => {
      if (!tab || !tab.url) return false;
      try {
        const host = new URL(tab.url).hostname;
        const hosts = PLATFORM_HOSTS[platform] || [];
        return hosts.some(h => host === h || host.endsWith('.' + h));
      } catch (e) { return false; }
    };

    const deliverContinuation = (tabId, isNewTab = false) => {
      let attempts = 0;
      const MAX_ATTEMPTS = 8;
      const RETRY_INTERVAL_MS = 1000;
      const INITIAL_DELAY_MS  = isNewTab ? 2500 : 500;

      const trySend = () => {
        attempts++;
        chrome.tabs.sendMessage(
          tabId,
          { action: 'INJECT_CONTINUATION', platform },
          (response) => {
            if (chrome.runtime.lastError) {
              if (attempts < MAX_ATTEMPTS) {
                setTimeout(trySend, RETRY_INTERVAL_MS);
              } else {
                console.warn('[LLM-Exporter] BG: INJECT_CONTINUATION failed after', MAX_ATTEMPTS, 'attempts on tab', tabId);
              }
              return;
            }
            if (response?.ok) {
              console.log('[LLM-Exporter] BG: INJECT_CONTINUATION delivered to tab', tabId, 'on attempt', attempts);
            }
          }
        );
      };

      setTimeout(trySend, INITIAL_DELAY_MS);
    };

    // 1. Check if the currently active tab in the current window already matches this platform
    chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
      if (activeTab && tabMatchesPlatform(activeTab)) {
        console.log('[LLM-Exporter] Active tab already matches', platform, '— injecting into current tab:', activeTab.id);
        deliverContinuation(activeTab.id, false);
        sendResponse({ ok: true, reusedTab: true, tabId: activeTab.id });
        return;
      }

      // 2. Check if any tab in the current window matches this platform
      chrome.tabs.query({ currentWindow: true }, (windowTabs) => {
        const matchingInWindow = (windowTabs || []).find(tabMatchesPlatform);
        if (matchingInWindow) {
          console.log('[LLM-Exporter] Found matching tab in current window for', platform, '— focusing tab:', matchingInWindow.id);
          chrome.tabs.update(matchingInWindow.id, { active: true });
          deliverContinuation(matchingInWindow.id, false);
          sendResponse({ ok: true, reusedTab: true, tabId: matchingInWindow.id });
          return;
        }

        // 3. Check across all windows
        chrome.tabs.query({}, (allTabs) => {
          const matchingTab = (allTabs || []).find(tabMatchesPlatform);
          if (matchingTab) {
            console.log('[LLM-Exporter] Found matching tab in another window for', platform, '— focusing tab:', matchingTab.id);
            chrome.tabs.update(matchingTab.id, { active: true });
            if (matchingTab.windowId) chrome.windows.update(matchingTab.windowId, { focused: true });
            deliverContinuation(matchingTab.id, false);
            sendResponse({ ok: true, reusedTab: true, tabId: matchingTab.id });
            return;
          }

          // 4. No matching tab found — open new tab
          console.log('[LLM-Exporter] No existing tab for', platform, '— opening new tab:', targetUrl);
          chrome.tabs.create({ url: targetUrl }, (tab) => {
            if (!tab) { sendResponse({ ok: false, error: 'Could not open tab' }); return; }
            let fired = false;
            const listener = (tabId, info) => {
              if (tabId !== tab.id || info.status !== 'complete') return;
              if (fired) return;
              fired = true;
              chrome.tabs.onUpdated.removeListener(listener);
              deliverContinuation(tab.id, true);
            };
            chrome.tabs.onUpdated.addListener(listener);
            setTimeout(() => { if (!fired) chrome.tabs.onUpdated.removeListener(listener); }, 30000);
            sendResponse({ ok: true, createdTab: true, tabId: tab.id });
          });
        });
      });
    });

    return true;
  }

  // ── SHARE_FILE_TO ─────────────────────────────────────────────────────────
  // Opens a social platform (WhatsApp Web / Gmail / Twitter) in a new tab and
  // injects the CCMF JSON file directly into its file input using the universal
  // attach engine — same mechanism as CONTINUE_ON uses for AI platforms.
  if (msg.action === 'SHARE_FILE_TO') {
    const { target, b64, fileName } = msg;
    const SHARE_URLS = {
      whatsapp : 'https://web.whatsapp.com/',
      gmail    : 'https://mail.google.com/mail/?view=cm',
      twitter  : 'https://x.com/messages',
    };
    const url = SHARE_URLS[target];
    if (!url) { sendResponse({ ok: false, error: 'Unknown share target' }); return true; }
    if (!b64 || !fileName) { sendResponse({ ok: false, error: 'No file data' }); return true; }

    chrome.tabs.create({ url }, (tab) => {
      if (!tab) { sendResponse({ ok: false, error: 'Could not open tab' }); return; }
      let fired = false;
      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        if (fired) return;
        fired = true;
        chrome.tabs.onUpdated.removeListener(listener);

        // Delay varies: WhatsApp needs more time to render its React UI
        const delay = target === 'whatsapp' ? 4000 : target === 'gmail' ? 3000 : 3500;
        let attempts = 0;
        const MAX_ATTEMPTS = 8;

        const trySend = () => {
          attempts++;
          chrome.tabs.sendMessage(
            tab.id,
            { action: 'INJECT_SHARE_FILE', b64, fileName, target },
            (response) => {
              if (chrome.runtime.lastError) {
                if (attempts < MAX_ATTEMPTS) setTimeout(trySend, 1200);
                else console.warn('[LLM-Exporter] SHARE_FILE_TO: failed after', MAX_ATTEMPTS, 'attempts');
                return;
              }
              if (response?.ok) {
                console.log('[LLM-Exporter] SHARE_FILE_TO: file injected into', target, 'on attempt', attempts);
              }
            }
          );
        };
        setTimeout(trySend, delay);
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { if (!fired) chrome.tabs.onUpdated.removeListener(listener); }, 40000);
    });
    sendResponse({ ok: true });
    return true;
  }
});
