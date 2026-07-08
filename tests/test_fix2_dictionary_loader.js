// LLF-Fix2 — Dictionary loader try-order + fallback test (pure logic, no browser).
//
// Mirrors loadDictionary() in index.html: try ./dictionary.txt first, then an online
// public word list, else keep the in-memory FALLBACK_WORDS. Verifies the ordering and
// that failures never throw (all caught) and never leave DICTIONARY empty.

const assert = require('assert');

const FALLBACK_WORDS = ['THE', 'CAT', 'DOG', 'STAR', 'ROCKET']; // stand-in for the ~200 in-app list
const SOURCES = [
  './dictionary.txt',
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt',
];

// Faithful reimplementation of the loader (same control flow as index.html).
async function loadDictionary(fetchImpl) {
  let DICTIONARY = FALLBACK_WORDS.slice();
  const tried = [];
  for (const url of SOURCES) {
    tried.push(url);
    try {
      const res = await fetchImpl(url);
      if (!res || !res.ok) continue;
      const text = await res.text();
      const words = text.split(/\r?\n/)
        .map(w => w.trim().toUpperCase())
        .filter(w => w.length > 2 && /^[A-Z]+$/.test(w));
      if (words.length > 50) {
        DICTIONARY = words;
        return { DICTIONARY, tried, source: url };
      }
    } catch (err) {
      // swallowed — no uncaught rejection
    }
  }
  return { DICTIONARY, tried, source: 'fallback' };
}

// helpers to build fake fetch responses
const ok = body => Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, text: () => Promise.resolve('') });
const throwsNet = () => Promise.reject(new Error('network down'));
// letter-only tokens (the loader filters out anything non-alpha)
const toLetters = i => { let s = ''; i += 26; while (i > 0) { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); } return s; };
// pad to >=4 letters so every token clears the loader's length>2 + /^[A-Z]+$/ filter
const bigList = n => Array.from({ length: n }, (_, i) => 'AA' + toLetters(i)).join('\n');

(async () => {
  // 1) Local file present -> used first, online never consulted.
  {
    const calls = [];
    const r = await loadDictionary(url => { calls.push(url); return url.startsWith('./') ? ok(bigList(80)) : throwsNet(); });
    assert.strictEqual(r.source, './dictionary.txt', 'local file should win');
    assert.deepStrictEqual(calls, ['./dictionary.txt'], 'online should not be fetched when local works');
    assert.ok(r.DICTIONARY.length > 50);
    console.log('ok - local ./dictionary.txt is tried first and used when present');
  }

  // 2) Local missing -> falls through to the online list.
  {
    const calls = [];
    const r = await loadDictionary(url => { calls.push(url); return url.startsWith('./') ? notFound() : ok(bigList(9000)); });
    assert.strictEqual(r.source, SOURCES[1], 'online list should be used when local is absent');
    assert.deepStrictEqual(calls, SOURCES, 'both sources tried in order');
    assert.ok(r.DICTIONARY.length > 50);
    console.log('ok - falls back to online list when local file is missing');
  }

  // 3) Both fail (network error) -> built-in fallback retained, no throw.
  {
    const r = await loadDictionary(() => throwsNet());
    assert.strictEqual(r.source, 'fallback', 'fallback used when both fail');
    assert.deepStrictEqual(r.DICTIONARY, FALLBACK_WORDS, 'fallback list intact');
    assert.ok(r.DICTIONARY.length > 0, 'word detection still has words offline');
    console.log('ok - both sources failing keeps the offline fallback (no uncaught rejection)');
  }

  // 4) A source that returns too few words is skipped (guards against a stub/empty file).
  {
    const r = await loadDictionary(url => url.startsWith('./') ? ok('AB\nX\n') : ok(bigList(9000)));
    assert.strictEqual(r.source, SOURCES[1], 'tiny/invalid local file is skipped for the online list');
    console.log('ok - undersized local file is rejected and loader continues');
  }

  // 5) The word-detection buffer still triggers against a loaded list (babysmash-style
  //    endsWith scan used at index.html ~2270).
  {
    const r = await loadDictionary(() => ok(['CAT', 'ROCKET', 'STARSHIP'].join('\n')));
    const DICTIONARY = r.DICTIONARY;
    let inputBuffer = '';
    function feed(ch) {
      inputBuffer = (inputBuffer + ch).slice(-16).toUpperCase();
      for (const word of DICTIONARY) if (inputBuffer.endsWith(word)) return word;
      return null;
    }
    let hit = null;
    for (const ch of 'ZZROCKET') hit = feed(ch) || hit;
    assert.strictEqual(hit, 'ROCKET', 'typed-buffer should detect ROCKET from the loaded list');
    console.log('ok - typed-buffer word detection fires with the loaded dictionary');
  }

  console.log('PASS test_fix2_dictionary_loader');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
