/**
 * 한국어 수사(數詞)를 아라비아 숫자로 바꾸는 유틸.
 *
 * 음성인식은 "삼백오 장"처럼 한자어 수사를 그대로 받아쓰는 경우가 많고,
 * "305장"처럼 숫자로 주는 경우도 있어서 양쪽을 모두 처리해야 한다.
 */

const SINO_DIGIT = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5,
  육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
};

const SMALL_UNIT = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNIT = { 만: 10000, 억: 100000000 };

/** 순우리말 수사. 장/절 번호에는 드물지만 "한 장", "두 절"처럼 쓰인다. */
const NATIVE = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 서: 3, 네: 4, 넷: 4, 너: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
  스물: 20, 서른: 30, 마흔: 40, 쉰: 50,
  예순: 60, 일흔: 70, 여든: 80, 아흔: 90,
};

const SINO_CHARS = new Set([
  ...Object.keys(SINO_DIGIT),
  ...Object.keys(SMALL_UNIT),
  ...Object.keys(BIG_UNIT),
]);

/** 문자열 전체가 한자어 수사인지 검사한다. */
export function isSinoNumeral(text) {
  const s = String(text).replace(/\s+/g, '');
  return s.length > 0 && [...s].every((ch) => SINO_CHARS.has(ch));
}

/**
 * 한자어 수사 문자열을 숫자로 변환한다. ("삼백오" -> 305, "십육" -> 16)
 * 변환할 수 없으면 null 을 반환한다.
 */
export function parseSinoNumeral(text) {
  const s = String(text).replace(/\s+/g, '');
  if (!s || !isSinoNumeral(s)) return null;

  let total = 0;   // 확정된 상위 자리 합 (만/억 단위로 넘어간 값)
  let section = 0; // 현재 만(萬) 미만 구간의 누적값
  let current = 0; // 아직 단위를 만나지 못한 숫자

  for (const ch of s) {
    if (ch in SINO_DIGIT) {
      current = current * 10 + SINO_DIGIT[ch];
      continue;
    }
    if (ch in SMALL_UNIT) {
      // "십육"처럼 앞자리가 생략되면 1로 본다.
      section += (current === 0 ? 1 : current) * SMALL_UNIT[ch];
      current = 0;
      continue;
    }
    if (ch in BIG_UNIT) {
      section += current;
      total += (section === 0 ? 1 : section) * BIG_UNIT[ch];
      section = 0;
      current = 0;
    }
  }
  return total + section + current;
}

/** 순우리말 수사를 숫자로 변환한다. ("스물셋" -> 23) 실패 시 null. */
export function parseNativeNumeral(text) {
  const s = String(text).replace(/\s+/g, '');
  if (!s) return null;
  if (s in NATIVE) return NATIVE[s];

  // "스물셋", "열두"처럼 십의 자리 + 일의 자리 조합
  for (const tens of ['아흔', '여든', '일흔', '예순', '쉰', '마흔', '서른', '스물', '열']) {
    if (s.startsWith(tens)) {
      const rest = s.slice(tens.length);
      if (!rest) return NATIVE[tens];
      const ones = NATIVE[rest];
      if (ones !== undefined && ones < 10) return NATIVE[tens] + ones;
      return null;
    }
  }
  return null;
}

/**
 * 숫자 표기든 한국어 수사든 하나의 정수로 변환한다.
 * 어떤 방식으로도 읽을 수 없으면 null 을 반환한다.
 */
export function toNumber(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) return parseInt(s, 10);

  const native = parseNativeNumeral(s);
  if (native !== null) return native;

  return parseSinoNumeral(s);
}

/**
 * 문장 안에 섞여 있는 한국어 수사를 숫자로 치환한다.
 * "요한복음 삼장 십육절" -> "요한복음 3장 16절"
 *
 * 성경 권 이름에 쓰이는 글자(예: 사무엘'상', 요한'일'서)를 숫자로 잘못 바꾸지
 * 않도록, 뒤에 장/절/편/장수 단위가 오는 경우에만 치환한다.
 */
export function normalizeNumeralsInText(text) {
  if (!text) return '';
  const numeral = '[영공일이삼사오육륙칠팔구십백천만억]+';
  const native = '(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스물|서른|마흔|쉰|예순|일흔|여든|아흔)+';
  const unit = '(?=\\s*(?:장|절|편|권))';

  return String(text)
    .replace(new RegExp(`(${native})${unit}`, 'g'), (m, g) => {
      const n = parseNativeNumeral(g);
      return n === null ? m : String(n);
    })
    .replace(new RegExp(`(${numeral})${unit}`, 'g'), (m, g) => {
      const n = parseSinoNumeral(g);
      return n === null ? m : String(n);
    });
}
