/**
 * FTP/SFTP로 올릴 파일만 dist/ 에 모은다.  실행: npm run dist
 *
 * 만들어진 dist/ "안의" 파일들을 서버의 /app/biblehelper/ 에 올리면 된다.
 * (dist 폴더 자체가 아니라 그 안의 내용)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

/** 서비스에 실제로 필요한 것만 올린다. */
const FILES = ['index.html', 'manifest.webmanifest', 'icon.svg'];
const DIRS = ['css', 'js', 'data'];
const EXTRA = [['docs/DATA.md', 'docs/DATA.md']];

/** 사용자가 넣은 개인 데이터는 절대 배포에 섞이면 안 된다. */
const NEVER_COPY = new Set(['hymns.json', 'bible.json']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (NEVER_COPY.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const file of FILES) {
  fs.copyFileSync(path.join(ROOT, file), path.join(DIST, file));
}
for (const dir of DIRS) {
  copyDir(path.join(ROOT, dir), path.join(DIST, dir));
}
for (const [from, to] of EXTRA) {
  const dst = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), dst);
}

/* ── 캐시 무력화 ──────────────────────────────────────────────
   사파리는 CSS 와 JS 를 오래 붙들고 있어서, 고쳐 배포해도 예전 화면이
   그대로 보이는 일이 잦다. 파일 주소 뒤에 배포마다 달라지는 표식을 붙여
   브라우저가 다른 파일로 인식하게 만든다. */

/** 배포마다 달라지는 표식. CI 에서는 커밋 해시, 로컬에서는 시각. */
const STAMP = (process.env.GITHUB_SHA || '').slice(0, 7)
  || new Date().toISOString().replace(/\D/g, '').slice(0, 14);

function stampAssets() {
  // index.html 의 stylesheet 와 module script 주소에 표식을 붙인다.
  const indexPath = path.join(DIST, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html
    .replace(/(href=")(\.\/css\/[^"?]+)(")/g, `$1$2?v=${STAMP}$3`)
    .replace(/(src=")(\.\/js\/[^"?]+)(")/g, `$1$2?v=${STAMP}$3`)
    // 어느 판인지 화면에서 확인할 수 있게 남긴다.
    .replace('</head>', `<meta name="bara-version" content="${STAMP}">\n</head>`);
  fs.writeFileSync(indexPath, html);

  // app.js 주소만 바꾸면 그 안에서 불러오는 모듈은 여전히 옛것이 쓰인다.
  // 모듈끼리 서로 부르는 주소에도 같은 표식을 붙여야 전부 새로 받는다.
  const jsDir = path.join(DIST, 'js');
  for (const name of fs.readdirSync(jsDir)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(jsDir, name);
    const code = fs.readFileSync(file, 'utf8')
      .replace(/(from\s+['"])(\.\/[^'"?]+\.js)(['"])/g, `$1$2?v=${STAMP}$3`);
    fs.writeFileSync(file, code);
  }
}

stampAssets();

/** dist 안의 모든 파일을 나열한다. */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(DIST).sort();
const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);

console.log('\ndist/ 준비 완료:');
for (const f of files) {
  console.log('  dist' + path.relative(DIST, f).split(path.sep).join('/').padStart(0).replace(/^/, '/'));
}
console.log(`\n총 ${files.length}개 파일, ${(bytes / 1024).toFixed(0)}KB · 판 ${STAMP}`);
console.log("\n이제 dist/ '안의' 파일들을 서버의 /app/biblehelper/ 에 올리세요.\n");
