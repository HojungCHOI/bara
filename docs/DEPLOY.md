# 배포 방법

빌드 도구가 없는 정적 사이트라서, 파일을 그대로 올리면 끝납니다.

목표 주소: **`https://signes.kr/app/biblehelper/`**

## 1. 올릴 파일 추리기

```bash
npm run dist
```

`dist/` 폴더가 만들어집니다. 실제 서비스에 필요한 15개 파일만 들어 있고,
테스트·문서·깃 관련 파일은 빠집니다.

## 2. FTP/SFTP로 올리기

`dist/` **폴더 자체가 아니라, 그 안의 파일들을** 서버의
`/app/biblehelper/` 아래로 올립니다.

올린 뒤 서버 구조는 이렇게 되어야 합니다.

```
/app/biblehelper/
├── index.html
├── manifest.webmanifest
├── icon.svg
├── css/style.css
├── js/            (7개 파일)
├── data/          (3개 파일)
└── docs/DATA.md
```

`index.html`이 `/app/biblehelper/index.html` 위치에 있어야
`https://signes.kr/app/biblehelper/` 로 열립니다.

## 3. 확인할 것

- [ ] `https://signes.kr/app/biblehelper/` 접속 시 화면이 뜬다
- [ ] **HTTPS로 열린다** — http로 열면 마이크 권한이 아예 안 나옵니다
- [ ] 마이크 버튼을 누르면 권한 요청이 뜬다
- [ ] "요한복음 3장 16절"을 입력 칸에 쳤을 때 결과가 나온다

## 왜 하위 경로에서도 되나

모든 경로가 상대경로(`./css/style.css`)로 되어 있고,
JS에서 데이터를 읽을 때도 `import.meta.url` 기준으로 찾습니다.
그래서 `/app/biblehelper/` 처럼 하위 폴더에 두어도 그대로 동작합니다.

**앞으로 코드를 고칠 때 `/css/style.css` 처럼 슬래시로 시작하는
절대경로를 쓰면 배포 후 깨집니다.** 반드시 `./` 로 시작하세요.

## 메인페이지에 링크 걸기

[`docs/메인페이지-링크.html`](메인페이지-링크.html) 에 붙여넣을 코드가
세 가지 모양으로 들어 있습니다. 단순 링크 / 카드 / 목록 중 골라 쓰세요.

## MIME 타입 문제가 생기면

`.webmanifest` 확장자를 모르는 서버가 있습니다.
매니페스트가 안 읽힌다는 오류가 나면 `.htaccess`에 아래를 추가하세요.
(앱 동작 자체에는 지장이 없고, 홈 화면 추가 기능에만 영향을 줍니다.)

```apache
AddType application/manifest+json .webmanifest
AddType image/svg+xml .svg
```
