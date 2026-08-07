// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// folderIndex.js — v1.0  File System Access API + IndexedDB Folder Indexer
// ══════════════════════════════════════════════════════════════════════════════
//
// Scans the ContextSwitchAI folder on the Desktop (or any user-chosen folder),
// indexes every valid CCMF .json file, and persists indexed data in IndexedDB
// so the semantic search engine can work across ALL your exports — not just
// the ones currently loaded in chrome.storage.
//
// Key capabilities:
//   • Persistent directory handle via File System Access API
//   • Incremental indexing: only re-parses files whose lastModified changed
//   • Stale-entry pruning: removes index entries for deleted files
//   • Per-file TF-IDF precomputation for fast search
//   • Chunk-level indexing: messages stored individually for granular matching
//   • Full CCMF support: text, code blocks, attachments
//
// ══════════════════════════════════════════════════════════════════════════════
'use strict';

const _FIDB_NAME    = 'csai_folder_index_v2';
const _FIDB_VER     = 2;
const _ST_HANDLES   = 'folder_handles';
const _ST_FILES     = 'indexed_files';
const _ST_CHUNKS    = 'message_chunks';
const _ST_TERMS     = 'term_stats';   // global IDF stats
const _ST_META      = 'meta';

// ─────────────────────────────────────────────────────────────────────────────
// §1  IDB HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _openFIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(_FIDB_NAME, _FIDB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(_ST_HANDLES))
        db.createObjectStore(_ST_HANDLES);

      if (!db.objectStoreNames.contains(_ST_FILES)) {
        const s = db.createObjectStore(_ST_FILES, { keyPath: 'id' });
        s.createIndex('platform', 'platform', { unique: false });
        s.createIndex('ts',       'ts',       { unique: false });
      }

      if (!db.objectStoreNames.contains(_ST_CHUNKS)) {
        const s = db.createObjectStore(_ST_CHUNKS, { keyPath: 'cid' });
        s.createIndex('fileId', 'fileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(_ST_TERMS))
        db.createObjectStore(_ST_TERMS);

      if (!db.objectStoreNames.contains(_ST_META))
        db.createObjectStore(_ST_META);
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function _get(db, store, key) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

function _put(db, store, val, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const r  = key !== undefined
      ? tx.objectStore(store).put(val, key)
      : tx.objectStore(store).put(val);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

function _del(db, store, key) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror   = e => rej(e.target.error);
  });
}

function _getAll(db, store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

function _getAllByIndex(db, store, index, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r  = tx.objectStore(store).index(index).getAll(key);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

function _clearStore(db, store) {
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).clear();
    r.onsuccess = () => res();
    r.onerror   = e => rej(e.target.error);
  });
}

function _bulkPut(db, store, items) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    items.forEach(item => os.put(item));
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

function _bulkDelete(db, store, keys) {
  return new Promise((res, rej) => {
    if (!keys.length) return res();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    keys.forEach(k => os.delete(k));
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §2  TEXT EXTRACTION FROM CCMF
// ─────────────────────────────────────────────────────────────────────────────

function _msgText(msg) {
  const c = msg[2];
  if (!c) return '';
  if (typeof c === 'string') return c;
  return c.txt || c.text || '';
}

function _msgCode(msg, codeMap) {
  const c = msg[2];
  if (!c || typeof c !== 'object') return '';
  const refs = Array.isArray(c.c) ? c.c : (c.c ? [c.c] : []);
  return refs
    .map(r => codeMap[r] ? (codeMap[r][0] || '') + '\n' + codeMap[r][1] : '')
    .join('\n');
}

function _msgAttachNames(msg, attMap) {
  const c = msg[2];
  if (!c || typeof c !== 'object') return '';
  const refs = Array.isArray(c.a) ? c.a : (c.a ? [c.a] : []);
  return refs
    .map(r => attMap[r] ? attMap[r].name || '' : '')
    .filter(Boolean)
    .join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  TOKENISATION & TF COMPUTATION
//     Shared with semanticSearch.js — kept here for self-contained indexing
// ─────────────────────────────────────────────────────────────────────────────

const _FI_SW = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','can',
  'i','you','he','she','it','we','they','me','him','her','us','them','my',
  'your','his','its','our','their','this','that','these','those','what',
  'which','who','how','why','when','where','not','no','so','then','just',
  'also','very','more','some','any','all','get','got','let','use','make',
  'know','go','see','come','want','like','much','many','up','out','about',
  'if','while','than','such','new','one','two','three','can\'t','don\'t',
  'won\'t','it\'s','i\'m','i\'ve','they\'re','we\'re','there','here',
]);

function _fiTok(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')          // strip URLs
    .replace(/```[\s\S]*?```/g, ' CODE ')      // vault code blocks
    .replace(/`[^`\n]{1,200}`/g, ' SNIPPET ')  // vault inline code
    .replace(/[^a-z0-9\s_#$@]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !_FI_SW.has(t));
}

function _fiStem(tok) {
  // Light Snowball-style suffix stripping
  if (tok.endsWith('ing') && tok.length > 6) return tok.slice(0, -3);
  if (tok.endsWith('tion') && tok.length > 7) return tok.slice(0, -4);
  if (tok.endsWith('ness') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ment') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('able') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ible') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ical') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ated') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('edly') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('edly') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ous')  && tok.length > 5) return tok.slice(0, -3);
  if (tok.endsWith('ful')  && tok.length > 5) return tok.slice(0, -3);
  if (tok.endsWith('ive')  && tok.length > 5) return tok.slice(0, -3);
  if (tok.endsWith('ly')   && tok.length > 5) return tok.slice(0, -2);
  if (tok.endsWith('ed')   && tok.length > 4) return tok.slice(0, -2);
  if (tok.endsWith('er')   && tok.length > 4) return tok.slice(0, -2);
  if (tok.endsWith('est')  && tok.length > 5) return tok.slice(0, -3);
  if (tok.endsWith('s')    && tok.length > 3 && !tok.endsWith('ss')) return tok.slice(0, -1);
  return tok;
}

function _computeTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    const stem = _fiStem(t);
    tf[stem] = (tf[stem] || 0) + 1;
  }
  return tf;
}

// Character trigrams for fuzzy matching
function _trigrams(word) {
  const s = '$$' + word + '$$';
  const tg = new Set();
  for (let i = 0; i < s.length - 2; i++) {
    tg.add(s.slice(i, i + 3));
  }
  return tg;
}

function _trigramSet(text) {
  const tg = new Set();
  _fiTok(text).forEach(w => {
    if (w.length >= 3) _trigrams(w).forEach(t => tg.add(t));
  });
  return tg;
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  CCMF PARSING & CHUNK EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function _parseCCMF(jsonText, fileName) {
  try {
    const data = JSON.parse(jsonText);
    if (!data || !Array.isArray(data.m) || data.m.length === 0) return null;
    return data;
  } catch (e) { return null; }
}

function _buildFileRecord(data, fileName, lastModified, size) {
  const msgs    = data.m  || [];
  const codeMap = data.c  || {};
  const attMap  = data.att|| {};

  // Build full text for the file
  const allText = msgs.map(m =>
    _msgText(m) + ' ' + _msgCode(m, codeMap) + ' ' + _msgAttachNames(m, attMap)
  ).join(' ');

  const tokens  = _fiTok(allText);
  const tf      = _computeTF(tokens);
  const tgSet   = _trigramSet(allText.slice(0, 4000)); // cap for perf

  // Unique term set (stems) for IDF calculation
  const termSet = Object.keys(tf);

  return {
    id:           `folder::${fileName}`,
    fileName,
    lastModified,
    size,
    platform:     data.p || 'unknown',
    chatTitle:    data.chatTitle || fileName.replace(/\.json$/i, ''),
    ts:           data.exportedAt || data.ts || lastModified || Date.now(),
    msgCount:     msgs.length,
    codeCount:    Object.keys(codeMap).length,
    hasCode:      Object.keys(codeMap).length > 0,
    tf,
    termSet,
    tgrams:       [...tgSet],
    data,           // full CCMF data for import
  };
}

function _buildChunkRecords(fileId, data) {
  const msgs    = data.m  || [];
  const codeMap = data.c  || {};
  const attMap  = data.att|| {};
  const chunks  = [];

  msgs.forEach((msg, idx) => {
    const role = msg[0];
    const text = _msgText(msg);
    const code = _msgCode(msg, codeMap);
    const full = text + (code ? '\n' + code : '');

    if (full.trim().length < 12) return;

    const tokens = _fiTok(full);
    const tf     = _computeTF(tokens);

    chunks.push({
      cid:    `${fileId}::${idx}`,
      fileId,
      msgIdx: idx,
      role,
      text:   text.slice(0, 1200),    // store truncated for memory
      hasCode:code.length > 20,
      tf,
      wc: tokens.length,
    });
  });

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  GLOBAL TERM STATS (for IDF)
// ─────────────────────────────────────────────────────────────────────────────

async function _rebuildTermStats(db) {
  const files = await _getAll(db, _ST_FILES);
  const df = {};   // document frequency per stem

  for (const f of files) {
    for (const term of (f.termSet || [])) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  await _put(db, _ST_TERMS, { df, N: files.length }, 'global');
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  PUBLIC FOLDERINDEX API
// ─────────────────────────────────────────────────────────────────────────────

const FolderIndex = {
  _db: null,

  async init() {
    if (!this._db) this._db = await _openFIDB();
    return this._db;
  },

  async hasFolder() {
    try {
      const db = await this.init();
      const h  = await _get(db, _ST_HANDLES, 'main');
      return !!h;
    } catch (e) { return false; }
  },

  async requestFolder() {
    if (!window.showDirectoryPicker) {
      throw new Error('File System Access API is not supported in this browser. Please use Chrome 86+.');
    }
    const handle = await window.showDirectoryPicker({
      mode:    'read',
      startIn: 'downloads',
    });
    const db = await this.init();
    await _put(db, _ST_HANDLES, handle, 'main');
    return handle;
  },

  async getFolder() {
    const db = await this.init();
    return _get(db, _ST_HANDLES, 'main');
  },

  async getFolderName() {
    const h = await this.getFolder();
    return h ? h.name : null;
  },

  async verifyPermission(handle) {
    try {
      const opts = { mode: 'read' };
      if (await handle.queryPermission(opts) === 'granted')  return true;
      if (await handle.requestPermission(opts) === 'granted') return true;
      return false;
    } catch (e) { return false; }
  },

  // ── Scan & index the linked folder ───────────────────────────────────────
  async scanAndIndex(onProgress) {
    const db     = await this.init();
    const handle = await this.getFolder();
    if (!handle) return { added: 0, updated: 0, removed: 0, total: 0, error: 'No folder linked. Click "Link Folder" first.' };

    const ok = await this.verifyPermission(handle);
    if (!ok) return { added: 0, updated: 0, removed: 0, total: 0, error: 'Permission denied. Re-link the folder.' };

    const existing    = await _getAll(db, _ST_FILES);
    const existingMap = new Map(existing.map(f => [f.fileName, f]));

    let added = 0, updated = 0, removed = 0, total = 0;
    const scannedNames = new Set();
    const newFiles     = [];
    const newChunks    = [];

    try {
      for await (const [name, fHandle] of handle.entries()) {
        if (fHandle.kind !== 'file' || !name.endsWith('.json')) continue;

        const file = await fHandle.getFile();
        scannedNames.add(name);
        total++;

        if (onProgress) onProgress(total, name);

        const prev = existingMap.get(name);
        if (prev && prev.lastModified === file.lastModified) continue; // unchanged

        const text  = await file.text();
        const ccmf  = _parseCCMF(text, name);
        if (!ccmf) continue;

        const fileRec = _buildFileRecord(ccmf, name, file.lastModified, file.size);
        const chunks  = _buildChunkRecords(fileRec.id, ccmf);

        newFiles.push(fileRec);
        newChunks.push(...chunks);
        if (prev) updated++; else added++;
      }
    } catch (e) {
      console.warn('[CSAI FolderIndex] Scan error:', e);
      return { added, updated, removed, total, error: e.message };
    }

    // Write new/updated file records (without full data to save IDB space — keep data separately)
    if (newFiles.length) {
      await _bulkPut(db, _ST_FILES, newFiles);
    }

    // Remove stale chunk entries for re-indexed files
    const updatedIds = new Set(newFiles.map(f => f.id));
    if (updatedIds.size) {
      const staleChunks = (await _getAll(db, _ST_CHUNKS)).filter(c => updatedIds.has(c.fileId));
      await _bulkDelete(db, _ST_CHUNKS, staleChunks.map(c => c.cid));
      if (newChunks.length) await _bulkPut(db, _ST_CHUNKS, newChunks);
    }

    // Prune deleted files
    const folderFiles = await _getAll(db, _ST_FILES);
    const staleFiles  = folderFiles.filter(f => f.id.startsWith('folder::') && !scannedNames.has(f.fileName));
    if (staleFiles.length) {
      await _bulkDelete(db, _ST_FILES, staleFiles.map(f => f.id));
      const staleChunks = (await _getAll(db, _ST_CHUNKS)).filter(c =>
        staleFiles.some(f => f.id === c.fileId)
      );
      await _bulkDelete(db, _ST_CHUNKS, staleChunks.map(c => c.cid));
      removed = staleFiles.length;
    }

    // Rebuild IDF stats
    await _rebuildTermStats(db);

    return { added, updated, removed, total, error: null };
  },

  // ── Retrieve all indexed entries as search-ready objects ─────────────────
  async getAllIndexed() {
    const db = await this.init();
    return _getAll(db, _ST_FILES);
  },

  async getChunks(fileId) {
    const db = await this.init();
    return fileId
      ? _getAllByIndex(db, _ST_CHUNKS, 'fileId', fileId)
      : _getAll(db, _ST_CHUNKS);
  },

  async getTermStats() {
    const db = await this.init();
    const s  = await _get(db, _ST_TERMS, 'global');
    return s || { df: {}, N: 0 };
  },

  async getStats() {
    const db    = await this.init();
    const files = await _getAll(db, _ST_FILES);
    const fname = await this.getFolderName();
    return {
      total:      files.length,
      folderName: fname || null,
      platforms:  [...new Set(files.map(f => f.platform))].filter(p => p !== 'unknown'),
      totalMsgs:  files.reduce((s, f) => s + (f.msgCount || 0), 0),
      hasCode:    files.filter(f => f.hasCode).length,
    };
  },

  async clearIndex() {
    const db = await this.init();
    await _clearStore(db, _ST_FILES);
    await _clearStore(db, _ST_CHUNKS);
    await _clearStore(db, _ST_TERMS);
  },

  async forgetFolder() {
    const db = await this.init();
    await _del(db, _ST_HANDLES, 'main');
    await this.clearIndex();
  },
};

// Expose globally for popup.js / panel.js
if (typeof window !== 'undefined') window.CSAI_FolderIndex = FolderIndex;
if (typeof module !== 'undefined' && module.exports) module.exports = { FolderIndex };
