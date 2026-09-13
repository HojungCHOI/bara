/**
 * 조각난 인식 결과를 모아 하나의 판단으로 만든다.
 *
 * 합창을 음성인식에 물리면 문장이 통째로 나오지 않고
 * "나같은" · "죄인" · "은혜놀라와" 처럼 짧고 뭉개진 조각으로 흩어진다.
 * 조각 하나하나는 점수가 낮아 버려지지만, 같은 곡을 반복해서 가리킨다면
 * 그것 자체가 근거다. 그래서 조각별 점수를 곡마다 쌓아 두고,
 * 오래된 것은 서서히 잊는다.
 */

/** 최근 텍스트를 시간 창 안에서만 보관한다. */
export class TranscriptBuffer {
  constructor({ windowMs = 20000, maxEntries = 12 } = {}) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  push(text, now = Date.now()) {
    const clean = String(text || '').trim();
    if (!clean) return;
    // 같은 조각이 연달아 들어오면 한 번만 센다.
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === clean) {
      last.at = now;
      return;
    }
    this.entries.push({ text: clean, at: now });
    this._prune(now);
  }

  /** 시간 창 안의 조각들을 이어 붙인다. */
  combined(now = Date.now()) {
    this._prune(now);
    return this.entries.map((e) => e.text).join(' ');
  }

  size(now = Date.now()) {
    this._prune(now);
    return this.entries.length;
  }

  clear() {
    this.entries = [];
  }

  _prune(now) {
    const cutoff = now - this.windowMs;
    this.entries = this.entries.filter((e) => e.at >= cutoff);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
}

/**
 * 후보별 점수를 시간에 따라 감쇠시키며 누적한다.
 * 반감기가 지나면 예전 근거의 무게가 절반이 된다.
 */
export class EvidenceAccumulator {
  constructor({ halfLifeMs = 12000, threshold = 1.1, minFragmentScore = 0.12 } = {}) {
    this.halfLifeMs = halfLifeMs;
    this.threshold = threshold;
    this.minFragmentScore = minFragmentScore;
    /** id -> { item, score, at, hits } */
    this.entries = new Map();
  }

  /** 검색 결과 한 묶음을 근거로 추가한다. */
  add(hits, now = Date.now()) {
    this._decay(now);
    for (const hit of hits) {
      if (!hit || hit.score < this.minFragmentScore) continue;
      const id = hit.item.id;
      const prev = this.entries.get(id);
      if (prev) {
        prev.score += hit.score;
        prev.hits += 1;
        prev.at = now;
      } else {
        this.entries.set(id, { item: hit.item, score: hit.score, at: now, hits: 1 });
      }
    }
  }

  /** 지금까지 가장 유력한 후보. 문턱을 넘지 못하면 null. */
  best(now = Date.now()) {
    this._decay(now);
    let best = null;
    for (const entry of this.entries.values()) {
      if (!best || entry.score > best.score) best = entry;
    }
    if (!best || best.score < this.threshold) return null;
    // 서로 다른 조각 두 개 이상이 같은 곳을 가리켜야 믿는다.
    if (best.hits < 2) return null;
    return best;
  }

  /** 점수 순 후보 목록. 화면에 보여 줄 때 쓴다. */
  ranked(now = Date.now(), limit = 5) {
    this._decay(now);
    return [...this.entries.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  clear() {
    this.entries.clear();
  }

  _decay(now) {
    for (const [id, entry] of this.entries) {
      const elapsed = now - entry.at;
      if (elapsed <= 0) continue;
      const factor = Math.pow(0.5, elapsed / this.halfLifeMs);
      entry.score *= factor;
      entry.at = now;
      // 거의 사라진 근거는 버린다.
      if (entry.score < 0.02) this.entries.delete(id);
    }
  }
}
