/**
 * Web Speech API 래퍼.
 *
 * iOS/iPadOS 사파리는 여러 가지로 까다롭다.
 *  - continuous 모드를 제대로 지원하지 않아 한 마디마다 스스로 끊는다.
 *  - 받아쓰기 설정이 꺼져 있으면 오류도 없이 조용히 끝나 버린다.
 *  - 사파리가 아닌 브라우저(크롬 등)에는 API 자체가 없다.
 * 그래서 끊기면 다시 켜고, 조용히 실패하는 경우를 감지해 알려 준다.
 */

import { detectPlatform } from './diagnose.js?v=ff3265f';

const SpeechRecognitionCtor =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

/** 이 브라우저가 음성인식을 지원하는지 확인한다. */
export function isSpeechSupported() {
  return SpeechRecognitionCtor !== null;
}

/** 결과 한 번 없이 이만큼 연속으로 끊기면 설정 문제로 본다. */
const SILENT_FAILURE_THRESHOLD = 3;

/** 이만큼 아무 소식이 없으면 죽은 것으로 보고 되살린다. */
export const STALE_MS = 9000;

/** 감시 주기. */
const WATCHDOG_MS = 3000;

/** 되살리기를 이만큼 반복해도 결과가 없으면 사람이 눌러 줘야 한다. */
const REVIVE_GIVEUP = 3;

/**
 * 지금 음성인식을 강제로 되살려야 하는지 판단한다.
 *
 * 사파리는 시간이 지나면 인식을 조용히 끝내 버리는데, 이때 onend 가
 * 불리지 않는 경우가 있다. 그러면 자동 재시작이 걸리지 않아 영영 멈춘다.
 * 마지막 소식 이후 흐른 시간으로 이를 가려낸다.
 */
export function shouldRevive({ listening, now, lastEventAt, staleMs = STALE_MS }) {
  if (!listening) return false;
  if (!lastEventAt) return false;
  return now - lastEventAt >= staleMs;
}

/** 이 시간 안에 끝나면 "말을 듣지도 못하고 끝났다"고 본다. */
const TOO_FAST_MS = 1200;

export class SpeechListener {
  /**
   * @param {object} options
   * @param {string} options.lang            인식 언어 (기본 ko-KR)
   * @param {(text:string)=>void} options.onFinal    최종 인식 결과
   * @param {(text:string)=>void} options.onInterim  중간 인식 결과
   * @param {(state:string)=>void} options.onState   'listening' | 'stopped'
   * @param {(message:string, fatal:boolean)=>void} options.onError
   */
  constructor({ lang = 'ko-KR', onFinal, onInterim, onState, onError, onStats, onStalled } = {}) {
    this.lang = lang;
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.onStats = onStats || (() => {});
    this.onStalled = onStalled || (() => {});

    this.platform = detectPlatform();
    this.recognition = null;
    /** 사용자가 "듣기"를 켜 둔 상태인지. 자동 재시작 여부를 결정한다. */
    this.wantsToListen = false;
    this.restartTimer = null;

    /** 한 번이라도 인식 결과를 받았는지. 조용한 실패를 가려내는 데 쓴다. */
    this.sawAnyResult = false;
    this.emptyEndCount = 0;
    this.startedAt = 0;
    this.lastErrorCode = null;

    // 실제 기기에서 무엇이 일어나는지 확인하기 위한 집계.
    // 기기가 손에 없으면 이 숫자가 유일한 단서다.
    this.stats = { starts: 0, results: 0, errors: 0, lastError: null, revives: 0 };

    /** 마지막으로 무슨 일이든 일어난 시각. 멈춤 감지의 기준이다. */
    this.lastEventAt = 0;
    this.watchdogTimer = null;
    /** 되살렸는데도 결과가 없던 횟수. */
    this.revivesWithoutResult = 0;
  }

  /** 무슨 일이든 일어났음을 기록한다. */
  _touch() {
    this.lastEventAt = Date.now();
  }

  /** 멈췄는지 주기적으로 살핀다. onend 가 안 불리는 경우를 잡기 위함이다. */
  _startWatchdog() {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.wantsToListen) return;
      if (!shouldRevive({
        listening: this.wantsToListen,
        now: Date.now(),
        lastEventAt: this.lastEventAt,
      })) return;

      this.stats.revives += 1;
      this.revivesWithoutResult += 1;
      this._emitStats();

      // 되살리기를 먼저 하고 알린다. 순서가 반대면 되살리며 나오는
      // '듣고 있습니다' 안내가 멈춤 안내를 덮어써 버린다.
      this._forceRestart();

      if (this.revivesWithoutResult >= REVIVE_GIVEUP) {
        // 자동으로는 되살아나지 않는다. 사파리는 사용자가 직접 눌러야
        // 다시 열어 주는 경우가 있어서, 여기서부터는 사람 손이 필요하다.
        this.onStalled();
      }
    }, WATCHDOG_MS);
  }

  _stopWatchdog() {
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /** 기존 인식을 버리고 새로 연다. */
  _forceRestart() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* 이미 죽었으면 무시 */ }
      this.recognition = null;
    }
    this._touch();
    this._createAndStart();
  }

  /** 화면이 다시 켜졌을 때처럼 밖에서 되살리고 싶을 때 부른다. */
  revive() {
    if (!this.wantsToListen) return;
    this._forceRestart();
  }

  _emitStats() {
    this.onStats({ ...this.stats, listening: this.wantsToListen });
  }

  start() {
    if (!SpeechRecognitionCtor) {
      const { isIOS, iosBrowser } = this.platform;
      this.onError(
        isIOS && iosBrowser !== 'Safari'
          ? `아이패드에서 음성인식이 되는 브라우저는 사파리뿐입니다. 지금은 ${iosBrowser} 에서 열려 있습니다. 사파리에서 열어 주세요.`
          : '이 브라우저는 음성인식을 지원하지 않습니다. 크롬, 엣지, 사파리를 써 주세요.',
        true,
      );
      return;
    }
    this.wantsToListen = true;
    this.sawAnyResult = false;
    this.emptyEndCount = 0;
    this.lastErrorCode = null;
    this.revivesWithoutResult = 0;
    this._touch();
    this._createAndStart();
    this._startWatchdog();
  }

  stop() {
    this.wantsToListen = false;
    clearTimeout(this.restartTimer);
    this._stopWatchdog();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* 이미 멈춘 경우 무시 */
      }
    }
    this.onState('stopped');
  }

  toggle() {
    if (this.wantsToListen) this.stop();
    else this.start();
  }

  _scheduleRestart(delay) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.wantsToListen) this._createAndStart();
    }, delay);
  }

  _createAndStart() {
    // 매번 새 인스턴스를 만든다. 재사용하면 사파리에서 상태가 꼬인다.
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = this.lang;
    // iOS 에서도 continuous 를 켠다.
    // 꺼 두면 한 마디마다 인식이 끝나고 다시 켜야 하는데, 사파리는 그 재시작에
    // 0.5~1초가 걸린다. 예배처럼 말이 이어지는 자리에서는 그 틈에 들어온 말이
    // 통째로 사라져서 "잡히다 안 잡히다" 하게 된다.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      this.sawAnyResult = true;
      this.revivesWithoutResult = 0;
      this._touch();
      this.stats.results += 1;
      this._emitStats();
      this.emptyEndCount = 0;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          const text = transcript.trim();
          if (text) this.onFinal(text);
        } else {
          interim += transcript;
        }
      }
      if (interim.trim()) this.onInterim(interim.trim());
    };

    recognition.onerror = (event) => {
      const code = event.error;
      this._touch();
      this.lastErrorCode = code;
      this.stats.errors += 1;
      this.stats.lastError = code;
      this._emitStats();

      if (code === 'no-speech' || code === 'aborted') {
        // 말이 없었을 뿐이다. 자동 재시작에 맡긴다.
        return;
      }
      if (code === 'not-allowed') {
        this.wantsToListen = false;
        this.onError(
          this.platform.isIOS
            ? '마이크 권한이 거부되었습니다. 주소창의 «АА» → 웹사이트 설정 → 마이크 → 허용 으로 바꿔 주세요.'
            : '마이크 권한이 거부되었습니다. 주소창 왼쪽 자물쇠를 눌러 허용해 주세요.',
          true,
        );
        this.onState('stopped');
        return;
      }
      if (code === 'service-not-allowed') {
        this.wantsToListen = false;
        this.onError(
          this.platform.isIOS
            ? '아이패드의 받아쓰기가 꺼져 있습니다. 설정 → 일반 → 키보드 → "받아쓰기 켬"을 켜 주세요.'
            : '음성인식 서비스를 쓸 수 없습니다. 브라우저 설정에서 음성 기능이 꺼져 있는지 확인해 주세요.',
          true,
        );
        this.onState('stopped');
        return;
      }
      if (code === 'network') {
        this.onError('네트워크 오류입니다. 음성인식은 인터넷이 필요합니다. 다시 연결합니다.', false);
        return;
      }
      if (code === 'audio-capture') {
        this.wantsToListen = false;
        this.onError('마이크를 찾지 못했습니다. 다른 앱이 마이크를 쓰고 있는지 확인해 주세요.', true);
        this.onState('stopped');
        return;
      }
      this.onError(`음성인식 오류: ${code}`, false);
    };

    recognition.onend = () => {
      this._touch();
      if (!this.wantsToListen) {
        this.onState('stopped');
        return;
      }

      const elapsed = Date.now() - this.startedAt;

      // 결과도 오류도 없이 곧바로 끝나는 일이 반복되면 설정 문제일 가능성이 높다.
      // 아이패드에서 받아쓰기가 꺼져 있을 때 이렇게 조용히 실패한다.
      if (!this.sawAnyResult && elapsed < TOO_FAST_MS && !this.lastErrorCode) {
        this.emptyEndCount += 1;
        if (this.emptyEndCount === SILENT_FAILURE_THRESHOLD) {
          this.onError(
            this.platform.isIOS
              ? '마이크가 열리지 않는 것 같습니다. 설정 → 일반 → 키보드 → "받아쓰기 켬"이 켜져 있는지 확인해 주세요. (설정 화면의 "진단하기"를 눌러 보세요)'
              : '음성인식이 바로 끊깁니다. 설정 화면의 "진단하기"를 눌러 원인을 확인해 주세요.',
            false,
          );
        }
        // 빠르게 반복 재시작하면 배터리만 먹는다. 간격을 벌린다.
        this._scheduleRestart(Math.min(1500, 300 * this.emptyEndCount));
        return;
      }

      this._scheduleRestart(80);
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.startedAt = Date.now();
      this._touch();
      this.stats.starts += 1;
      this._emitStats();
      this.onState('listening');
    } catch {
      // 이전 인스턴스가 아직 살아 있으면 InvalidStateError 가 난다. 잠시 후 재시도.
      this._scheduleRestart(500);
    }
  }
}
