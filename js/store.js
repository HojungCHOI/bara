/**
 * 사용자가 직접 넣은 찬송가/성경 데이터를 브라우저에 보관한다.
 *
 * 찬송가 가사와 성경 본문은 판본마다 저작권자가 다르므로 저장소에 담지 않는다.
 * 사용자가 본인이 쓰는 판본의 파일을 불러오면 이곳(localStorage)에 저장된다.
 */

const KEY_HYMNS = 'biblehelper.hymns.v1';
const KEY_BIBLE = 'biblehelper.bible.v1';
const KEY_SETTINGS = 'biblehelper.settings.v1';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 용량 초과(대개 5MB 제한). 호출한 쪽에서 사용자에게 알린다.
    return false;
  }
}

/** 찬송가 목록을 읽는다. [{ number, title, lyrics }] */
export function loadHymns() {
  return readJSON(KEY_HYMNS, null);
}

export function saveHymns(hymns) {
  return writeJSON(KEY_HYMNS, hymns);
}

export function clearHymns() {
  localStorage.removeItem(KEY_HYMNS);
}

/** 성경 본문을 읽는다. { "요한복음": { "3": { "16": "하나님이 ..." } } } */
export function loadBible() {
  return readJSON(KEY_BIBLE, null);
}

export function saveBible(bible) {
  return writeJSON(KEY_BIBLE, bible);
}

export function clearBible() {
  localStorage.removeItem(KEY_BIBLE);
}

export function loadSettings() {
  return readJSON(KEY_SETTINGS, { fontScale: 1, autoOpen: true, edition: '새찬송가' });
}

export function saveSettings(settings) {
  return writeJSON(KEY_SETTINGS, settings);
}

/**
 * 여러 형식으로 들어오는 찬송가 파일을 하나의 배열로 정규화한다.
 * 지원 형식:
 *   1) [{ number, title, lyrics }]
 *   2) { "305": { title, lyrics } }
 *   3) CSV: number,title,lyrics
 */
export function parseHymnFile(text, filename = '') {
  const trimmed = text.trim();

  if (filename.toLowerCase().endsWith('.csv') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return parseHymnCSV(trimmed);
  }

  const data = JSON.parse(trimmed);
  const rows = Array.isArray(data) ? data : Array.isArray(data.hymns) ? data.hymns : null;

  if (rows) {
    return rows
      .map((row) => ({
        number: Number(row.number ?? row.no ?? row.장),
        title: String(row.title ?? row.제목 ?? '').trim(),
        lyrics: String(row.lyrics ?? row.가사 ?? row.text ?? '').trim(),
      }))
      .filter((h) => Number.isFinite(h.number) && h.title);
  }

  // { "305": {...} } 형태
  return Object.entries(data)
    .map(([number, row]) => ({
      number: Number(number),
      title: String(row.title ?? row.제목 ?? row ?? '').trim(),
      lyrics: String(row.lyrics ?? row.가사 ?? '').trim(),
    }))
    .filter((h) => Number.isFinite(h.number) && h.title);
}

/** 아주 단순한 CSV 파서. 큰따옴표로 감싼 필드와 줄바꿈을 지원한다. */
export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseHymnCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length === 0) return [];

  // 첫 줄이 헤더면 건너뛴다.
  // 데이터 행의 첫 칸은 반드시 번호이므로, 숫자가 아니면 헤더로 본다.
  // (제목이 "제목"인 곡을 헤더로 오인하지 않기 위해 첫 칸만 본다.)
  const firstCell = String(rows[0][0] ?? '').trim();
  const hasHeader = !/^\d+$/.test(firstCell);
  const body = hasHeader ? rows.slice(1) : rows;

  return body
    .map((cols) => ({
      number: Number(String(cols[0] ?? '').trim()),
      title: String(cols[1] ?? '').trim(),
      lyrics: String(cols[2] ?? '').trim(),
    }))
    .filter((h) => Number.isFinite(h.number) && h.title);
}
