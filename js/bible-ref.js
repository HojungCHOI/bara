/**
 * 한국어 성경 구절 참조 파서.
 *
 * "요한복음 3장 16절", "요 3:16", "시편 23편", "고린도전서 13장 4절부터 7절까지"
 * 같은 표현에서 권/장/절을 뽑아낸다.
 */

import { normalizeNumeralsInText } from './korean-number.js?v=ff3265f';

/**
 * 공백과 문장부호를 걷어내 비교용 키로 만든다.
 * 장:절 구분자(: . - ~)는 파싱에 필요하므로 남겨 둔다.
 */
export function normalizeKey(text) {
  return String(text || '')
    .replace(/[\s ]+/g, '')
    .replace(/[,·;'"()[\]<>!?]/g, '')
    .toLowerCase();
}

/** 권 이름 비교 전용 키. 구분자까지 모두 제거한다. */
function aliasKey(text) {
  return normalizeKey(text).replace(/[:.\-~]/g, '');
}

/**
 * books.json 의 books 배열로 별칭 -> 권 조회 테이블을 만든다.
 * 긴 별칭이 먼저 매칭되도록 길이 내림차순으로 정렬해 둔다.
 */
export function buildBookIndex(books) {
  const byKey = new Map();
  for (const book of books) {
    for (const alias of book.aliases) {
      const key = aliasKey(alias);
      // 이미 등록된 별칭은 덮어쓰지 않는다(먼저 온 권이 우선).
      if (key && !byKey.has(key)) byKey.set(key, book);
    }
  }
  const aliasesByLength = [...byKey.keys()].sort((a, b) => b.length - a.length);
  return { byKey, aliasesByLength, books };
}

/** 권 이름 뒤 문자열에서 장/절을 읽는다. 못 읽으면 null. */
function parseChapterVerse(tail) {
  // 형식 1: "3장16절", "23편", "3장4절부터7절까지"
  const chapterMatch = tail.match(/^(\d+)\s*(?:장|편)/);
  if (chapterMatch) {
    const chapter = parseInt(chapterMatch[1], 10);
    const after = tail.slice(chapterMatch[0].length);
    const verseMatch = after.match(/^(\d+)\s*절(?:부터|에서|~|-)?\s*(?:(\d+)\s*절?\s*(?:까지)?)?/);
    if (verseMatch) {
      return {
        chapter,
        verse: parseInt(verseMatch[1], 10),
        verseEnd: verseMatch[2] ? parseInt(verseMatch[2], 10) : null,
      };
    }
    return { chapter, verse: null, verseEnd: null };
  }

  // 형식 2: "3:16", "3:16-18", "3.16"
  const colonMatch = tail.match(/^(\d+)[:.](\d+)(?:[-~](\d+))?/);
  if (colonMatch) {
    return {
      chapter: parseInt(colonMatch[1], 10),
      verse: parseInt(colonMatch[2], 10),
      verseEnd: colonMatch[3] ? parseInt(colonMatch[3], 10) : null,
    };
  }

  // 형식 3: 단위 없이 숫자만 ("요한복음 3")
  const bare = tail.match(/^(\d+)/);
  if (bare) {
    return { chapter: parseInt(bare[1], 10), verse: null, verseEnd: null };
  }

  return null;
}

/**
 * 문장에서 성경 참조를 찾아낸다.
 * 찾으면 { book, chapter, verse, verseEnd, matchedText, confidence } 를,
 * 못 찾으면 null 을 반환한다.
 *
 * "아"(아가), "요"(요한복음) 같은 한 글자 약칭은 일상 대화에서 너무 흔해
 * 뒤에 장/절 숫자가 따라올 때만 참조로 인정한다.
 */
export function parseBibleReference(rawText, bookIndex) {
  if (!rawText || !bookIndex) return null;

  const text = normalizeNumeralsInText(String(rawText));
  const flat = normalizeKey(text);
  if (!flat) return null;

  let best = null;

  for (const alias of bookIndex.aliasesByLength) {
    let from = 0;
    for (;;) {
      const idx = flat.indexOf(alias, from);
      if (idx === -1) break;
      from = idx + 1;

      const book = bookIndex.byKey.get(alias);
      const tail = flat.slice(idx + alias.length);
      const parsed = parseChapterVerse(tail);
      const isShortAlias = alias.length <= 2;

      // 짧은 약칭은 숫자가 뒤따를 때만 인정한다.
      if (!parsed && isShortAlias) continue;

      let confidence;
      let chapter;
      let verse = null;
      let verseEnd = null;

      if (!parsed) {
        // 정식 권 이름만 나온 경우 -> 1장을 열어준다.
        chapter = 1;
        confidence = 0.4;
      } else {
        chapter = parsed.chapter;
        verse = parsed.verse;
        verseEnd = parsed.verseEnd;
        const withinRange = chapter >= 1 && chapter <= book.chapters;
        if (!withinRange) {
          chapter = Math.min(Math.max(chapter, 1), book.chapters);
          confidence = 0.3;
        } else {
          confidence = verse !== null ? 0.98 : 0.9;
        }
        // 긴 정식 이름일수록 오탐 가능성이 낮다.
        if (alias.length >= 3) confidence = Math.min(1, confidence + 0.01);
      }

      const candidate = {
        book, chapter, verse, verseEnd,
        matchedText: text.trim(),
        confidence,
        _aliasLength: alias.length,
      };

      if (!best
        || candidate.confidence > best.confidence
        || (candidate.confidence === best.confidence
            && candidate._aliasLength > best._aliasLength)) {
        best = candidate;
      }
    }
  }

  if (!best) return null;
  delete best._aliasLength;
  return best;
}

/** 참조 객체를 "요한복음 3:16" 형태의 사람이 읽는 문자열로 만든다. */
export function formatReference(ref) {
  if (!ref) return '';
  let out = `${ref.book.name} ${ref.chapter}`;
  if (ref.verse !== null && ref.verse !== undefined) {
    out += `:${ref.verse}`;
    if (ref.verseEnd) out += `-${ref.verseEnd}`;
  }
  return out;
}
