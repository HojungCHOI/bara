/**
 * 찬송가 번호 인식.
 *
 * "찬송가 305장", "찬송 삼백오장", "305장" 같은 표현에서 번호를 뽑아낸다.
 */

import { normalizeNumeralsInText } from './korean-number.js';

/** 새찬송가 645장, 통일찬송가 558장. 넉넉히 900까지만 번호로 인정한다. */
const MAX_HYMN_NUMBER = 900;

/**
 * 문장에서 찬송가 번호를 찾는다.
 * { number, confidence } 또는 null 을 반환한다.
 */
export function parseHymnNumber(rawText) {
  const text = normalizeNumeralsInText(String(rawText || ''));

  // "찬송가 305장" — 찬송가를 명시했으므로 가장 확실하다.
  const explicit = text.match(/(?:찬송가|찬송|찬양)\s*(?:제)?\s*(\d{1,3})\s*장?/);
  if (explicit) {
    const number = parseInt(explicit[1], 10);
    if (number >= 1 && number <= MAX_HYMN_NUMBER) return { number, confidence: 0.98 };
  }

  // "305장" — 번호만 말한 경우. 성경 참조일 수도 있어 신뢰도를 낮게 준다.
  const bare = text.match(/(?:^|\s)(\d{1,3})\s*장(?:\s|$|[.,!?])/);
  if (bare) {
    const number = parseInt(bare[1], 10);
    if (number >= 1 && number <= MAX_HYMN_NUMBER) return { number, confidence: 0.6 };
  }

  return null;
}
