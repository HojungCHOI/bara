/**
 * 음성인식이 안 될 때 원인을 짚어 주는 진단 모듈.
 *
 * 아이패드에서 "아무것도 안 된다"고 할 때 원인이 여러 갈래라
 * 추측하지 않고 브라우저가 직접 확인하게 한다.
 */

/** iOS / iPadOS 인지 판별한다. 아이패드는 데스크톱 모드에서 Mac 으로 위장한다. */
export function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ 는 UA 가 Macintosh 로 나오므로 터치 지원으로 가려낸다.
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  // iOS 에서 크롬/파이어폭스/엣지는 겉모습만 다를 뿐 WebKit 을 쓰지만,
  // 음성인식 API 는 사파리에서만 열어 준다.
  const iosBrowser =
    /CriOS/.test(ua) ? 'Chrome'
    : /FxiOS/.test(ua) ? 'Firefox'
    : /EdgiOS/.test(ua) ? 'Edge'
    : /OPiOS|OPT\//.test(ua) ? 'Opera'
    : /naver|whale/i.test(ua) ? 'Whale/NAVER'
    : /KAKAOTALK|Instagram|FBAN|FBAV|Line/i.test(ua) ? '앱 내 브라우저'
    : 'Safari';

  const isDesktopSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua) && !isIOS;

  return { isIOS, iosBrowser, isDesktopSafari, userAgent: ua };
}

/** 마이크 장치에 실제로 접근할 수 있는지 확인한다. */
async function checkMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, detail: 'getUserMedia 를 지원하지 않는 브라우저입니다.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 확인만 하고 곧바로 끈다. 켜 둔 채로 두면 녹음 표시가 계속 뜬다.
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true, detail: '마이크 접근 허용됨' };
  } catch (err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError') {
      return { ok: false, detail: '마이크 권한이 거부되었습니다. 주소창 왼쪽 설정에서 허용해 주세요.' };
    }
    if (name === 'NotFoundError') {
      return { ok: false, detail: '마이크 장치를 찾지 못했습니다.' };
    }
    return { ok: false, detail: `마이크 오류: ${name || err?.message || '알 수 없음'}` };
  }
}

/**
 * 환경을 점검해 [{ id, label, ok, detail, fix }] 를 돌려준다.
 * ok 가 false 인 항목의 fix 가 해결 방법이다.
 */
export async function runDiagnostics() {
  const { isIOS, iosBrowser, userAgent } = detectPlatform();
  const hasAPI = 'SpeechRecognition' in globalThis || 'webkitSpeechRecognition' in globalThis;
  const checks = [];

  // 1. 보안 연결 — 이게 아니면 나머지가 다 무의미하다.
  const secure = globalThis.isSecureContext === true;
  const isFile = location.protocol === 'file:';
  checks.push({
    id: 'secure',
    label: '보안 연결(HTTPS)',
    ok: secure,
    detail: isFile ? 'file:// 로 열었습니다' : `${location.protocol}//${location.host || '(없음)'}`,
    fix: isFile
      ? 'index.html 을 더블클릭해서 열면 마이크가 동작하지 않습니다. 웹서버 주소(https://...)로 접속하거나, 개발 중이라면 npm start 후 http://localhost:8080 으로 여세요.'
      : 'http:// 대신 https:// 로 접속해야 마이크 권한을 받을 수 있습니다.',
  });

  // 2. 브라우저가 음성인식 API 를 가지고 있는가.
  checks.push({
    id: 'api',
    label: '음성인식 지원',
    ok: hasAPI,
    detail: hasAPI ? '사용 가능' : '이 브라우저에는 음성인식 기능이 없습니다',
    fix: isIOS && iosBrowser !== 'Safari'
      ? `아이패드·아이폰에서 음성인식이 되는 브라우저는 사파리뿐입니다. 지금은 ${iosBrowser} 에서 열려 있습니다. 주소를 복사해 사파리에서 여세요.`
      : '크롬, 엣지, 사파리에서 동작합니다. 파이어폭스는 음성인식을 지원하지 않습니다.',
  });

  // 3. iOS 에서 사파리가 아닌 경우는 위 항목이 통과해도 따로 짚어 준다.
  if (isIOS) {
    checks.push({
      id: 'ios-browser',
      label: '사파리로 열었는지',
      ok: iosBrowser === 'Safari',
      detail: iosBrowser === 'Safari' ? '사파리' : `${iosBrowser} 에서 열려 있습니다`,
      fix: '아이패드에서는 사파리만 음성인식을 지원합니다. 주소를 복사해 사파리에서 여세요.',
    });

    // iOS 는 "받아쓰기"가 꺼져 있으면 음성인식이 통째로 막힌다.
    checks.push({
      id: 'ios-dictation',
      label: '아이패드 받아쓰기 설정',
      ok: null, // 웹에서는 확인할 수 없다.
      detail: '브라우저에서는 확인할 수 없습니다. 직접 확인해 주세요.',
      fix: '설정 → 일반 → 키보드 → "받아쓰기 켬"이 켜져 있어야 합니다. 꺼져 있으면 음성인식이 전혀 동작하지 않습니다.',
    });
  }

  // 4. 마이크 자체에 접근되는가.
  const mic = await checkMicrophone();
  checks.push({
    id: 'mic',
    label: '마이크 접근',
    ok: mic.ok,
    detail: mic.detail,
    fix: isIOS
      ? '사파리 주소창 왼쪽의 «АА» → 웹사이트 설정 → 마이크 → 허용 으로 바꿔 주세요.'
      : '주소창 왼쪽 자물쇠 아이콘을 눌러 마이크를 "허용"으로 바꿔 주세요.',
  });

  // 5. 음성인식은 서버를 쓰므로 인터넷이 필요하다.
  checks.push({
    id: 'online',
    label: '인터넷 연결',
    ok: navigator.onLine !== false,
    detail: navigator.onLine === false ? '오프라인 상태입니다' : '연결됨',
    fix: '음성인식은 서버에서 처리되므로 인터넷 연결이 필요합니다.',
  });

  return { checks, platform: { isIOS, iosBrowser, userAgent } };
}
