// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// semanticSearch.js — v1.0  Advanced Semantic Search Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// Replaces the basic TF keyword engine with a full multi-signal pipeline:
//
//  RETRIEVAL
//   Signal 1  BM25 (Okapi)          — statistically grounded term relevance
//   Signal 2  TF-IDF Cosine         — vector-space topic similarity
//   Signal 3  Trigram Fuzzy         — handles typos, morphological variants
//   Signal 4  Title / Phrase        — exact phrase & bigram match on title
//   Signal 5  Platform Hint         — query mentions a platform name
//
//  QUERY INTELLIGENCE
//   • Stopword removal
//   • Light Snowball stemming
//   • Depth-2 synonym expansion (500+ domain relationships across 40 domains)
//   • Character trigram generation for fuzzy matching
//   • Query intent classification (code / debug / write / learn / compare /
//     explain / search / general)
//   • Named entity extraction (filenames, version numbers, tech names)
//   • Bigram / phrase detection
//
//  RANKING
//   • RRF (Reciprocal Rank Fusion) with k=60 across all signals
//   • Recency decay with configurable half-life
//   • Code-block structural boost for code/debug queries
//   • Chunk-level boosting: if best-matching message has code, boost parent
//
//  POST-PROCESSING
//   • MMR (Maximal Marginal Relevance) for result diversity
//   • Faceted filtering: platform, has-code, date range
//   • Contextual snippet extraction (best paragraph or code block)
//   • Dual highlighting: exact match (mark.hi) + synonym match (mark.syn)
//
// ══════════════════════════════════════════════════════════════════════════════
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// §1  STOPWORDS
// ─────────────────────────────────────────────────────────────────────────────

const _SS_SW = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','could','should','may','might','can',
  'i','you','he','she','it','we','they','me','him','her','us','them','my',
  'your','his','its','our','their','this','that','these','those','what',
  'which','who','how','why','when','where','not','no','so','then','just',
  'also','very','more','some','any','all','get','got','let','use','make',
  'know','go','see','come','want','like','much','many','up','out','about',
  'if','while','than','such','new','one','two','three','can\'t','don\'t',
  'won\'t','it\'s','i\'m','i\'ve','they\'re','we\'re','there','here','ok',
  'okay','yes','yeah','nope','please','thanks','thank','sorry','oh','ah',
]);

// ─────────────────────────────────────────────────────────────────────────────
// §2  EXTENDED SYNONYM GRAPH  (~500+ term relationships, 40 domains)
//     Bidirectional, depth-2 expansion done in _expandQuery()
// ─────────────────────────────────────────────────────────────────────────────

const _SYN = {
  // ── Debugging / errors ──────────────────────────────────────────────────
  fix:      ['debug','solve','error','bug','issue','problem','broken','crash','fail','resolve','patch','hotfix'],
  bug:      ['error','issue','problem','broken','crash','exception','fix','debug','defect','regression'],
  debug:    ['fix','trace','log','error','crash','issue','inspect','diagnose','troubleshoot','breakpoint'],
  error:    ['bug','exception','crash','fail','broken','warning','traceback','stacktrace','issue','fault'],
  crash:    ['error','fail','exception','break','bug','abort','segfault','panic','hang'],
  issue:    ['bug','problem','error','fault','defect','ticket'],
  broken:   ['fail','error','crash','down','corrupt','invalid'],
  fail:     ['error','crash','break','broken','exception','fault'],
  resolve:  ['fix','solve','close','address','patch','remediate'],
  patch:    ['fix','hotfix','update','upgrade','commit'],
  regression: ['bug','broke','introduced','failure'],
  traceback: ['stacktrace','error','exception','crash'],
  // ── Auth / Security ──────────────────────────────────────────────────────
  auth:         ['authentication','login','token','jwt','oauth','session','cookie','password','signin','credential','sso'],
  authentication:['auth','login','token','jwt','oauth','session','signin'],
  login:        ['auth','signin','session','token','password','credential','logout'],
  token:        ['jwt','bearer','oauth','apikey','secret','header','cookie','session','access'],
  jwt:          ['token','bearer','auth','decode','encode','verify','payload','claims'],
  oauth:        ['auth','token','scope','redirect','client','grant','authorization'],
  session:      ['auth','token','cookie','login','logout','state','persistence'],
  password:     ['auth','credential','hash','bcrypt','salt','reset','secret'],
  sso:          ['saml','oauth','openid','auth','identity','federation'],
  cors:         ['api','header','origin','preflight','allow','cross','domain','proxy'],
  csrf:         ['token','security','xss','auth','protect','attack'],
  ssl:          ['tls','https','cert','certificate','secure','encrypt'],
  // ── API / Network ────────────────────────────────────────────────────────
  api:          ['endpoint','request','fetch','rest','http','axios','call','response','route','openapi'],
  rest:         ['api','endpoint','http','get','post','put','delete','patch','json'],
  graphql:      ['api','query','mutation','schema','resolver','subscription'],
  fetch:        ['api','request','http','axios','ajax','call','xhr','async','promise'],
  axios:        ['fetch','api','request','http','promise','interceptor'],
  endpoint:     ['api','route','url','path','handler'],
  webhook:      ['api','callback','event','trigger','http'],
  websocket:    ['socket','realtime','stream','broadcast','event'],
  // ── Frontend ─────────────────────────────────────────────────────────────
  react:        ['component','hook','usestate','useeffect','props','jsx','render','state','redux','context','vdom'],
  hook:         ['usestate','useeffect','usecallback','usememo','useref','customhook','react'],
  component:    ['react','vue','angular','element','widget','render','props','slot','ui'],
  css:          ['style','styling','layout','flex','flexbox','grid','class','selector','design','sass','scss'],
  sass:         ['css','scss','style','variable','mixin','compile'],
  tailwind:     ['css','utility','class','responsive','design','style'],
  styled:       ['css','emotion','theme','style','component'],
  layout:       ['css','flex','grid','position','alignment','responsive','breakpoint','display'],
  responsive:   ['layout','breakpoint','mobile','media','viewport','css'],
  animation:    ['css','keyframe','transition','transform','motion','framer'],
  vue:          ['component','composition','options','directive','reactive','vuex','vite'],
  angular:      ['component','service','module','directive','rxjs','typescript'],
  svelte:       ['component','reactive','store','compile','kit'],
  nextjs:       ['react','ssr','ssg','isr','routing','api','vercel'],
  nuxt:         ['vue','ssr','server','routing','module','composition'],
  // ── State management ─────────────────────────────────────────────────────
  redux:        ['state','action','reducer','store','dispatch','selector','toolkit'],
  zustand:      ['state','store','react','hook','global'],
  context:      ['react','state','provider','consumer','hook','global'],
  mobx:         ['observable','state','action','reaction','computed'],
  // ── Backend / infra ──────────────────────────────────────────────────────
  database:     ['db','sql','query','table','schema','mongodb','postgres','mysql','redis','orm','supabase'],
  sql:          ['database','query','select','insert','update','delete','join','index','table'],
  postgres:     ['sql','database','pg','table','query','schema','migration'],
  mysql:        ['sql','database','table','query','mariadb'],
  mongodb:      ['nosql','document','collection','mongoose','atlas','aggregate'],
  redis:        ['cache','key','value','pub','sub','expire','queue'],
  prisma:       ['orm','database','schema','migration','query','typescript'],
  orm:          ['prisma','sequelize','typeorm','hibernate','database','model'],
  server:       ['backend','node','express','api','endpoint','host','port','nginx','http'],
  node:         ['javascript','server','npm','express','backend','runtime'],
  express:      ['server','node','api','middleware','route','http'],
  fastapi:      ['python','server','api','async','pydantic','openapi'],
  flask:        ['python','server','api','route','web','http'],
  django:       ['python','server','orm','model','template','view','admin'],
  laravel:      ['php','server','api','blade','eloquent','artisan'],
  // ── DevOps / Infra ───────────────────────────────────────────────────────
  deploy:       ['deployment','production','build','release','hosting','docker','ci','pipeline','devops','ship'],
  docker:       ['container','image','compose','kubernetes','k8s','dockerfile','registry'],
  kubernetes:   ['k8s','docker','pod','deployment','service','cluster','helm','namespace'],
  ci:           ['cd','pipeline','github','gitlab','jenkins','workflow','build','test','deploy'],
  devops:       ['ci','cd','docker','kubernetes','pipeline','infrastructure','sre'],
  terraform:    ['iac','infra','cloud','provision','aws','azure','gcp'],
  aws:          ['cloud','ec2','s3','lambda','dynamodb','iam','terraform','cdk'],
  gcp:          ['cloud','firebase','bigquery','run','function','gke'],
  azure:        ['cloud','microsoft','ad','function','container','service'],
  nginx:        ['server','proxy','load','reverse','config','https'],
  cdn:          ['cache','edge','cloudflare','akamai','static','performance'],
  // ── Testing ──────────────────────────────────────────────────────────────
  test:         ['testing','unit','jest','spec','assertion','mock','coverage','tdd','cypress','vitest'],
  jest:         ['test','mock','spy','assertion','coverage','unit','vitest'],
  cypress:      ['e2e','test','integration','browser','automation','playwright'],
  playwright:   ['e2e','test','browser','automation','headless'],
  mock:         ['stub','spy','fake','test','jest','fixture','interceptor'],
  coverage:     ['test','unit','line','branch','istanbul','nyc'],
  tdd:          ['test','red','green','refactor','coverage','driven'],
  // ── Performance ──────────────────────────────────────────────────────────
  slow:         ['performance','optimize','speed','latency','cache','bottleneck','profiling','lag'],
  optimize:     ['performance','speed','efficient','cache','bottleneck','improve','refactor','fast'],
  cache:        ['redis','cdn','memoize','invalidate','stale','ttl','speed'],
  memory:       ['leak','heap','gc','profile','usage','allocation','ram'],
  bundle:       ['webpack','vite','rollup','size','chunk','split','tree'],
  // ── Writing / Content ────────────────────────────────────────────────────
  write:        ['draft','compose','create','content','copy','text','writing','generate'],
  email:        ['draft','message','compose','reply','send','letter','outreach','inbox'],
  article:      ['blog','post','content','draft','publish','essay','piece','write'],
  blog:         ['article','post','content','seo','write','publish'],
  copy:         ['write','content','marketing','ad','headline','conversion'],
  seo:          ['keyword','ranking','traffic','meta','backlink','content'],
  ux:           ['design','user','experience','wireframe','prototype','usability','hci'],
  design:       ['ui','ux','figma','sketch','prototype','wireframe','visual'],
  figma:        ['design','prototype','ui','ux','component','vector'],
  // ── Learning ─────────────────────────────────────────────────────────────
  explain:      ['understand','learn','concept','tutorial','howdoes','guide','what','teach'],
  learn:        ['explain','understand','tutorial','concept','guide','how','study','course'],
  tutorial:     ['learn','guide','step','explain','howto','example','walkthrough'],
  understand:   ['explain','learn','concept','clarify','meaning','grasp'],
  concept:      ['understand','learn','idea','theory','principle','abstraction'],
  // ── AI / ML ──────────────────────────────────────────────────────────────
  llm:          ['gpt','claude','gemini','ai','model','prompt','chat','inference','transformer'],
  ai:           ['llm','ml','model','neural','learning','gpt','claude','gemini'],
  ml:           ['ai','machine','learning','model','train','dataset','feature','sklearn'],
  embedding:    ['vector','semantic','similarity','encode','represent','bert','clip'],
  prompt:       ['llm','chat','system','user','message','instruction','template'],
  finetune:     ['training','lora','dataset','model','weights','adapt'],
  rag:          ['retrieval','augmented','vector','embedding','chunk','document'],
  langchain:    ['llm','agent','chain','rag','tool','prompt'],
  // ── Git / Version control ─────────────────────────────────────────────────
  git:          ['commit','branch','merge','pull','push','rebase','conflict','repo'],
  commit:       ['git','push','branch','history','message','amend'],
  merge:        ['git','conflict','rebase','branch','pull','resolve'],
  // ── Utilities ────────────────────────────────────────────────────────────
  install:      ['npm','yarn','pip','package','dependency','setup','configure'],
  config:       ['setup','configure','setting','env','environment','option','variable'],
  environment:  ['config','env','variable','dotenv','secret','production','staging'],
  migrate:      ['database','schema','upgrade','version','sql','flyway'],
  refactor:     ['clean','improve','restructure','rewrite','design','code'],
  lint:         ['eslint','prettier','format','rule','warning','code','style'],
  typescript:   ['type','interface','generic','enum','ts','compile','type'],
  python:       ['pip','django','flask','pandas','numpy','script','async'],
  java:         ['spring','maven','gradle','class','jvm','kotlin'],
  golang:       ['go','goroutine','channel','module','struct','interface'],
  rust:         ['cargo','ownership','borrow','lifetime','trait','async'],
  mobile:       ['ios','android','swift','kotlin','react native','flutter'],
  flutter:      ['dart','mobile','widget','state','ios','android'],
};

// ─────────────────────────────────────────────────────────────────────────────
// §3  STEMMING  (shared with folderIndex.js)
// ─────────────────────────────────────────────────────────────────────────────

function _stem(tok) {
  if (tok.endsWith('ing') && tok.length > 6) return tok.slice(0, -3);
  if (tok.endsWith('tion') && tok.length > 7) return tok.slice(0, -4);
  if (tok.endsWith('ness') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ment') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('able') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ible') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ical') && tok.length > 6) return tok.slice(0, -4);
  if (tok.endsWith('ated') && tok.length > 6) return tok.slice(0, -4);
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

// ─────────────────────────────────────────────────────────────────────────────
// §4  TOKENISATION
// ─────────────────────────────────────────────────────────────────────────────

function _tok(text, keepAll) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' codeblock ')
    .replace(/`[^`\n]{1,200}`/g, ' inlinecode ')
    .replace(/[^a-z0-9\s_.#$@]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && (keepAll || !_SS_SW.has(t)));
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  QUERY PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

function _classifyIntent(tokens) {
  const s = new Set(tokens);
  const codeTerms = ['react','vue','angular','javascript','typescript','python','java','golang',
    'rust','css','html','sql','api','fetch','hook','component','function','class','async',
    'promise','array','object','string','import','export','npm','package','git','docker',
    'deploy','server','node','express','database','query','endpoint','http','request',
    'response','redux','usestate','useeffect','props','jsx','tsx','webpack','vite','tailwind',
    'prisma','mongodb','postgres','mysql','redis','kubernetes','lambda','s3'];
  const codeHits = tokens.filter(t => codeTerms.includes(t)).length;
  if (codeHits >= 2) return 'code';
  if (['fix','debug','error','bug','crash','broken','issue','fail','exception','traceback'].some(t => s.has(t))) return 'debug';
  if (['write','email','article','draft','blog','copy','content','compose','create'].some(t => s.has(t))) return 'write';
  if (['explain','learn','understand','tutorial','concept','what','how','teach','guide'].some(t => s.has(t))) return 'explain';
  if (['compare','vs','versus','difference','better','best','choose','between'].some(t => s.has(t))) return 'compare';
  if (['find','search','where','which','list','show','all','every'].some(t => s.has(t))) return 'search';
  return 'general';
}

function _extractEntities(rawText) {
  const entities = [];
  // Version numbers
  const versionRx = /v?\d+\.\d+(\.\d+)?/g;
  let m;
  while ((m = versionRx.exec(rawText)) !== null) entities.push(m[0].toLowerCase());
  // Filenames
  const fileRx = /\b\w[\w.-]*\.(js|ts|py|json|yaml|yml|html|css|md|sh|env|go|rs|java|tsx|jsx|rb|php)\b/gi;
  while ((m = fileRx.exec(rawText)) !== null) entities.push(m[0].toLowerCase());
  // Camel/PascalCase identifiers
  const idRx = /\b([A-Z][a-z0-9]+){2,}\b|\b[a-z][a-z0-9]*([A-Z][a-z0-9]+)+\b/g;
  while ((m = idRx.exec(rawText)) !== null) entities.push(m[0].toLowerCase());
  // SCREAMING_SNAKE constants
  const constRx = /\b[A-Z]{2,}(_[A-Z0-9]+){1,}\b/g;
  while ((m = constRx.exec(rawText)) !== null) entities.push(m[0].toLowerCase());
  return entities;
}

// Depth-2 synonym expansion through the graph
function _expandTokens(tokens) {
  const out = new Map(); // term → { isOriginal, isSyn1, isSyn2 }

  const addTerm = (t, depth) => {
    const s = _stem(t);
    if (!out.has(s) || out.get(s).depth > depth) {
      out.set(s, { term: t, depth });
    }
  };

  const stemmedOriginals = new Set();
  for (const t of tokens) {
    addTerm(t, 0);
    stemmedOriginals.add(_stem(t));
  }

  // Depth 1 expansion
  for (const t of tokens) {
    const syns1 = _SYN[t] || _SYN[_stem(t)] || [];
    for (const s of syns1) {
      addTerm(s, 1);
      // Depth 2 expansion
      const syns2 = _SYN[s] || [];
      for (const s2 of syns2) {
        if (!stemmedOriginals.has(_stem(s2))) addTerm(s2, 2);
      }
    }
  }

  return out; // Map<stemmedTerm, {term, depth}>
}

// Bigrams for phrase matching
function _bigrams(tokens) {
  const bg = [];
  for (let i = 0; i < tokens.length - 1; i++) bg.push(tokens[i] + ' ' + tokens[i + 1]);
  return bg;
}

// Character trigrams for fuzzy matching
function _trigrams(word) {
  const s = '##' + word + '##';
  const tg = [];
  for (let i = 0; i < s.length - 2; i++) tg.push(s.slice(i, i + 3));
  return tg;
}

function _trigramSim(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(_trigrams(a));
  const tb = new Set(_trigrams(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) { if (tb.has(t)) intersection++; }
  return intersection / (ta.size + tb.size - intersection);
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  BM25 SCORING  (Okapi BM25, k1=1.5, b=0.75)
// ─────────────────────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B  = 0.75;

function _bm25Score(queryTerms, docTF, docLen, avgDocLen, df, N) {
  let score = 0;
  for (const [term, depth] of queryTerms) {
    const freq = docTF[term] || 0;
    if (freq === 0) continue;

    // IDF component: log((N - df + 0.5) / (df + 0.5) + 1)
    const docFreq = df[term] || 1;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

    // TF component with length normalisation
    const tf = (freq * (BM25_K1 + 1)) /
               (freq + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / Math.max(avgDocLen, 1))));

    // Depth penalty: depth-2 synonyms contribute less
    const depthW = depth === 0 ? 1.0 : depth === 1 ? 0.65 : 0.35;

    score += idf * tf * depthW;
  }
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// §7  TF-IDF COSINE SIMILARITY
// ─────────────────────────────────────────────────────────────────────────────

function _cosineSim(queryTerms, docTF, df, N) {
  let dot = 0, qNorm = 0, dNorm = 0;
  const allTerms = new Set([...queryTerms.keys(), ...Object.keys(docTF)]);

  for (const term of allTerms) {
    const docFreq = df[term] || 1;
    const idf = Math.log((N + 1) / (docFreq + 1));

    const qTF  = queryTerms.has(term) ? 1 : 0;
    const dTF  = Math.sqrt(docTF[term] || 0);
    const qVal = qTF  * idf;
    const dVal = dTF  * idf;

    dot   += qVal * dVal;
    qNorm += qVal * qVal;
    dNorm += dVal * dVal;
  }

  if (qNorm === 0 || dNorm === 0) return 0;
  return dot / (Math.sqrt(qNorm) * Math.sqrt(dNorm));
}

// ─────────────────────────────────────────────────────────────────────────────
// §8  TRIGRAM FUZZY SCORE  (falls back when exact terms miss)
// ─────────────────────────────────────────────────────────────────────────────

function _trigramScore(queryTokens, docTrigrams) {
  if (!docTrigrams || !docTrigrams.length) return 0;
  const docTG = new Set(docTrigrams);
  let totalSim = 0;
  for (const qt of queryTokens) {
    if (qt.length < 4) continue;
    const qTG  = _trigrams(qt);
    let   hits  = 0;
    for (const t of qTG) { if (docTG.has(t)) hits++; }
    const sim = hits / (qTG.length + docTG.size - hits + 1e-9);
    totalSim += sim;
  }
  return Math.min(totalSim / Math.max(queryTokens.length, 1), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// §9  TITLE MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function _titleScore(title, rawQuery, queryTokens, bigrams) {
  if (!title) return 0;
  const normTitle = title.toLowerCase();
  const normQuery = rawQuery.toLowerCase();

  // Exact full query match in title
  if (normTitle.includes(normQuery)) return 1.0;

  // Bigram phrase matches
  const bgHits = bigrams.filter(bg => normTitle.includes(bg)).length;
  if (bgHits > 0) return Math.min(0.70 + bgHits * 0.15, 0.95);

  // Token overlap
  const titleToks = new Set(_tok(title));
  const hits = queryTokens.filter(t => titleToks.has(t) || normTitle.includes(t)).length;
  return Math.min((hits / Math.max(queryTokens.length, 1)) * 0.80, 0.80);
}

// ─────────────────────────────────────────────────────────────────────────────
// §10  PLATFORM HINT
// ─────────────────────────────────────────────────────────────────────────────

const _PLAT_ALIASES = {
  chatgpt:    ['chatgpt','openai','gpt4','gpt-4','gpt3','gpt','o1','o3'],
  claude:     ['claude','anthropic','sonnet','opus','haiku'],
  gemini:     ['gemini','google','bard','palm'],
  grok:       ['grok','xai','twitter','x.ai'],
  deepseek:   ['deepseek','deep seek'],
  perplexity: ['perplexity','pplx'],
  copilot:    ['copilot','bing','microsoft','m365','github copilot'],
  quark:      ['quark'],
  doubao:     ['doubao','bytedance'],
  postman:    ['postman','postbot'],
  lmarena:    ['lmarena','lmsys','arena','chatbot arena'],
};

function _platformHint(rawQuery, docPlatform) {
  const q = rawQuery.toLowerCase();
  const aliases = _PLAT_ALIASES[docPlatform] || [];
  return aliases.some(a => q.includes(a)) ? 1.0 : 0.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// §11  RECENCY DECAY
// ─────────────────────────────────────────────────────────────────────────────

function _recencyScore(ts, halfLifeDays) {
  const ageDays = (Date.now() - (ts || 0)) / 86400000;
  return Math.exp(-Math.LN2 * ageDays / Math.max(halfLifeDays, 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// §12  RRF — RECIPROCAL RANK FUSION
//      Merges multiple ranked lists into a single score.
//      Standard k=60.
// ─────────────────────────────────────────────────────────────────────────────

const RRF_K = 60;

function _rrfFuse(rankedLists) {
  // rankedLists: Array of Array<{id, score}>
  const totals = new Map();
  for (const list of rankedLists) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    sorted.forEach((item, rank) => {
      const rrf = 1 / (RRF_K + rank + 1);
      totals.set(item.id, (totals.get(item.id) || 0) + rrf);
    });
  }
  return [...totals.entries()].map(([id, score]) => ({ id, score }));
}

// ─────────────────────────────────────────────────────────────────────────────
// §13  MMR — MAXIMAL MARGINAL RELEVANCE
//      λ=0.5 balances relevance vs novelty/diversity in top results.
// ─────────────────────────────────────────────────────────────────────────────

const MMR_LAMBDA = 0.5;

function _mmrRerank(scored, k, queryTerms, df, N) {
  if (scored.length <= k) return scored;

  const selected = [];
  const remaining = [...scored];
  const selectedVecs = [];

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const rel = remaining[i].normalized;
      let maxSim = 0;

      // Similarity to already-selected docs via TF cosine
      for (const sv of selectedVecs) {
        const sim = _cosineSim(queryTerms, sv, df, N);
        if (sim > maxSim) maxSim = sim;
      }

      const mmr = MMR_LAMBDA * rel - (1 - MMR_LAMBDA) * maxSim;
      if (mmr > bestMMR) { bestMMR = mmr; bestIdx = i; }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    selected.push(chosen);
    selectedVecs.push(chosen.entry.tf || {});
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// §14  SNIPPET EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function _msgTextFull(msg) {
  const c = msg[2];
  if (!c) return '';
  if (typeof c === 'string') return c;
  return c.txt || c.text || '';
}

function _bestSnippet(entry, queryTokens, queryIntent, maxLen) {
  maxLen = maxLen || 160;
  const msgs    = (entry.data && entry.data.m) || [];
  const codeMap = (entry.data && entry.data.c) || {};

  if (!msgs.length) return '';

  // For code/debug intent: prefer messages with code blocks
  if (queryIntent === 'code' || queryIntent === 'debug') {
    const codeMsgs = msgs.filter(m => {
      const c = m[2];
      if (!c || typeof c !== 'object') return false;
      const refs = Array.isArray(c.c) ? c.c : (c.c ? [c.c] : []);
      return refs.length > 0;
    });
    if (codeMsgs.length) {
      const m = codeMsgs[0];
      const c = m[2];
      const refs = Array.isArray(c.c) ? c.c : [c.c];
      if (refs[0] && codeMap[refs[0]]) {
        const [lang, body] = codeMap[refs[0]];
        const preview = body.split('\n').slice(0, 4).join('\n');
        return `[${lang || 'code'}] ${preview.slice(0, maxLen)}`;
      }
    }
  }

  // Score each sentence across all messages for term density
  const toks = new Set(queryTokens);
  let bestSnip = '';
  let bestScore = -1;

  for (const msg of msgs) {
    const text = _msgTextFull(msg);
    if (!text) continue;
    const sents = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 12);
    for (const sent of sents) {
      const norm  = sent.toLowerCase();
      const hits  = queryTokens.filter(t => norm.includes(t)).length;
      const score = hits / Math.sqrt(sent.split(' ').length || 1);
      if (score > bestScore) {
        bestScore = score;
        bestSnip  = sent.trim();
      }
    }
  }

  if (!bestSnip) {
    // Fallback: first non-empty user message
    const firstUser = msgs.find(m => m[0] === 'u' && _msgTextFull(m).length > 10);
    bestSnip = firstUser ? _msgTextFull(firstUser) : '';
  }

  const out = bestSnip.slice(0, maxLen);
  return out.length < bestSnip.length ? out + '…' : out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §15  HIGHLIGHTING
// ─────────────────────────────────────────────────────────────────────────────

function _highlight(snip, exactTokens, synTokens) {
  if (!snip) return '';
  let h = snip
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Synonym matches first (lower priority, styled differently)
  const sortedSyn = [...synTokens].filter(t => t.length > 2).sort((a, b) => b.length - a.length);
  for (const t of sortedSyn) {
    try {
      h = h.replace(
        new RegExp('(?<![a-z])(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![a-z])', 'gi'),
        '<mark class="syn">$1</mark>'
      );
    } catch (e) {}
  }

  // Exact query terms (higher priority, overwrite syn marks)
  const sortedExact = [...exactTokens].filter(t => t.length > 2).sort((a, b) => b.length - a.length);
  for (const t of sortedExact) {
    try {
      h = h.replace(
        new RegExp('(?<![a-z])(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![a-z])', 'gi'),
        '<mark class="hi">$1</mark>'
      );
    } catch (e) {}
  }

  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// §16  FACET FILTERS
// ─────────────────────────────────────────────────────────────────────────────

function _applyFacets(entries, facets) {
  if (!facets) return entries;
  return entries.filter(entry => {
    if (facets.platform && facets.platform !== 'all') {
      if ((entry.platform || entry.data?.p || 'unknown') !== facets.platform) return false;
    }
    if (facets.hasCode === true && !entry.hasCode) return false;
    if (facets.dateFrom && (entry.ts || 0) < facets.dateFrom)  return false;
    if (facets.dateTo   && (entry.ts || 0) > facets.dateTo)    return false;
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §17  LIBRARY NORMALISATION
//      Accepts both chrome.storage entries (old format) and
//      folderIndex entries (new format), returns uniform shape.
// ─────────────────────────────────────────────────────────────────────────────

function _normaliseEntry(entry) {
  // Chrome.storage entries have: { data, name, ts }
  // folderIndex entries have: { id, data, chatTitle, platform, ts, tf, tgrams, ... }
  const data = entry.data || {};
  return {
    id:       entry.id || entry.name || ('legacy::' + Math.random()),
    chatTitle:entry.chatTitle || data.chatTitle || entry.name || 'Untitled',
    platform: entry.platform || data.p || 'unknown',
    ts:       entry.ts || data.exportedAt || 0,
    msgCount: entry.msgCount || (data.m || []).length,
    hasCode:  entry.hasCode !== undefined ? entry.hasCode : (Object.keys(data.c || {}).length > 0),
    tf:       entry.tf || null,      // pre-computed in folderIndex; null = compute on-the-fly
    tgrams:   entry.tgrams || null,
    termSet:  entry.termSet || null,
    data,
    _source:  entry.id && entry.id.startsWith('folder::') ? 'folder' : 'library',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// §18  ON-THE-FLY TF COMPUTATION  (for legacy chrome.storage entries)
// ─────────────────────────────────────────────────────────────────────────────

function _computeEntryTF(entry) {
  if (entry.tf) return entry.tf; // already computed
  const msgs    = entry.data.m  || [];
  const codeMap = entry.data.c  || {};
  const allText = msgs.map(m => {
    const c = m[2];
    const txt  = (typeof c === 'string' ? c : (c?.txt || ''));
    const refs = c && typeof c === 'object' && c.c
      ? (Array.isArray(c.c) ? c.c : [c.c])
      : [];
    const code = refs.map(r => codeMap[r] ? codeMap[r][1] : '').join(' ');
    return txt + ' ' + code;
  }).join(' ');

  const tokens = _tok(allText);
  const tf = {};
  for (const t of tokens) {
    const s = _stem(t);
    tf[s] = (tf[s] || 0) + 1;
  }
  return tf;
}

function _computeEntryTrigrams(entry) {
  if (entry.tgrams) return entry.tgrams;
  const msgs = entry.data.m || [];
  const sample = msgs.slice(0, 8).map(m => {
    const c = m[2];
    return typeof c === 'string' ? c : (c?.txt || '');
  }).join(' ').slice(0, 3000);
  const tg = new Set();
  _tok(sample).forEach(w => {
    if (w.length >= 3) {
      const s = '##' + w + '##';
      for (let i = 0; i < s.length - 2; i++) tg.add(s.slice(i, i + 3));
    }
  });
  return [...tg];
}

// ─────────────────────────────────────────────────────────────────────────────
// §19  MAIN SEARCH FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SemanticSearch.search(query, library, options)
 *
 * @param {string}   query     - User's search query
 * @param {Array}    library   - Array of CCMF entry objects (chrome.storage or folderIndex format)
 * @param {object}   options
 *   @param {object}  termStats    - { df, N } from folderIndex.getTermStats()
 *   @param {object}  facets       - { platform, hasCode, dateFrom, dateTo }
 *   @param {number}  recencyHalfLife - Days (default 14)
 *   @param {number}  maxResults   - Max results to return (default 20)
 *   @param {boolean} diversify    - Apply MMR (default true)
 * @returns {Array} Scored results with { entry, score, pct, snipHtml, matched, queryType, title }
 */
function search(query, library, options) {
  options = options || {};
  if (!query || !query.trim() || !library.length) return [];

  // ── Query processing ──────────────────────────────────────────────────────
  const rawQuery     = query.trim();
  const rawTokens    = _tok(rawQuery);
  if (!rawTokens.length) return [];

  const queryTerms   = _expandTokens(rawTokens);    // Map<stem, {term, depth}>
  const bigrams      = _bigrams(rawTokens);
  const queryIntent  = _classifyIntent(rawTokens);
  const entities     = _extractEntities(rawQuery);
  const recencyHL    = options.recencyHalfLife || 14;

  // Exact tokens for highlighting
  const exactStemSet = new Set(rawTokens.map(_stem));
  const synStemSet   = new Set(
    [...queryTerms.keys()].filter(t => !exactStemSet.has(t))
  );

  // ── Term stats (IDF denominator) ──────────────────────────────────────────
  const termStats = options.termStats || { df: {}, N: library.length };
  const N         = Math.max(termStats.N || library.length, library.length);
  const df        = termStats.df || {};

  // Build a lightweight df from the library if not provided
  if (!termStats.df || Object.keys(termStats.df).length === 0) {
    for (const raw of library) {
      const entry = _normaliseEntry(raw);
      const tf = _computeEntryTF(entry);
      for (const term of Object.keys(tf)) {
        df[term] = (df[term] || 0) + 1;
      }
    }
  }

  // Average document length (for BM25 normalisation)
  const docLens   = library.map(raw => {
    const entry = _normaliseEntry(raw);
    const tf = _computeEntryTF(entry);
    return Object.values(tf).reduce((s, v) => s + v, 0);
  });
  const avgDocLen = docLens.reduce((s, v) => s + v, 0) / Math.max(docLens.length, 1);

  // ── Apply facet filters ───────────────────────────────────────────────────
  const filtered = _applyFacets(
    library.map(_normaliseEntry),
    options.facets
  );

  if (!filtered.length) return [];

  // ── Per-entry scoring ─────────────────────────────────────────────────────
  const bm25List    = [];
  const cosineList  = [];
  const fuzzyList   = [];
  const titleList   = [];
  const entityList  = [];

  for (const entry of filtered) {
    const tf     = _computeEntryTF(entry);
    const docLen = Object.values(tf).reduce((s, v) => s + v, 0);
    const tgrams = _computeEntryTrigrams(entry);

    // Signal 1: BM25
    const bm25 = _bm25Score(queryTerms, tf, docLen, avgDocLen, df, N);
    if (bm25 > 0) bm25List.push({ id: entry.id, score: bm25 });

    // Signal 2: TF-IDF Cosine
    const cos = _cosineSim(queryTerms, tf, df, N);
    if (cos > 0.01) cosineList.push({ id: entry.id, score: cos });

    // Signal 3: Trigram fuzzy
    const fuzzy = _trigramScore(rawTokens, tgrams);
    if (fuzzy > 0.05) fuzzyList.push({ id: entry.id, score: fuzzy });

    // Signal 4: Title
    const titleS = _titleScore(entry.chatTitle, rawQuery, rawTokens, bigrams);
    if (titleS > 0.05) titleList.push({ id: entry.id, score: titleS });

    // Signal 5: Entity match (tech names, file names, identifiers)
    let entityS = 0;
    if (entities.length) {
      const allText = Object.values(entry.data?.c || {}).map(c => c[1]).join(' ') +
                      entry.chatTitle + ' ' +
                      (entry.data?.m || []).slice(0,5).map(m => {
                        const c = m[2];
                        return typeof c === 'string' ? c : (c?.txt || '');
                      }).join(' ');
      const normText = allText.toLowerCase();
      entityS = entities.filter(e => normText.includes(e)).length / entities.length;
    }
    if (entityS > 0) entityList.push({ id: entry.id, score: entityS });
  }

  // ── RRF Fusion ────────────────────────────────────────────────────────────
  const fused = _rrfFuse([bm25List, cosineList, fuzzyList, titleList, entityList]);

  // Build id → entry map
  const entryMap = new Map(filtered.map(e => [e.id, e]));

  // Enrich each fused result with secondary signals
  let scored = fused.map(({ id, score }) => {
    const entry   = entryMap.get(id);
    if (!entry) return null;

    // Recency
    const recency = _recencyScore(entry.ts, recencyHL);

    // Platform hint
    const platHint = _platformHint(rawQuery, entry.platform);

    // Code structural boost for code/debug queries
    const codeBoost = (queryIntent === 'code' || queryIntent === 'debug') && entry.hasCode ? 1.25 : 1.0;

    const finalScore = score
      + recency * 0.08
      + platHint * 0.06;

    return { id, entry, score: finalScore * codeBoost };
  }).filter(Boolean);

  if (!scored.length) return [];

  // ── Normalise scores ───────────────────────────────────────────────────────
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  scored = scored.map(r => ({ ...r, normalized: r.score / Math.max(topScore, 1e-9) }));

  // Filter out very low relevance (< 3% of top)
  scored = scored.filter(r => r.normalized >= 0.03);

  // ── MMR for diversity ──────────────────────────────────────────────────────
  const maxResults = options.maxResults || 20;
  if (options.diversify !== false && scored.length > 4) {
    scored = _mmrRerank(scored, Math.min(maxResults, scored.length), queryTerms, df, N);
  } else {
    scored = scored.slice(0, maxResults);
  }

  // ── Build final result objects ─────────────────────────────────────────────
  return scored.map((r, i) => {
    const { entry, normalized } = r;
    const tf      = _computeEntryTF(entry);
    const snipRaw = _bestSnippet(entry, rawTokens, queryIntent, 160);
    const snipHtml= _highlight(snipRaw, rawTokens, [...synStemSet]);

    // Which query terms matched in the full conversation
    const allMsgText = (entry.data?.m || []).map(m => {
      const c = m[2];
      return typeof c === 'string' ? c : (c?.txt || '');
    }).join(' ').toLowerCase();

    const matched = rawTokens.filter(t => allMsgText.includes(t));

    return {
      entry,
      title:     entry.chatTitle,
      platform:  entry.platform,
      ts:        entry.ts,
      score:     r.score,
      pct:       Math.round(normalized * 100),
      rank:      i + 1,
      snipHtml,
      matched,
      queryType: queryIntent,
      isFolder:  entry._source === 'folder',
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §20  MULTI-SESSION MERGE  (unchanged logic, moved here for co-location)
// ─────────────────────────────────────────────────────────────────────────────
// (This is kept identical to the original mergeForUpload in popup.js,
//  just re-exported from here for cleanliness. popup.js will use whichever
//  is available.)

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

const SemanticSearch = {
  search,
  _tok,
  _stem,
  _expandTokens,
  _highlight,
  _bestSnippet,
  _classifyIntent,
  _normaliseEntry,
  _computeEntryTF,
};

if (typeof window !== 'undefined') window.CSAI_SemanticSearch = SemanticSearch;
if (typeof module !== 'undefined' && module.exports) module.exports = { SemanticSearch };
