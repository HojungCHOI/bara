/**
 * 한국어 텍스트 유사도 검색.
 *
 * 음성인식 결과는 받아쓰기 오류가 섞이기 때문에 정확 일치로는 못 찾는다.
 * 글자 2-gram 집합의 Dice 계수로 부분 일치를 허용해 후보를 뽑는다.
 */

/** 검색용으로 텍스트를 정규화한다. 한글/영문/숫자만 남긴다. */
export function normalizeForSearch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]+/g, '');
}

/** 문자열에서 글자 2-gram 집합을 만든다. */
export function bigrams(text) {
  const s = normalizeForSearch(text);
  const out = new Set();
  if (s.length === 0) return out;
  if (s.length === 1) {
    out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

/** 두 2-gram 집합의 Dice 계수(0~1). */
export function diceCoefficient(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (large.has(g)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * 질의문이 문서 안에 "부분적으로" 들어있는 정도를 잰다.
 * 찬송 한 소절만 들려도 전체 가사에서 찾을 수 있어야 하므로,
 * 질의 기준 포함율(containment)을 함께 본다.
 */
export function containment(queryGrams, docGrams) {
  if (queryGrams.size === 0) return 0;
  let shared = 0;
  for (const g of queryGrams) if (docGrams.has(g)) shared += 1;
  return shared / queryGrams.size;
}

/**
 * 검색 인덱스를 만든다.
 * items: [{ id, title, text, ...나머지 필드 }]
 */
export function buildSearchIndex(items) {
  const entries = items.map((item) => ({
    item,
    titleGrams: bigrams(item.title || ''),
    textGrams: bigrams(`${item.title || ''} ${item.text || ''}`),
  }));

  // 2-gram -> 해당 gram 을 가진 항목 위치. 후보를 좁히는 데 쓴다.
  const inverted = new Map();
  entries.forEach((entry, i) => {
    for (const g of entry.textGrams) {
      let bucket = inverted.get(g);
      if (!bucket) {
        bucket = [];
        inverted.set(g, bucket);
      }
      bucket.push(i);
    }
  });

  return { entries, inverted };
}

/**
 * 인덱스에서 질의문과 가장 비슷한 항목들을 찾는다.
 * [{ item, score, titleScore }] 를 점수 내림차순으로 반환한다.
 */
export function search(index, query, { limit = 5, minScore = 0.18 } = {}) {
  const queryGrams = bigrams(query);
  if (queryGrams.size === 0 || !index) return [];

  // 겹치는 2-gram 이 하나라도 있는 항목만 후보로 본다.
  const candidates = new Set();
  for (const g of queryGrams) {
    const bucket = index.inverted.get(g);
    if (bucket) for (const i of bucket) candidates.add(i);
  }

  const results = [];
  for (const i of candidates) {
    const entry = index.entries[i];
    const titleScore = diceCoefficient(queryGrams, entry.titleGrams);
    const bodyContainment = containment(queryGrams, entry.textGrams);
    const bodyDice = diceCoefficient(queryGrams, entry.textGrams);

    // 제목이 맞으면 강하게, 본문에 통째로 들어있으면 그 다음으로 높게 본다.
    const score = Math.max(titleScore * 1.0, bodyContainment * 0.95, bodyDice * 0.8);
    if (score >= minScore) results.push({ item: entry.item, score, titleScore });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
