/**
 * 의존성 없는 개발용 정적 서버.  실행: npm start
 *
 * 윈도우/맥/리눅스 어디서나 node 만 있으면 돌아간다.
 * 음성인식은 보안 컨텍스트를 요구하므로 localhost 로 접속해야 한다.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  // 프로젝트 밖으로 빠져나가는 경로 요청을 막는다.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n  바라 개발 서버가 켜졌습니다.`);
  console.log(`  브라우저에서 열기:  http://localhost:${PORT}\n`);
  console.log(`  (마이크는 localhost 또는 HTTPS 에서만 동작합니다)`);
  console.log(`  끄려면 Ctrl+C\n`);
});
