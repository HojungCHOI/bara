/**
 * 바라 — 성경 찬송가 헬퍼
 *
 * 마이크로 들은 말을 세 갈래로 해석한다.
 *   1) "찬송가 305장"  -> 번호로 바로 찬송가를 연다
 *   2) "요한복음 3장 16절" -> 성경 참조를 해석해 본문을 연다
 *   3) 그 외의 말/가사  -> 유사도 검색으로 후보를 보여 준다
 */

import { buildBookIndex, parseBibleReference, formatReference } from './bible-ref.js';
import { parseHymnNumber } from './hymn.js';
import { buildSearchIndex, search } from './search.js';
import { SpeechListener, isSpeechSupported } from './speech.js';
import { runDiagnostics, detectPlatform } from './diagnose.js';
import {
  loadHymns, saveHymns, clearHymns,
  loadBible, saveBible, clearBible,
  loadSettings, saveSettings, parseHymnFile,
} from './store.js';

const $ = (id) => document.getElementById(id);

const el = {
  mic: $('btn-mic'),
  status: $('status'),
  transcript: $('transcript'),
  result: $('result'),
  historyList: $('history-list'),
  formManual: $('form-manual'),
  inputManual: $('input-manual'),
  settings: $('settings'),
  btnSettings: $('btn-settings'),
  btnCloseSettings: $('btn-close-settings'),
  rangeFont: $('range-font'),
  chkAutoOpen: $('chk-autoopen'),
  chkWakeLock: $('chk-wakelock'),
  fileHymns: $('file-hymns'),
  fileBible: $('file-bible'),
  hymnStatus: $('hymn-status'),
  bibleStatus: $('bible-status'),
  btnClear: $('btn-clear'),
  btnDiagnose: $('btn-diagnose'),
  diagnoseResult: $('diagnose-result'),
};

const state = {
  bookIndex: null,
  hymns: [],
  hymnIndex: null,
  bible: null,
  bibleIndex: null,
  settings: loadSettings(),
  history: [],
  listener: null,
  wakeLock: null,
  lastQuery: '',
  lastQueryAt: 0,
};

/* ---------------------------------------------------------------- 초기화 */

async function init() {
  applySettings();

  try {
    const res = await fetch(new URL('../data/books.json', import.meta.url));
    const data = await res.json();
    state.bookIndex = buildBookIndex(data.books);
  } catch {
    setStatus('성경 권 정보를 불러오지 못했습니다. 새로고침해 주세요.', true);
    return;
  }

  await loadHymnData();
  loadBibleData();
  wireEvents();

  if (!isSpeechSupported()) {
    const { isIOS, iosBrowser } = detectPlatform();
    setStatus(
      isIOS && iosBrowser !== 'Safari'
        ? `아이패드에서 음성인식이 되는 브라우저는 사파리뿐입니다. 지금은 ${iosBrowser} 에서 열려 있습니다. 같은 주소를 사파리에서 열어 주세요.`
        : '이 브라우저는 음성인식을 지원하지 않습니다. 아래 칸에 직접 입력해 주세요.',
      true,
    );
    el.mic.disabled = true;
    // 왜 안 되는지 바로 볼 수 있게 진단 결과를 미리 띄워 둔다.
    onDiagnose();
  }
}

/** 저장된 찬송가가 없으면 예시 파일을 쓴다. */
async function loadHymnData() {
  const stored = loadHymns();
  if (stored && stored.length) {
    setHymns(stored, `내 찬송가 ${stored.length}곡`);
    return;
  }
  try {
    const res = await fetch(new URL('../data/hymns.sample.json', import.meta.url));
    const data = await res.json();
    setHymns(data.hymns || [], `예시 데이터 ${(data.hymns || []).length}곡 (설정에서 교체하세요)`);
  } catch {
    setHymns([], '찬송가 데이터 없음');
  }
}

function setHymns(hymns, statusText) {
  state.hymns = hymns;
  state.hymnIndex = buildSearchIndex(
    hymns.map((h) => ({
      id: `hymn-${h.number}`,
      kind: 'hymn',
      number: h.number,
      title: h.title,
      text: h.lyrics || '',
    })),
  );
  if (el.hymnStatus) el.hymnStatus.textContent = statusText;
}

function loadBibleData() {
  const bible = loadBible();
  state.bible = bible;
  if (!bible) {
    if (el.bibleStatus) el.bibleStatus.textContent = '본문 없음 (구절 위치만 안내합니다)';
    state.bibleIndex = null;
    return;
  }

  const items = [];
  for (const [bookName, chapters] of Object.entries(bible)) {
    for (const [chapter, verses] of Object.entries(chapters)) {
      for (const [verse, text] of Object.entries(verses)) {
        items.push({
          id: `bible-${bookName}-${chapter}-${verse}`,
          kind: 'bible',
          bookName, chapter: Number(chapter), verse: Number(verse),
          title: `${bookName} ${chapter}:${verse}`,
          text,
        });
      }
    }
  }
  state.bibleIndex = buildSearchIndex(items);
  if (el.bibleStatus) el.bibleStatus.textContent = `본문 ${items.length.toLocaleString('ko-KR')}절 저장됨`;
}

/* ------------------------------------------------------------ 이벤트 연결 */

function wireEvents() {
  state.listener = new SpeechListener({
    lang: 'ko-KR',
    onFinal: (text) => {
      el.transcript.textContent = text;
      handleQuery(text, { fromSpeech: true });
    },
    onInterim: (text) => { el.transcript.textContent = text; },
    onState: (s) => {
      const listening = s === 'listening';
      el.mic.classList.toggle('is-listening', listening);
      el.mic.setAttribute('aria-pressed', String(listening));
      el.mic.querySelector('.mic-label').textContent = listening ? '듣는 중' : '듣기 시작';
      if (listening) setStatus('듣고 있습니다. 찬송가 번호나 성경 구절을 말해 보세요.');
      else setStatus('마이크 버튼을 누르면 들리는 찬송과 성경 본문을 찾아 드립니다.');
      if (listening) requestWakeLock();
      else releaseWakeLock();
    },
    onError: (message, fatal) => {
      setStatus(message, true);
      if (fatal) {
        el.mic.classList.remove('is-listening');
        el.mic.setAttribute('aria-pressed', 'false');
        el.mic.querySelector('.mic-label').textContent = '듣기 시작';
      }
    },
  });

  el.mic.addEventListener('click', () => state.listener.toggle());

  el.formManual.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = el.inputManual.value.trim();
    if (q) handleQuery(q, { fromSpeech: false });
  });

  el.btnSettings.addEventListener('click', () => { el.settings.hidden = false; });
  el.btnCloseSettings.addEventListener('click', () => { el.settings.hidden = true; });
  el.settings.addEventListener('click', (e) => {
    if (e.target === el.settings) el.settings.hidden = true;
  });

  el.rangeFont.addEventListener('input', () => {
    state.settings.fontScale = Number(el.rangeFont.value);
    applySettings();
    saveSettings(state.settings);
  });

  el.chkAutoOpen.addEventListener('change', () => {
    state.settings.autoOpen = el.chkAutoOpen.checked;
    saveSettings(state.settings);
  });

  el.chkWakeLock.addEventListener('change', () => {
    state.settings.wakeLock = el.chkWakeLock.checked;
    saveSettings(state.settings);
    if (!el.chkWakeLock.checked) releaseWakeLock();
    else if (state.listener.wantsToListen) requestWakeLock();
  });

  el.btnDiagnose.addEventListener('click', onDiagnose);

  el.fileHymns.addEventListener('change', onHymnFile);
  el.fileBible.addEventListener('change', onBibleFile);

  el.btnClear.addEventListener('click', () => {
    if (!confirm('이 기기에 저장된 찬송가·성경 데이터를 지울까요?')) return;
    clearHymns();
    clearBible();
    loadHymnData();
    loadBibleData();
  });

  // 화면을 다시 켰을 때 wake lock 이 풀려 있으면 되살린다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.listener?.wantsToListen) {
      requestWakeLock();
    }
  });
}

function applySettings() {
  const s = state.settings;
  document.documentElement.style.setProperty('--font-scale', String(s.fontScale ?? 1));
  if (el.rangeFont) el.rangeFont.value = String(s.fontScale ?? 1);
  if (el.chkAutoOpen) el.chkAutoOpen.checked = s.autoOpen !== false;
  if (el.chkWakeLock) el.chkWakeLock.checked = s.wakeLock !== false;
}

/* ---------------------------------------------------------------- 질의 해석 */

function handleQuery(rawText, { fromSpeech }) {
  const text = String(rawText || '').trim();
  if (!text) return;

  // 음성인식은 같은 문장을 연달아 두 번 넘길 때가 있다.
  const now = Date.now();
  if (fromSpeech && text === state.lastQuery && now - state.lastQueryAt < 3000) return;
  state.lastQuery = text;
  state.lastQueryAt = now;

  const resolved = resolve(text);
  if (!resolved) {
    if (!fromSpeech) renderNoMatch(text);
    return;
  }
  render(resolved, text);
  addHistory(resolved);
}

/** 입력 문장을 하나의 결과로 해석한다. */
function resolve(text) {
  const hymnRef = parseHymnNumber(text);
  const bibleRef = parseBibleReference(text, state.bookIndex);

  // 찬송가를 명시적으로 말한 경우가 가장 확실하다.
  if (hymnRef && hymnRef.confidence >= 0.9) {
    return makeHymnResult(hymnRef.number);
  }

  // 성경 참조가 확실하면 그쪽을 택한다.
  if (bibleRef && bibleRef.confidence >= 0.85) {
    return makeBibleResult(bibleRef);
  }

  // "305장"처럼 번호만 말했고 성경으로 해석되지 않으면 찬송가로 본다.
  if (hymnRef) return makeHymnResult(hymnRef.number);
  if (bibleRef && bibleRef.confidence >= 0.4) return makeBibleResult(bibleRef);

  // 가사나 본문 내용으로 찾아본다.
  const hymnHits = state.hymnIndex ? search(state.hymnIndex, text, { limit: 5 }) : [];
  const bibleHits = state.bibleIndex ? search(state.bibleIndex, text, { limit: 5 }) : [];
  const hits = [...hymnHits, ...bibleHits].sort((a, b) => b.score - a.score).slice(0, 5);

  if (hits.length === 0) return null;
  if (hits[0].score >= 0.55 && state.settings.autoOpen !== false) {
    const top = hits[0].item;
    return top.kind === 'hymn'
      ? makeHymnResult(top.number, hits.slice(1))
      : makeBibleResult({
          book: { name: top.bookName },
          chapter: top.chapter,
          verse: top.verse,
          verseEnd: null,
          confidence: hits[0].score,
        }, hits.slice(1));
  }
  return { kind: 'candidates', hits };
}

function makeHymnResult(number, extraHits = []) {
  const hymn = state.hymns.find((h) => Number(h.number) === Number(number));
  return { kind: 'hymn', number, hymn: hymn || null, extraHits };
}

function makeBibleResult(ref, extraHits = []) {
  const bookName = ref.book?.name;
  let passage = null;
  if (state.bible && bookName && state.bible[bookName]) {
    const chapter = state.bible[bookName][String(ref.chapter)];
    if (chapter) {
      const from = ref.verse ?? 1;
      const to = ref.verseEnd ?? (ref.verse ? ref.verse : Object.keys(chapter).length);
      passage = [];
      for (let v = from; v <= to; v += 1) {
        if (chapter[String(v)]) passage.push({ verse: v, text: chapter[String(v)] });
      }
      if (passage.length === 0) passage = null;
    }
  }
  return { kind: 'bible', ref, passage, extraHits };
}

/* ------------------------------------------------------------------ 화면 */

function render(result, queryText) {
  if (result.kind === 'candidates') {
    el.result.innerHTML = `
      <div class="card">
        <p class="card-kind">이런 뜻이었을까요?</p>
        <p class="card-sub">들린 말: ${escapeHTML(queryText)}</p>
        ${renderCandidates(result.hits)}
      </div>`;
    bindCandidates();
    return;
  }

  if (result.kind === 'hymn') {
    const { number, hymn, extraHits } = result;
    el.result.innerHTML = `
      <div class="card is-primary">
        <p class="card-kind">찬송가</p>
        <h2 class="card-title">${number}장${hymn ? ` · ${escapeHTML(hymn.title)}` : ''}</h2>
        ${hymn?.lyrics
          ? `<p class="card-body">${escapeHTML(hymn.lyrics)}</p>`
          : `<p class="card-note">${hymn
              ? '가사가 저장되어 있지 않습니다.'
              : '이 번호의 찬송가 정보가 없습니다. 설정에서 찬송가 파일을 불러오면 제목과 가사가 표시됩니다.'}</p>`}
      </div>
      ${extraHits?.length ? `<div class="card"><p class="card-kind">다른 후보</p>${renderCandidates(extraHits)}</div>` : ''}`;
    bindCandidates();
    return;
  }

  if (result.kind === 'bible') {
    const { ref, passage, extraHits } = result;
    el.result.innerHTML = `
      <div class="card is-primary">
        <p class="card-kind">성경</p>
        <h2 class="card-title">${escapeHTML(formatReference(ref))}</h2>
        ${passage
          ? `<p class="card-body">${passage
              .map((p) => `<span class="verse-no">${p.verse}</span>${escapeHTML(p.text)}`)
              .join('\n')}</p>`
          : `<p class="card-note">본문이 저장되어 있지 않아 위치만 안내합니다. 성경책에서 위 부분을 펴 주세요.</p>`}
      </div>
      ${extraHits?.length ? `<div class="card"><p class="card-kind">다른 후보</p>${renderCandidates(extraHits)}</div>` : ''}`;
    bindCandidates();
  }
}

function renderCandidates(hits) {
  return `<ul class="candidates">${hits.map((hit) => {
    const it = hit.item;
    const label = it.kind === 'hymn'
      ? `<span class="candidate-num">${it.number}장</span><span>${escapeHTML(it.title)}</span>`
      : `<span class="candidate-num">${escapeHTML(it.title)}</span><span>${escapeHTML((it.text || '').slice(0, 40))}</span>`;
    const query = it.kind === 'hymn' ? `찬송가 ${it.number}장` : it.title;
    return `<li><button class="candidate-btn" type="button" data-query="${escapeHTML(query)}">
      ${label}<span class="candidate-score">${Math.round(hit.score * 100)}%</span>
    </button></li>`;
  }).join('')}</ul>`;
}

function bindCandidates() {
  el.result.querySelectorAll('.candidate-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleQuery(btn.dataset.query, { fromSpeech: false }));
  });
}

function renderNoMatch(text) {
  el.result.innerHTML = `
    <div class="card">
      <p class="card-kind">찾지 못했습니다</p>
      <p class="card-sub">입력: ${escapeHTML(text)}</p>
      <p class="card-note">
        "요한복음 3장 16절" 처럼 권 이름과 장·절을 함께 말하거나,
        "찬송가 305장" 처럼 번호를 말해 보세요.
        가사로 찾으려면 설정에서 찬송가 파일을 먼저 불러와야 합니다.
      </p>
    </div>`;
}

function addHistory(result) {
  const label = result.kind === 'hymn'
    ? `찬송가 ${result.number}장${result.hymn ? ` · ${result.hymn.title}` : ''}`
    : result.kind === 'bible'
      ? formatReference(result.ref)
      : null;
  if (!label) return;

  state.history = [
    { label, query: label },
    ...state.history.filter((h) => h.label !== label),
  ].slice(0, 12);

  el.historyList.innerHTML = state.history
    .map((h) => `<li><button class="history-btn" type="button" data-query="${escapeHTML(h.query)}">${escapeHTML(h.label)}</button></li>`)
    .join('');

  el.historyList.querySelectorAll('.history-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleQuery(btn.dataset.query, { fromSpeech: false }));
  });
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle('is-error', isError);
}

function escapeHTML(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ------------------------------------------------------------ 파일 불러오기 */

async function onHymnFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const hymns = parseHymnFile(text, file.name);
    if (hymns.length === 0) {
      el.hymnStatus.innerHTML = '<span class="err">읽을 수 있는 찬송가가 없습니다. 형식을 확인해 주세요.</span>';
      return;
    }
    if (!saveHymns(hymns)) {
      el.hymnStatus.innerHTML = '<span class="err">저장 공간이 부족합니다. 가사를 줄이거나 제목만 넣어 주세요.</span>';
      return;
    }
    setHymns(hymns, '');
    el.hymnStatus.innerHTML = `<span class="ok">찬송가 ${hymns.length}곡을 불러왔습니다.</span>`;
  } catch (err) {
    el.hymnStatus.innerHTML = `<span class="err">파일을 읽지 못했습니다: ${escapeHTML(err.message)}</span>`;
  }
}

async function onBibleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const bible = JSON.parse(await file.text());
    if (!saveBible(bible)) {
      el.bibleStatus.innerHTML = '<span class="err">저장 공간이 부족합니다. 신약 등 일부만 넣어 주세요.</span>';
      return;
    }
    loadBibleData();
    el.bibleStatus.innerHTML += ' <span class="ok">불러왔습니다.</span>';
  } catch (err) {
    el.bibleStatus.innerHTML = `<span class="err">파일을 읽지 못했습니다: ${escapeHTML(err.message)}</span>`;
  }
}

/* ------------------------------------------------------------------ 진단 */

async function onDiagnose() {
  el.diagnoseResult.innerHTML = '<p class="hint">확인하는 중...</p>';

  let result;
  try {
    result = await runDiagnostics();
  } catch (err) {
    el.diagnoseResult.innerHTML =
      `<p class="hint err">진단 중 오류가 났습니다: ${escapeHTML(err.message)}</p>`;
    return;
  }

  const { checks } = result;
  const problems = checks.filter((c) => c.ok === false);
  const unknown = checks.filter((c) => c.ok === null);

  const items = checks.map((c) => {
    const cls = c.ok === true ? 'is-ok' : c.ok === false ? 'is-bad' : 'is-unknown';
    const mark = c.ok === true ? '\u2713' : c.ok === false ? '\u2715' : '?';
    // 문제가 있거나 확인이 필요한 항목만 해결 방법을 보여 준다.
    const fix = c.ok === true || !c.fix ? '' : `<p class="diag-fix">${escapeHTML(c.fix)}</p>`;
    return `<li><div class="diag-item ${cls}">
      <div class="diag-head"><span class="diag-mark">${mark}</span><span>${escapeHTML(c.label)}</span></div>
      <p class="diag-detail">${escapeHTML(c.detail)}</p>
      ${fix}
    </div></li>`;
  }).join('');

  let summary;
  if (problems.length === 0 && unknown.length === 0) {
    summary = '막는 것이 없습니다. 마이크 버튼을 누르고 또렷하게 말해 보세요. '
      + '그래도 안 되면 주변이 너무 조용하거나 마이크가 가려져 있을 수 있습니다.';
  } else if (problems.length === 0) {
    summary = '자동으로 확인할 수 있는 항목은 모두 통과했습니다. '
      + '위에 «?» 로 표시된 항목을 직접 확인해 주세요.';
  } else {
    summary = `${problems.length}가지 문제를 찾았습니다. 위의 안내대로 고친 뒤 다시 진단해 보세요.`;
  }

  el.diagnoseResult.innerHTML =
    `<ul class="diag-list">${items}</ul><p class="diag-summary">${escapeHTML(summary)}</p>`;
}

/* -------------------------------------------------------------- 화면 유지 */

async function requestWakeLock() {
  if (state.settings.wakeLock === false) return;
  if (!('wakeLock' in navigator) || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch {
    // 배터리 절약 모드 등에서는 거부될 수 있다. 기능에는 지장이 없다.
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

init();
