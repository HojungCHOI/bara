/**
 * 의존성 없는 테스트 러너.  실행: node test/run.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toNumber, parseSinoNumeral, parseNativeNumeral, normalizeNumeralsInText } from '../js/korean-number.js';
import { buildBookIndex, parseBibleReference, formatReference } from '../js/bible-ref.js';
import { parseHymnNumber } from '../js/hymn.js';
import { buildSearchIndex, search, bigrams, diceCoefficient, normalizeForSearch } from '../js/search.js';
import { parseHymnFile, parseCSVRows } from '../js/store.js';
import { TranscriptBuffer, EvidenceAccumulator } from '../js/evidence.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { books } = JSON.parse(fs.readFileSync(path.join(root, 'data/books.json'), 'utf8'));
const bookIndex = buildBookIndex(books);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`  ✗ ${name}\n      기대: ${e}\n      실제: ${a}`);
  }
}

function group(title, fn) {
  console.log(`\n▸ ${title}`);
  const before = failed;
  fn();
  const mark = failed === before ? '통과' : '실패';
  console.log(`  ${mark}`);
}

/* ------------------------------------------------------------ 한국어 수사 */

group('한국어 수사 변환', () => {
  check('삼백오', parseSinoNumeral('삼백오'), 305);
  check('십육', parseSinoNumeral('십육'), 16);
  check('이십삼', parseSinoNumeral('이십삼'), 23);
  check('백', parseSinoNumeral('백'), 100);
  check('천이백삼십사', parseSinoNumeral('천이백삼십사'), 1234);
  check('일', parseSinoNumeral('일'), 1);
  check('공백 포함', parseSinoNumeral('삼 백 오'), 305);
  check('수사 아님', parseSinoNumeral('사랑'), null);
  check('빈 문자열', parseSinoNumeral(''), null);

  check('스물셋', parseNativeNumeral('스물셋'), 23);
  check('열', parseNativeNumeral('열'), 10);
  check('여덟', parseNativeNumeral('여덟'), 8);
  check('순우리말 아님', parseNativeNumeral('삼백'), null);

  check('숫자 그대로', toNumber('305'), 305);
  check('한자어 경유', toNumber('삼백오'), 305);
  check('순우리말 경유', toNumber('스물셋'), 23);
  check('null 입력', toNumber(null), null);
});

group('문장 속 수사 정규화', () => {
  check('장절', normalizeNumeralsInText('요한복음 삼장 십육절'), '요한복음 3장 16절');
  check('찬송가', normalizeNumeralsInText('찬송가 삼백오장'), '찬송가 305장');
  check('시편', normalizeNumeralsInText('시편 이십삼편'), '시편 23편');
  check('순우리말 장', normalizeNumeralsInText('세 장'), '3 장');
  // 권 이름의 '상/일/이'를 숫자로 잘못 바꾸면 안 된다.
  check('사무엘상 보존', normalizeNumeralsInText('사무엘상 이장'), '사무엘상 2장');
  check('요한일서 보존', normalizeNumeralsInText('요한일서 사장'), '요한일서 4장');
  check('단위 없으면 그대로', normalizeNumeralsInText('오늘 사랑을 전합니다'), '오늘 사랑을 전합니다');
});

/* -------------------------------------------------------------- 성경 참조 */

const ref = (text) => {
  const r = parseBibleReference(text, bookIndex);
  return r ? formatReference(r) : null;
};

group('성경 참조 파싱', () => {
  check('정식 명칭', ref('요한복음 3장 16절'), '요한복음 3:16');
  check('약칭 + 콜론', ref('요 3:16'), '요한복음 3:16');
  check('시편 편 단위', ref('시편 23편'), '시편 23');
  check('절 범위', ref('고린도전서 13장 4절부터 7절까지'), '고린도전서 13:4-7');
  check('문장 속', ref('오늘 본문은 창세기 일장 일절입니다'), '창세기 1:1');
  check('한자어 장', ref('마태복음 삼장'), '마태복음 3');
  check('상하 구분', ref('사무엘상 17장 45절'), '사무엘상 17:45');
  check('일이삼서 구분', ref('요한일서 4장 8절'), '요한일서 4:8');
  check('약칭 계', ref('계 22장'), '요한계시록 22');
  check('시 약칭', ref('시 119편 105절'), '시편 119:105');

  // 오탐 방지: 한 글자 약칭이 일상어에 섞여도 참조로 보지 않는다.
  check('오탐 1', ref('아무 말이나 합니다'), null);
  check('오탐 2', ref('오늘 날씨가 참 좋습니다'), null);
  check('오탐 3', ref('다 같이 찬송합시다'), null);
  check('빈 입력', ref(''), null);

  // 장 수 범위를 넘으면 신뢰도를 낮추고 마지막 장으로 잡아 준다.
  const overflow = parseBibleReference('요한복음 99장', bookIndex);
  check('범위 초과 장 보정', overflow.chapter, 21);
  check('범위 초과 신뢰도', overflow.confidence < 0.5, true);
});

group('성경 권 데이터 무결성', () => {
  check('권 수', books.length, 66);
  check('총 장 수', books.reduce((sum, b) => sum + b.chapters, 0), 1189);
  check('구약 39권', books.filter((b) => b.testament === 'old').length, 39);
  check('신약 27권', books.filter((b) => b.testament === 'new').length, 27);
  check('id 중복 없음', new Set(books.map((b) => b.id)).size, 66);
  check('모든 권에 별칭 존재', books.every((b) => b.aliases.length >= 2), true);
});

/* -------------------------------------------------------------- 찬송가 번호 */

group('찬송가 번호 파싱', () => {
  check('명시적', parseHymnNumber('찬송가 305장'), { number: 305, confidence: 0.98 });
  check('한자어', parseHymnNumber('찬송가 삼백오장'), { number: 305, confidence: 0.98 });
  check('찬송 생략형', parseHymnNumber('찬송 1장'), { number: 1, confidence: 0.98 });
  check('번호만', parseHymnNumber('305장'), { number: 305, confidence: 0.6 });
  check('범위 초과', parseHymnNumber('찬송가 999장'), null);
  check('번호 없음', parseHymnNumber('오늘 참 좋습니다'), null);

  // 예배 인도자가 실제로 할 법한 말들. 합창 전에 반드시 번호를 말하므로
  // 이 경로가 가장 확실한 자동 인식 수단이다.
  const num = (t) => parseHymnNumber(t)?.number ?? null;
  check('안내 문장 전체', num('다 함께 찬송가 305장을 부르겠습니다'), 305);
  check('수사 중간 공백', num('찬송가 삼백 오장'), 305);
  check('단위 앞 공백', num('찬송가 삼백오 장 다같이 부르시겠습니다'), 305);
  check('조사 뒤따름', num('오늘은 305장입니다'), 305);
  check('새찬송가 표기', num('새찬송가 305장'), 305);
  check('제 N장', num('찬송가 제 305장'), 305);
  check('번 단위', num('305번'), 305);
  check('단위 생략', num('찬송가 305'), 305);
  check('두 자리 한자어', num('다같이 찬송가 팔십구장 부르겠습니다'), 89);
  check('공백 섞인 두 자리', num('찬송 삼십 삼장'), 33);
  // "한 번"을 1번으로 잘못 읽으면 안 된다.
  check('한 번은 번호 아님', num('한 번 더 부르겠습니다'), null);
});

/* ------------------------------------------------------------------ 검색 */

const items = [
  { id: 1, kind: 'hymn', number: 305, title: '나 같은 죄인 살리신', text: '나 같은 죄인 살리신 주 은혜 놀라워 잃었던 생명 찾았고 광명을 얻었네' },
  { id: 2, kind: 'hymn', number: 405, title: '주 안에 있는 나에게', text: '주 안에 있는 나에게 딴 근심 있으랴 십자가 밑에 나아가 내 죄를 다 씻었네' },
  { id: 3, kind: 'hymn', number: 563, title: '예수 사랑하심은', text: '예수 사랑하심은 거룩하신 말일세 우리들은 약하나 예수 권세 많도다' },
];
const index = buildSearchIndex(items);
const top = (q) => {
  const r = search(index, q);
  return r.length ? r[0].item.number : null;
};

group('가사 유사도 검색', () => {
  check('제목 정확', top('나 같은 죄인 살리신'), 305);
  check('띄어쓰기 다름', top('나같은죄인살리신'), 305);
  check('본문 소절', top('잃었던 생명 찾았고'), 305);
  check('다른 곡 소절', top('십자가 밑에 나아가'), 405);
  check('받아쓰기 오차', top('예수 사랑 하심은 거룩하신'), 563);
  check('무관한 문장', top('전혀 관계없는 문장입니다'), null);
  check('빈 질의', search(index, ''), []);

  check('정규화', normalizeForSearch('나 같은, 죄인!'), '나같은죄인');
  check('2-gram 개수', bigrams('가나다').size, 2);
  check('한 글자', [...bigrams('가')], ['가']);
  check('빈 문자열', bigrams('').size, 0);
  check('동일 문자열 dice', diceCoefficient(bigrams('사랑'), bigrams('사랑')), 1);
  check('무관 dice', diceCoefficient(bigrams('사랑'), bigrams('평화')), 0);
});

/* ------------------------------------------------------------ 파일 불러오기 */

group('찬송가 파일 파싱', () => {
  const csv = 'number,title,lyrics\n305,"나 같은 죄인 살리신","나 같은 죄인 살리신, 주 은혜 놀라워"\n1,만복의 근원 하나님,만복의 근원';
  check('CSV 행 수', parseHymnFile(csv, 'h.csv').length, 2);
  check('CSV 따옴표 안 쉼표', parseHymnFile(csv, 'h.csv')[0].lyrics, '나 같은 죄인 살리신, 주 은혜 놀라워');
  check('헤더 없는 CSV', parseHymnFile('305,제목,가사', 'h.csv').length, 1);

  check('JSON 배열', parseHymnFile(JSON.stringify([{ number: 8, title: '테스트', lyrics: '가사' }])).length, 1);
  check('JSON 객체', parseHymnFile(JSON.stringify({ 12: { title: '객체', lyrics: '가사' } }))[0].number, 12);
  check('hymns 래핑', parseHymnFile(JSON.stringify({ hymns: [{ number: 3, title: 'ㄱ' }] }))[0].number, 3);
  check('한글 키', parseHymnFile(JSON.stringify([{ 장: 7, 제목: '한글', 가사: 'ㄴ' }]))[0].title, '한글');
  check('제목 없는 행 제외', parseHymnFile(JSON.stringify([{ number: 1, title: '' }])).length, 0);

  check('CSV 줄바꿈 포함 필드', parseCSVRows('a,"b\nc"\n').length, 1);
});

/* ------------------------------------------------------- 조각 누적 (합창 대응) */

group('인식 조각 버퍼', () => {
  const t0 = 1_000_000;
  const buf = new TranscriptBuffer({ windowMs: 10000, maxEntries: 5 });

  buf.push('나 같은', t0);
  buf.push('죄인', t0 + 1000);
  check('두 조각 누적', buf.combined(t0 + 1500), '나 같은 죄인');

  buf.push('죄인', t0 + 2000);
  check('연속 중복은 한 번만', buf.combined(t0 + 2500), '나 같은 죄인');

  check('시간 창 밖은 버림', buf.combined(t0 + 20000), '');

  const buf2 = new TranscriptBuffer({ windowMs: 10000, maxEntries: 2 });
  buf2.push('가', t0); buf2.push('나', t0); buf2.push('다', t0);
  check('최대 개수 제한', buf2.combined(t0), '나 다');

  buf2.clear();
  check('비우기', buf2.size(t0), 0);
  buf2.push('   ', t0);
  check('공백은 무시', buf2.size(t0), 0);
});

group('근거 누적', () => {
  const t0 = 2_000_000;
  const A = { id: 'hymn-305', number: 305 };
  const B = { id: 'hymn-405', number: 405 };

  const acc = new EvidenceAccumulator({ halfLifeMs: 10000, threshold: 1.0 });

  // 조각 하나만으로는 결론을 내지 않는다.
  acc.add([{ item: A, score: 0.3 }], t0);
  check('조각 하나로는 판단 보류', acc.best(t0), null);

  // 같은 곡을 가리키는 조각이 쌓이면 문턱을 넘는다.
  acc.add([{ item: A, score: 0.4 }], t0 + 1000);
  acc.add([{ item: A, score: 0.4 }], t0 + 2000);
  const best = acc.best(t0 + 2000);
  check('조각이 쌓이면 판단', best && best.item.number, 305);

  // 오래되면 잊는다.
  check('시간이 지나면 근거 소멸', acc.best(t0 + 200000), null);

  // 점수가 너무 낮은 조각은 잡음으로 본다.
  const acc2 = new EvidenceAccumulator({ minFragmentScore: 0.2, threshold: 0.3 });
  acc2.add([{ item: A, score: 0.05 }], t0);
  acc2.add([{ item: A, score: 0.05 }], t0 + 100);
  check('잡음 조각은 무시', acc2.best(t0 + 100), null);

  // 여러 후보 중 더 많이 지지받은 쪽을 고른다.
  const acc3 = new EvidenceAccumulator({ halfLifeMs: 10000, threshold: 0.8 });
  acc3.add([{ item: A, score: 0.3 }, { item: B, score: 0.5 }], t0);
  acc3.add([{ item: A, score: 0.6 }], t0 + 500);
  acc3.add([{ item: A, score: 0.3 }], t0 + 900);
  check('지지가 많은 쪽 선택', acc3.best(t0 + 900).item.number, 305);
  check('순위 목록', acc3.ranked(t0 + 900).map((e) => e.item.number), [305, 405]);

  acc3.clear();
  check('비우기', acc3.best(t0 + 900), null);
});

/* ------------------------------------------------------------------ 결과 */

console.log(`\n${'─'.repeat(46)}`);
if (failures.length) {
  console.log('실패한 검사:');
  failures.forEach((f) => console.log(f));
  console.log('');
}
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
process.exit(failed === 0 ? 0 : 1);
