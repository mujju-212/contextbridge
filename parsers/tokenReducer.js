// Extension By - Manas Tiwari - https://www.linkedin.com/in/manas-tiwari-360686222/
// Extension By - Aditya Mittal - https://www.linkedin.com/in/aditya-mittal-493b92243/
// tokenReducer.js — v4.0  AGGRESSIVE CONTEXT-PRESERVING TOKEN REDUCTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
//
// v4.0 REDESIGN — WHY v3 COMPRESSED TOO LITTLE:
//   1. SENT_CLOSER_RX had 14 broken patterns (double-escaped \\s* never matched)
//   2. smartTrim couldn't drop technical sentences because they scored high —
//      it only worked on fluffy text, not real dev conversations
//   3. No ratio enforcement — a 1000-char message could still output 900 chars
//   4. Phrase compression gains were small vs the overhead
//   5. No structural compression for repeated cross-turn patterns
//
// v4.0 APPROACH — THREE-LAYER SYSTEM:
//
//   LAYER 1: SENTENCE SURGERY  (fixed + expanded filler patterns)
//     Fix all broken regex patterns. Expand opener/closer/transition libs.
//     Now correctly strips ALL boilerplate sentences on every AI message.
//
//   LAYER 2: RATIO ENFORCEMENT  (new — the key missing piece)
//     Every AI message has a TARGET compression ratio based on its length.
//     After all other passes, if the message is still above its target,
//     a second "budget trim" pass forces removal of the lowest-scored sentences
//     until the target is met — regardless of their absolute score.
//     Short (<120ch): no target. Medium (120-600ch): max 75% kept.
//     Long (600-2000ch): max 60% kept. Very long (>2000ch): max 45% kept.
//     Code-heavy messages: target relaxed by +15% (code is preserved).
//
//   LAYER 3: PHRASE + WHITESPACE  (retained from v3, bugs fixed)
//     All 169 phrase replacements still run, on all messages including user.
//     Works on non-code segments only (vault protects code blocks).
//
// PIPELINE:
//   Phase 0    PROTECT         vault code blocks, inline code, URLs
//   Phase 1    FILLER STRIP    drop opener/closer/transition/reref sentences (FIXED)
//   Phase 2    INLINE OPENER   strip leading filler from first sentence
//   Phase 3    PHRASE COMPRESS replace verbose phrases (all messages)
//   Phase 4    WHITESPACE      normalise whitespace
//   Phase 5    SCORE + TRIM    score + remove low-value sentences
//   Phase 6    RATIO ENFORCE   force-trim to length target if still over budget
//   Phase 7    ADJ DEDUP       drop adjacent near-duplicate sentences
//   Phase 8    MSG DEDUP       drop near-duplicate whole messages
//   Phase 9    RESTORE         restore vaulted content
//
// ═══════════════════════════════════════════════════════════════════════════════
'use strict';

var __csai_skipCompress = false;

// ─────────────────────────────────────────────────────────────────────────────
// §1  FILLER SENTENCE PATTERNS  (ALL FIXED — no more double-escaped \s*)
// ─────────────────────────────────────────────────────────────────────────────

const SENT_OPENER_RX = [
  /^(certainly|sure(?: thing)?|of course|absolutely|right)[!,.]?\s*$/i,
  /^(great|good|excellent|perfect|wonderful|fantastic|awesome|nice)(?: question| point| call| idea)?[!,.]?\s*$/i,
  /^(no problem|happy to help|glad (you asked|to assist)|my pleasure)[!,.]?\s*$/i,
  /^(thanks? for (sharing|asking|that)|thank you for)[^.]{0,40}[.!]?\s*$/i,
  /^I'?d be (happy|glad|delighted) to (help|assist)[^.]{0,60}[.!]?\s*$/i,
  /^I('ll| will) (help|assist) (you )?(with that|now|right away)[^.]{0,40}[.!]?\s*$/i,
  /^(as an? (ai|language model|assistant|llm)|as claude|as chatgpt)[^.]{0,80}[.!]?\s*$/i,
  /^(of course|sure),?\s+I('ll| will|'d be)[^.]{0,60}[.!]?\s*$/i,
  /^(great|awesome|perfect),?\s+let('s| us) (get started|dive in|begin)[^.]{0,60}[.!]?\s*$/i,
  /^I('m| am) (here|glad|happy) to (help|assist)[^.]{0,60}[.!]?\s*$/i,
];

const SENT_CLOSER_RX = [
  // FIXED: was \\s* (never matched), now \s* (correct)
  /^let me know if (you (have|need|want)|there('?s| is) anything|you'?d like)[^.!?]{0,80}[.!?]?\s*$/i,
  /^feel free to (ask|reach out)[^.!?]{0,60}[.!?]?\s*$/i,
  /^don'?t hesitate to (ask|reach out|contact)[^.!?]{0,60}[.!?]?\s*$/i,
  /^if you (have|need) (any )?(more |further |additional )?(questions?|help|assistance|clarification)[^.!?]{0,80}[.!?]?\s*$/i,
  /^(I )?hope (this|that) (helps?|is helpful|clarifies|answers|gives)[^.!?]{0,60}[.!?]?\s*$/i,
  /^(this should|that should) (help|get you started|do it|work)[^.!?]{0,60}[.!?]?\s*$/i,
  /^is there (anything|something) (else )?(I can|I could|you'?d like)[^?]{0,60}\?\s*$/i,
  /^would you like (me to|to)[^?]{0,80}\?\s*$/i,
  /^please (let me know|don'?t hesitate)[^.!?]{0,60}[.!?]?\s*$/i,
  /^(happy to|glad to) (help|assist|answer)[^.]{0,60}[.!]?\s*$/i,
  /^I('m| am) here (to help|if you need)[^.!?]{0,60}[.!?]?\s*$/i,
  /^let me know (how it goes|if that works|if this helps|if you run into)[^.!?]{0,80}[.!?]?\s*$/i,
  /^(give it a try|try it out|try that)[^.!?]{0,60}[.!?]?\s*$/i,
  /^(you can|you should) (also )?(reach out|ask|contact)[^.!?]{0,60}[.!?]?\s*$/i,
  /^(good luck|best of luck)[^.!?]{0,50}[.!?]?\s*$/i,
  /^(I )?hope (that|this) (makes sense|is clear|was helpful)[^.!?]{0,60}[.!?]?\s*$/i,
  /^(let me know|feel free) (if|to)[^.!?]{0,80}[.!?]?\s*$/i,
];

const SENT_TRANSITION_RX = [
  /^(in conclusion|to summarize|to sum up|to recap|in summary)[,:]?\s*(here'?s?|:)?[^.]{0,60}[.!]?\s*$/i,
  /^(first and foremost|first of all|last but not least)[,:]?\s*[^.]{0,60}[.!]?\s*$/i,
  /^(moving on[,]?|now let'?s (move on|look at|turn to|talk about|discuss)|next up[,]?)\s+[^.]{0,80}[.!]?\s*$/i,
  /^(let'?s (start|begin|dive|jump) (with|by|into))[^.]{0,80}[.!]?\s*$/i,
  /^(here'?s (a |an )?(breakdown|overview|summary|quick look))[^:]{0,40}:?\s*$/i,
  /^(with that (in mind|said|out of the way))[,.]?\s*[^.]{0,60}[.!]?\s*$/i,
  /^(that said|that being said|having said that)[,.]?\s*[^.]{0,60}[.!]?\s*$/i,
  /^(so[,]? (to|in order to|let'?s))[^.]{0,80}[.!]?\s*$/i,
  /^(now that we('ve| have) (covered|discussed|looked at))[^.]{0,80}[.!]?\s*$/i,
  /^(with all that (said|covered|in mind))[,.]?\s*[^.]{0,60}[.!]?\s*$/i,
];

const SENT_REREF_RX = [
  /^(as (I |we )?(mentioned|stated|noted|discussed|explained|said)( (above|before|earlier|previously))?)[,:]?\s*[^.]{0,120}[.!]?\s*$/i,
  /^(as (you (may |can )?know|you'?re aware|noted above|previously discussed))[,:]?\s*[^.]{0,120}[.!]?\s*$/i,
  /^(recall that|remember that|you'?ll recall)[,:]?\s*[^.]{0,120}[.!]?\s*$/i,
  /^(going back to|returning to) (what|the)[^.]{0,100}[.!]?\s*$/i,
  /^(as we (saw|covered|established|learned))[,:]?\s*[^.]{0,120}[.!]?\s*$/i,
];

const SENT_CODE_WALK_RX = [
  /^(this (line|function|method|block|snippet|code) (does|creates?|handles?|returns?|checks?|sets?|calls?))[^.]{0,120}[.!]?\s*$/i,
  /^(the (line|function|method|block|variable) (above|below|here) (does|creates?|handles?|returns?))[^.]{0,120}[.!]?\s*$/i,
  /^(what this (does|means) is)[^.]{0,120}[.!]?\s*$/i,
  /^(essentially[,]? (this|it|the code|the function))[^.]{0,120}[.!]?\s*$/i,
  /^(in (other words|simple terms)[,]?)[^.]{0,120}[.!]?\s*$/i,
  /^(to (clarify|elaborate|explain)[,]?)[^.]{0,120}[.!]?\s*$/i,
  /^(as you can see[,]?)[^.]{0,120}[.!]?\s*$/i,
  /^(notice (how|that)[,]?)[^.]{0,120}[.!]?\s*$/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// §2  PHRASE COMPRESSION TABLE  (169 patterns, retained from v3)
// ─────────────────────────────────────────────────────────────────────────────

const PHRASE_REPLACEMENTS = [
  // A. Wordy connectives
  [/\bin order to\b/gi, 'to'],
  [/\bso as to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bowing to the fact that\b/gi, 'because'],
  [/\bin the event that\b/gi, 'if'],
  [/\bin the event of\b/gi, 'if'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bat the current time\b/gi, 'now'],
  [/\bat this juncture\b/gi, 'now'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin the near future\b/gi, 'soon'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bwith respect to\b/gi, 'about'],
  [/\bin relation to\b/gi, 'about'],
  [/\bpertaining to\b/gi, 'about'],
  [/\bwith the exception of\b/gi, 'except'],
  [/\bwith the exception that\b/gi, 'except that'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bdespite the fact that\b/gi, 'although'],
  [/\bon the basis of\b/gi, 'based on'],
  [/\bby means of\b/gi, 'using'],
  [/\bfor the purpose of\b/gi, 'to'],
  [/\bfor the reason that\b/gi, 'because'],
  [/\bthe reason why is that\b/gi, 'because'],
  [/\bthe reason (for this )?is that\b/gi, 'because'],
  [/\bin the case (where|that|of)\b/gi, 'if'],
  [/\bin terms of\b/gi, 'for'],
  [/\ba (large|great|significant) number of\b/gi, 'many'],
  [/\ba (large|significant) amount of\b/gi, 'much'],
  [/\bthe (vast|overwhelming) majority of\b/gi, 'most'],
  [/\bthe fact that\b/gi, 'that'],
  [/\bit is (the case|a fact) that\b/gi, ''],
  // B. Redundant intensifiers
  [/\bvery (very|extremely|incredibly|highly)\b/gi, 'very'],
  [/\bcompletely and utterly\b/gi, 'completely'],
  [/\babsolutely (essential|necessary|critical|required)\b/gi, '$1'],
  [/\bcompletely (finished|done|complete|empty|full)\b/gi, '$1'],
  [/\bentirely (dependent|separate|different)\b/gi, '$1'],
  [/\bstrongly (recommend|suggest|advise)\b/gi, '$1'],
  [/\bcurrently (existing|available|active|running)\b/gi, '$1'],
  [/\bpreviously (mentioned|stated|discussed|noted)\b/gi, ''],
  [/\bspecifically (designed|built|intended|made) (for|to)\b/gi, '$2'],
  // C. Filler adverbs
  [/\bbasically,?\s*/gi, ''],
  [/\bessentially,?\s*/gi, ''],
  [/\bliterally,?\s*/gi, ''],
  [/\bactually,?\s*/gi, ''],
  [/\breally\s+/gi, ''],
  [/\bquite\s+/gi, ''],
  [/\bsimply\s+(?!put|stated)/gi, ''],
  [/\bobviously,?\s*/gi, ''],
  [/\bclearly,?\s*/gi, ''],
  [/\bneedlessly\s+/gi, ''],
  [/\bthereby\s+/gi, ''],
  [/\bsubsequently,?\s*/gi, ''],
  [/\bnotwithstanding,?\s*/gi, ''],
  [/\baforementioned\s+/gi, ''],
  [/\bjust\s+(?!(now|yet|barely|in time))/gi, ''],
  [/\bvery\s+(important|critical|significant|essential|necessary|crucial)\b/gi, '$1'],
  // D. Empty lead-ins
  [/\bit is (important|worth|necessary|critical) to note that\s*/gi, 'Note: '],
  [/\bit is (important|worth) (noting|mentioning) that\s*/gi, 'Note: '],
  [/\bplease note that\s*/gi, 'Note: '],
  [/\b(should|must) keep in mind that\s*/gi, 'Note: '],
  [/\bkeep in mind that\s*/gi, 'Note: '],
  [/\bit should be noted that\s*/gi, 'Note: '],
  [/\bit is (also )?(worth|good) (to )?(know|remember) that\s*/gi, ''],
  [/\bone thing to (keep in mind|note|remember) is (that)?\s*/gi, ''],
  [/\bthe (key|main|primary) (thing|point|takeaway) (here )?is (that)?\s*/gi, ''],
  [/\bwhat (this|that) means is (that)?\s*/gi, ''],
  [/\bwhat you need to (do|know) is\s*/gi, ''],
  [/\bthe way (this|it) works is\s*/gi, ''],
  [/\bto put it (simply|briefly|differently)[,:]\s*/gi, ''],
  [/\bin other words[,]?\s*/gi, ''],
  [/\bput simply[,]?\s*/gi, ''],
  [/\bto be (more )?specific[,:]\s*/gi, ''],
  [/\bto be (more )?precise[,:]\s*/gi, ''],
  [/\bmore (specifically|precisely|importantly)[,]?\s*/gi, ''],
  [/\badditionally[,]?\s*/gi, ''],
  [/\bfurthermore[,]?\s*/gi, ''],
  [/\bmoreover[,]?\s*/gi, ''],
  [/\bthat being said[,]?\s*/gi, ''],
  [/\bwith that (said|in mind)[,]?\s*/gi, ''],
  [/\bof course[,]?\s*/gi, ''],
  [/\bcertainly[,]?\s*/gi, ''],
  [/\bneedless to say[,]?\s*/gi, ''],
  [/\bsuffice it to say[,]?\s*/gi, ''],
  [/\bwithout further ado[,]?\s*/gi, ''],
  [/\bin the process of\s+/gi, ''],
  // E. Verbose verb constructions
  [/\bmake use of\b/gi, 'use'],
  [/\btake advantage of\b/gi, 'use'],
  [/\bbring about\b/gi, 'cause'],
  [/\bcarry out\b/gi, 'do'],
  [/\bcarry on\b/gi, 'continue'],
  [/\bcome up with\b/gi, 'create'],
  [/\bput in place\b/gi, 'implement'],
  [/\btake into account\b/gi, 'consider'],
  [/\btake into consideration\b/gi, 'consider'],
  [/\bgive rise to\b/gi, 'cause'],
  [/\bgive an indication of\b/gi, 'indicate'],
  [/\bprovide (an|a) (explanation|description) of\b/gi, 'explain'],
  [/\bprovide (an|a) (example|illustration) of\b/gi, 'show'],
  [/\bserve as (a|an)\b/gi, 'be'],
  [/\bact as (a|an)\b/gi, 'be'],
  [/\bfunction as (a|an)\b/gi, 'be'],
  [/\bis (able to|capable of)\b/gi, 'can'],
  [/\bare (able to|capable of)\b/gi, 'can'],
  [/\bwas (able to|capable of)\b/gi, 'could'],
  [/\bhave (the ability|the capacity) to\b/gi, 'can'],
  [/\bit is possible to\b/gi, 'you can'],
  [/\bthere is (a |the )?possibility (of|that)\b/gi, 'possibly'],
  [/\bhas (a|the) tendency to\b/gi, 'tends to'],
  // F. Redundant qualifiers
  [/\bcompletely new\b/gi, 'new'],
  [/\bentirely new\b/gi, 'new'],
  [/\bbrand new\b/gi, 'new'],
  [/\bfinal (conclusion|result|outcome)\b/gi, '$1'],
  [/\bfuture plans\b/gi, 'plans'],
  [/\bpast (history|experience|record)\b/gi, '$1'],
  [/\bjoin together\b/gi, 'join'],
  [/\bconnect together\b/gi, 'connect'],
  [/\bmerge together\b/gi, 'merge'],
  [/\bcombine together\b/gi, 'combine'],
  [/\brepeat again\b/gi, 'repeat'],
  [/\brevert back\b/gi, 'revert'],
  [/\bresume again\b/gi, 'resume'],
  [/\bunexpected surprise\b/gi, 'surprise'],
  // G. AI verbosity
  [/\bI (would like to|want to) (point out|highlight|emphasize|note) that\s*/gi, 'Note: '],
  [/\bit('s| is) (also )?worth (pointing out|highlighting|mentioning) that\s*/gi, ''],
  [/\bI (should|want to) (also |just )?(mention|note|point out) that\s*/gi, ''],
  [/\bone (thing|aspect|consideration) (to|worth) (note|notice|consider) is (that)?\s*/gi, ''],
  [/\bfrom (a|an) \w+ (perspective|standpoint|point of view)[,:]?\s*/gi, ''],
  [/\bwhen it comes to\b/gi, 'for'],
  [/\bwhen (talking|speaking|thinking) about\b/gi, 'about'],
  [/\bthe (way|manner) in which\b/gi, 'how'],
  [/\ba (wide|broad|large) (range|variety|array|selection) of\b/gi, 'many'],
  [/\bthe (fact|truth) of the matter is (that)?\s*/gi, ''],
  [/\bI (hope|trust) (this|that) (helps|is clear|makes sense|clarifies)[.!]?\s*/gi, ''],
  [/\bas (a result|a consequence)[,]?\s*/gi, 'so '],
  [/\bin (light|view) of (this|the above|that)[,]?\s*/gi, ''],
  [/\bit('s| is) important to (understand|know|note|realize) that\s*/gi, ''],
  [/\bgenerally speaking[,]?\s*/gi, ''],
  [/\bbroadly speaking[,]?\s*/gi, ''],
  [/\bstrictly speaking[,]?\s*/gi, ''],
  [/\bin (general|principle|practice)[,]?\s*/gi, ''],
  [/\bunder (normal|typical|standard) circumstances\b/gi, 'normally'],
  [/\bin most (cases|instances|situations)\b/gi, 'usually'],
  [/\bin (some|certain|many) cases\b/gi, 'sometimes'],
  [/\bfor example[,]?\s*/gi, 'e.g. '],
  [/\bfor instance[,]?\s*/gi, 'e.g. '],
  [/\bsuch as\b/gi, 'like'],
  [/\bin addition (to this|to that)?\s*/gi, 'also '],
  [/\bon the other hand[,]?\s*/gi, 'but '],
  [/\bat the same time[,]?\s*/gi, 'also '],
  [/\bwhat('s| is) more[,]?\s*/gi, 'also '],
  [/\bas well as\b/gi, 'and'],
  [/\bnot only\b/gi, ''],
  [/\bbut also\b/gi, 'and'],
  // H. Quantity bloat
  [/\ba (total|grand total) of\s+/gi, ''],
  [/\bapproximately\b/gi, '~'],
  [/\ba (wide |broad )?range of\b/gi, 'many'],
  [/\bmultiple (different )?(types|kinds|forms|ways) of\b/gi, 'various'],
  [/\bone or more\b/gi, 'some'],
  // I. AI preambles
  [/\bI('ll| will) (now )?walk (you through|through)\s*/gi, ''],
  [/\blet('s| us) (take a look at|look at|examine|explore)\s*/gi, ''],
  [/\blet me (explain|describe|outline|walk through)\s*/gi, ''],
  [/\bhere is (a|an|the) (brief |quick )?(overview|summary|breakdown|explanation) of\s*/gi, ''],
  [/\bhere are (the|some) (key |main |important )?(points|things|steps|reasons)\s*:\s*/gi, ''],
  [/\bthe following (is|are)\s*/gi, ''],
  [/\bas (shown|seen|described|mentioned|explained|noted) (above|below|earlier|previously)[,]?\s*/gi, ''],
];

// ─────────────────────────────────────────────────────────────────────────────
// §3  IMPORTANCE SCORING SIGNALS
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_SIGNAL = [
  { rx: /\b(decided|going with|we('ll| will) use|the approach is|instead of|rather than|chose|switched (to|from))\b/i, w: 4 },
  { rx: /\b(the (fix|solution|issue|problem|bug|error|cause) (is|was|turned out)\b)/i, w: 4 },
  { rx: /\b(must|cannot|must not|required|critical|breaking|do not|don'?t|never)\b/i, w: 3 },
  { rx: /\b(context|provider|consumer|reducer|dispatch|middleware|interceptor|lifecycle|hook)\b/i, w: 3 },
  { rx: /\b(always|never|every time|regardless|no matter)\b.{0,60}\b(re.?render|trigger|fire|update|run)\b/i, w: 4 },
  { rx: /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/, w: 3 },
  { rx: /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/, w: 3 },
  { rx: /\b[a-z]{2,}(?:_[a-z0-9]+){2,}\b/, w: 2 },
  { rx: /\b[a-z]{2,}(?:-[a-z0-9]+){2,}\b/, w: 2 },
  { rx: /(?:^|\s)(\.{0,2}\/[\w./-]+\.\w+)/, w: 3 },
  { rx: /\b\w+\.(js|ts|py|json|html|css|md|yml|yaml|sh|env|txt|jsx|tsx|rs|go)\b/i, w: 3 },
  { rx: /\bv\d+(\.\d+){0,3}\b/i, w: 2 },
  { rx: /\b\d+\.\d+\.\d+\b/, w: 2 },
  { rx: /\b(error|exception|undefined|null pointer|NaN|uncaught|failed|crash|broken|invalid|TypeError|ReferenceError|SyntaxError)\b/i, w: 3 },
  { rx: /\b(bug|fix|fixed|patch|workaround|regression)\b/i, w: 2 },
  { rx: /\b(working|done|implemented|complete|deployed|shipped|merged|resolved|passing)\b/i, w: 2 },
  { rx: /\b(port|pid|id|size|limit|max|min|timeout|delay|count|length)\s*[=:]\s*\d+\b/i, w: 2 },
  { rx: /\b\d{4,5}\b(?!\s*(?:px|em|rem|%))/, w: 1 },
  { rx: /\b(webpack|vite|eslint|prettier|typescript|react|vue|svelte|tailwind|prisma|postgres|sqlite|mongodb|redis|docker|kubernetes|nginx|express|fastapi|flask|django|nextjs|nuxt|node\.?js|deno|bun)\b/i, w: 2 },
  { rx: /\b(GET|POST|PUT|PATCH|DELETE|fetch|axios|request|response|endpoint|api|REST|GraphQL|websocket)\b/, w: 2 },
  { rx: /\b(token|auth|oauth|jwt|session|cookie|permission|role|scope|secret|key|env)\b/i, w: 2 },
  { rx: /^\s*(import|export|require|from)\s+/m, w: 4 },
  { rx: /function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\(|class\s+\w+|=>\s*\{/, w: 3 },
  { rx: /[A-Z]{2,}(_[A-Z0-9]+){1,}/, w: 3 },
  { rx: /\b(interface|type\s+\w+\s*=|extends|implements|readonly)\b/, w: 2 },
  { rx: /^#{1,4}\s+\S/m, w: 5 },
];

const LOW_SIGNAL = [
  { rx: /\b(great|excellent|perfect|awesome|wonderful|fantastic).*\b(approach|solution|idea|way|choice)\b/i, w: -2 },
  { rx: /\b(it'?s worth (noting|mentioning)|note that|please note|keep in mind)\b/i, w: -1 },
  { rx: /^(additionally|furthermore|moreover|also)[,.]\s+/i, w: -1 },
  // NEW: penalise pure-filler sentences we might have missed
  { rx: /^(this is|it is|there is|there are) (a |an |the )?(good|great|simple|easy|common|standard|typical|normal)\b/i, w: -1 },
  { rx: /\b(simply|basically|generally|usually|typically|normally)\b.*\b(works?|does|is|runs?)\b/i, w: -1 },
];

// ─────────────────────────────────────────────────────────────────────────────
// §4  PROTECT / RESTORE
// ─────────────────────────────────────────────────────────────────────────────

const NULL_CHAR = '\x00';

function isolateProtected(text) {
  const vault = new Map();
  let idx = 0;
  const protect = (match) => {
    const tok = `${NULL_CHAR}P${idx++}${NULL_CHAR}`;
    vault.set(tok, match);
    return tok;
  };
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, protect);
  s = s.replace(/`[^`\n]{1,300}`/g, protect);
  s = s.replace(/§[fc]\d+§/g, protect);
  s = s.replace(/https?:\/\/[^\s<>"']{8,}/g, protect);
  s = s.replace(/(?:^|(?<=\s))([./~][\w./\-]{4,})/gm, (full, path) => {
    const tok = protect(path);
    return full.replace(path, tok);
  });
  return { sanitised: s, vault };
}

function restoreProtected(text, vault) {
  let s = text;
  for (const [tok, orig] of vault) s = s.split(tok).join(orig);
  return s;
}

function hasVaultedContent(text) { return text.includes(NULL_CHAR); }

function countVaultedChars(text) {
  let total = 0;
  for (const m of text.matchAll(new RegExp(`${NULL_CHAR}P\\d+${NULL_CHAR}`, 'g'))) {
    total += m[0].length;
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  PHRASE COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

function compressPhrases(text) {
  if (!text) return text;
  if (hasVaultedContent(text)) {
    const parts = text.split(/((?:\x00P\d+\x00)+)/);
    return parts.map((part, i) => i % 2 === 0 ? compressPlainPhrases(part) : part).join('');
  }
  return compressPlainPhrases(text);
}

function compressPlainPhrases(text) {
  let t = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    t = t.replace(pattern, replacement);
  }
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/^[,;][ \t]*/gm, '');
  t = t.replace(/[ \t]+([.,;:!?])/g, '$1');
  t = t.replace(/([.,;:]) \1/g, '$1');
  t = t.replace(/Note:,/gi, 'Note:');
  t = t.replace(/^Note:\s+Note:/gim, 'Note:');
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  SENTENCE UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const ABBREV_RX = /\b(e\.g|i\.e|etc|vs|no|fig|dr|mr|mrs|ms|prof|sr|jr|dept|approx|est|ref|vol|ch|pp|op|cf|al|et|ca|p|n|s|w|e|a\.k\.a|a\.s\.a\.p|i\.e|c\.f|N\.B|n\.b)$/i;

function splitSentences(text) {
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"'(\[#*\-]|$)/);
  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (i < raw.length - 1 && ABBREV_RX.test(s.replace(/[.!?,]$/, '').split(' ').pop())) {
      raw[i + 1] = s + ' ' + raw[i + 1];
    } else {
      merged.push(s);
    }
  }
  return merged.filter(s => s.trim().length > 0);
}

const STOP = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','can','shall','to','of','in','for','on','with','at',
  'by','from','as','or','and','but','not','this','that','it','its',
  'i','we','you','he','she','they','them','their','our','your','my',
  'so','if','then','when','which','who','what','how','there','here',
]);

function getBigrams(text) {
  const words = text.toLowerCase()
    .replace(new RegExp(`${NULL_CHAR}[^${NULL_CHAR}]*${NULL_CHAR}`, 'g'), '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w));
  const bigrams = new Set();
  for (let i = 0; i < words.length - 1; i++) bigrams.add(words[i] + '_' + words[i + 1]);
  if (words.length < 6) words.forEach(w => bigrams.add(w));
  return bigrams;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) { if (setB.has(item)) intersection++; }
  return intersection / (setA.size + setB.size - intersection);
}

// ─────────────────────────────────────────────────────────────────────────────
// §7  PHASE 1 — FILLER SENTENCE STRIP
// ─────────────────────────────────────────────────────────────────────────────

function stripFillerSentences(text, hasCodeInMsg) {
  const sentences = splitSentences(text);
  const keep = [];
  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (hasVaultedContent(trimmed)) { keep.push(s); continue; }
    let isFluff = false;
    if (keep.length < 3) {
      for (const rx of SENT_OPENER_RX) { if (rx.test(trimmed)) { isFluff = true; break; } }
    }
    if (!isFluff && (sentences.length - keep.length) <= 4) {
      for (const rx of SENT_CLOSER_RX) { if (rx.test(trimmed)) { isFluff = true; break; } }
    }
    if (!isFluff) {
      for (const rx of SENT_TRANSITION_RX) { if (rx.test(trimmed)) { isFluff = true; break; } }
    }
    if (!isFluff && trimmed.length < 160) {
      for (const rx of SENT_REREF_RX) { if (rx.test(trimmed)) { isFluff = true; break; } }
    }
    if (!isFluff && hasCodeInMsg) {
      for (const rx of SENT_CODE_WALK_RX) { if (rx.test(trimmed)) { isFluff = true; break; } }
    }
    if (!isFluff) keep.push(s);
  }
  if (keep.length === 0 && sentences.length > 0) return sentences[0].trim();
  return keep.join(' ').trim();
}

const INLINE_OPENERS = [
  /^(certainly|sure(?: thing)?|of course|absolutely|right)[!,.]?\s+/i,
  /^(great|good|excellent|perfect|wonderful|fantastic|awesome)(?: question| point| call| idea)?[!,.]?\s+/i,
  /^(no problem|happy to help|glad (you asked|to assist)|my pleasure)[!,.]?\s+/i,
  /^I'?d be (happy|glad|delighted) to (help|assist)[^.]{0,60}\.\s*/i,
  /^(Let me|I'?ll) (start by |begin by |first )?(explain|walk you through|break this down|dive into|look at)[^.]{0,80}\.\s*/i,
  /^Here'?s? (a |an )?(breakdown|overview|summary|quick look)[^:]{0,40}[:.]?\s*/i,
];

function stripInlineOpener(text) {
  let t = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const rx of INLINE_OPENERS) {
      const next = t.replace(rx, '');
      if (next !== t) { t = next.trimStart(); changed = true; break; }
    }
  }
  return t;
}

function normaliseWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// §8  PHASE 5 — SCORE + TRIM
// ─────────────────────────────────────────────────────────────────────────────

function scoreSentence(sentence) {
  if (hasVaultedContent(sentence)) return 10;
  let score = 0;
  const trimmed = sentence.trim();
  const len = trimmed.length;
  if (/^#{1,4}\s+\S/.test(trimmed)) return 10;
  if (/^[\-\*\+]\s+\S/.test(trimmed) || /^\d+\.\s+\S/.test(trimmed)) score += 3;
  if (len < 80 && len > 10) score += 1;
  if (/\?$/.test(trimmed)) score += 3;
  if (/:$/.test(trimmed)) score += 3;
  if (/\b\d{2,}\b/.test(trimmed)) score += 1;
  if (/\b(don't|doesn't|won't|can't|shouldn't|not|never|always|must|only)\b/i.test(trimmed)) score += 2;
  for (const { rx, w } of HIGH_SIGNAL) { if (rx.test(sentence)) score += w; }
  for (const { rx, w } of LOW_SIGNAL) { if (rx.test(sentence)) score += w; }
  if (len > 200) {
    const hasTech = HIGH_SIGNAL.slice(0, 10).some(({ rx }) => rx.test(sentence));
    if (!hasTech) score -= 2;
  }
  return score;
}

function smartTrim(text) {
  const CHAR_THRESHOLDS = [
    { maxLen: 120,      minScore: -Infinity },
    { maxLen: 350,      minScore: -2        },
    { maxLen: 800,      minScore: -1        },
    { maxLen: 1800,     minScore: 0         },
    { maxLen: 3500,     minScore: 1         },
    { maxLen: Infinity, minScore: 2         },
  ];
  const len = text.length;
  const threshold = CHAR_THRESHOLDS.find(t => len <= t.maxLen).minScore;
  if (threshold === -Infinity) return text;
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text;
  const maxRemovable = Math.min(Math.floor(sentences.length * 0.68), sentences.length - 2);
  if (maxRemovable <= 0) return text;
  let removed = 0;
  const kept = [];
  for (const s of sentences) {
    const score = scoreSentence(s);
    if (score < threshold && removed < maxRemovable && kept.length > 0) {
      removed++;
    } else {
      kept.push(s);
    }
  }
  if (kept.length === 0) return sentences[0];
  return kept.join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// §9  PHASE 6 — RATIO ENFORCEMENT  ← NEW in v4.0, the key addition
//
// After all other passes, if the message is STILL above its length target,
// this pass force-removes the lowest-scored sentences until the target is met.
// Code-heavy messages (>30% vault tokens) get a +15% relaxed target.
// ─────────────────────────────────────────────────────────────────────────────

function enforceRatio(text, originalLen) {
  // Target: what fraction of the ORIGINAL we're allowed to keep
  const RATIO_TARGETS = [
    { maxOrigLen: 150,      maxKeep: 1.00 },  // tiny: no limit
    { maxOrigLen: 500,      maxKeep: 0.88 },  // short: keep max 88%
    { maxOrigLen: 1000,     maxKeep: 0.78 },  // medium: keep max 78%
    { maxOrigLen: 2000,     maxKeep: 0.68 },  // long: keep max 68%
    { maxOrigLen: 5000,     maxKeep: 0.58 },  // very long: keep max 58%
    { maxOrigLen: Infinity, maxKeep: 0.50 },  // huge: keep max 50%
  ];

  const target = RATIO_TARGETS.find(t => originalLen <= t.maxOrigLen);
  const maxAllowed = Math.floor(originalLen * target.maxKeep);

  // Relax target if text is code-heavy (vault tokens are protected, can't remove)
  const vaultChars = countVaultedChars(text);
  const codeRatio = vaultChars / Math.max(text.length, 1);
  const effectiveMax = codeRatio > 0.3 ? Math.floor(maxAllowed * 1.15) : maxAllowed;

  if (text.length <= effectiveMax) return text; // already within budget

  const sentences = splitSentences(text);
  if (sentences.length <= 1) return text; // can't trim single sentence

  // Score all sentences, sort by score ascending (weakest first)
  const scored = sentences.map((s, i) => ({ s, i, score: scoreSentence(s) }));
  scored.sort((a, b) => a.score - b.score || a.i - b.i);

  // Remove sentences starting from weakest until under budget
  // NEVER remove high-signal sentences (score >= 3) — those contain key info
  const toRemove = new Set();
  let currentLen = text.length;
  for (const { s, i, score } of scored) {
    if (currentLen <= effectiveMax) break;
    if (toRemove.size >= sentences.length - 2) break; // always keep at least 2
    if (score >= 3) break; // never remove high-signal sentences
    toRemove.add(i);
    currentLen -= s.length + 1;
  }

  const kept = sentences.filter((_, i) => !toRemove.has(i));
  if (kept.length === 0) return sentences[0];
  return kept.join(' ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// §10  PHASE 7 — ADJACENT SENTENCE DEDUP
// ─────────────────────────────────────────────────────────────────────────────

function dedupeAdjacentSentences(text) {
  const paras = text.split(/\n\n+/);
  const outParas = paras.map(para => {
    const sentences = splitSentences(para);
    const out = [];
    const recentBigrams = [];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if (hasVaultedContent(trimmed)) { out.push(s); continue; }
      const bg = getBigrams(trimmed);
      const isDupe = recentBigrams.slice(-6).some(prevBg => jaccardSimilarity(bg, prevBg) > 0.75);
      if (!isDupe) { out.push(s); recentBigrams.push(bg); }
    }
    return out.join(' ');
  });
  return outParas.filter(p => p.trim()).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// §11  FULL TEXT COMPRESSION PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

function contentHasCode(content) {
  if (!content || typeof content === 'string') return false;
  if (typeof content.c === 'string') return content.c.length > 0;
  return Array.isArray(content.c) && content.c.length > 0;
}

function compressMessageText(text, role, hasCode) {
  if (!text || typeof text !== 'string' || text.length < 8) return text;

  const originalLen = text.length;
  const { sanitised, vault } = isolateProtected(text);
  let t = sanitised;

  if (role === 'u') {
    // User messages: phrase compress + whitespace + sentence trim for longer msgs
    t = compressPhrases(t);
    t = normaliseWhitespace(t);
    if (t.length > 200) {
      t = stripFillerSentences(t, false);
      t = smartTrim(t);
      t = enforceRatio(t, originalLen);
    }
    return restoreProtected(t, vault);
  }

  // AI messages: full 9-phase pipeline
  t = stripFillerSentences(t, hasCode);      // Phase 1
  t = stripInlineOpener(t);                  // Phase 2
  t = compressPhrases(t);                    // Phase 3
  t = normaliseWhitespace(t);                // Phase 4
  t = smartTrim(t);                          // Phase 5
  t = enforceRatio(t, originalLen);          // Phase 6 ← NEW
  t = dedupeAdjacentSentences(t);            // Phase 7
  t = t.trim();

  return restoreProtected(t, vault);
}

function compressContent(content, role) {
  if (!content) return content;
  if (typeof content === 'string') return compressMessageText(content, role, false);
  const out = Object.assign({}, content);
  const hasCode = contentHasCode(content);
  if (out.txt) out.txt = compressMessageText(out.txt, role, hasCode);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §12  MESSAGE-LEVEL DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

function msgText(msg) {
  const content = msg[2];
  if (!content) return '';
  const raw = typeof content === 'string' ? content : (content.txt || '');
  return raw.replace(/§[fc]\d+§/g, '').replace(/`[^`\n]{1,300}`/g, '');
}

function deduplicateMessages(messages) {
  const seenByRole = { u: [], a: [] };
  const WINDOW = 15;
  const THRESHOLD = 0.58;
  const result = [];
  for (const m of messages) {
    const role = m[0];
    if (contentHasCode(m[2])) { result.push(m); continue; }
    const text = msgText(m);
    if (text.length < 30) { result.push(m); continue; }
    const bg = getBigrams(text);
    const seen = seenByRole[role] || [];
    const isDupe = seen.slice(-WINDOW).some(prevBg => jaccardSimilarity(bg, prevBg) > THRESHOLD);
    if (!isDupe) {
      seen.push(bg);
      if (seen.length > WINDOW) seen.shift();
      seenByRole[role] = seen;
      result.push(m);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// §13  TOKEN COUNTING
// ─────────────────────────────────────────────────────────────────────────────

function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.replace(/\s+/g, ' ').trim().length / 4);
}

function countTextTokens(messages) {
  let total = 0;
  for (const [, , content] of messages) {
    const txt = typeof content === 'string' ? content : (content?.txt || '');
    total += estimateTokens(txt);
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// §14  MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

function runTokenReduction(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], stats: { raw: 0, compressed: 0, reductionPercent: 0 } };
  }
  if (typeof __csai_skipCompress !== 'undefined' && __csai_skipCompress) {
    const raw = countTextTokens(messages);
    return {
      messages,
      stats: { raw, compressed: raw, reductionPercent: 0, note: 'Compression skipped (human-readable format)' },
    };
  }

  const raw = countTextTokens(messages);
  const deduped = deduplicateMessages(messages);
  const compressed = deduped.map(([role, tId, content]) => [
    role, tId, compressContent(content, role),
  ]);
  const compressedCount = countTextTokens(compressed);
  const reductionPercent = raw > 0
    ? Math.max(0, Math.round((1 - compressedCount / raw) * 100))
    : 0;

  return {
    messages: compressed,
    stats: {
      raw,
      compressed: compressedCount,
      reductionPercent,
      note: `Reduced from ~${raw.toLocaleString()} to ~${compressedCount.toLocaleString()} tokens (${reductionPercent}% reduction)`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runTokenReduction,
    compressContent,
    compressMessageText,
    deduplicateMessages,
    estimateTokens,
    countTextTokens,
    _internal: {
      isolateProtected,
      restoreProtected,
      compressPhrases,
      stripFillerSentences,
      stripInlineOpener,
      normaliseWhitespace,
      smartTrim,
      enforceRatio,
      dedupeAdjacentSentences,
      scoreSentence,
      jaccardSimilarity,
      getBigrams,
    },
  };
}
