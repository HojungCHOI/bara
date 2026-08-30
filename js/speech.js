/**
 * Web Speech API 래퍼.
 *
 * iOS/iPadOS 사파리는 continuous 모드를 오래 유지하지 못하고 스스로 끊는다.
 * 예배 중에는 계속 듣고 있어야 하므로, 끊기면 자동으로 다시 시작한다.
 */

const SpeechRecognitionCtor =
  globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

/** 이 브라우저가 음성인식을 지원하는지 확인한다. */
export function isSpeechSupported() {
  return SpeechRecognitionCtor !== null;
}

export class SpeechListener {
  /**
   * @param {object} options
   * @param {string} options.lang            인식 언어 (기본 ko-KR)
   * @param {(text:string)=>void} options.onFinal    최종 인식 결과
   * @param {(text:string)=>void} options.onInterim  중간 인식 결과
   * @param {(state:string)=>void} options.onState   'listening' | 'stopped'
   * @param {(message:string, fatal:boolean)=>void} options.onError
   */
  constructor({ lang = 'ko-KR', onFinal, onInterim, onState, onError } = {}) {
    this.lang = lang;
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});

    this.recognition = null;
    /** 사용자가 "듣기"를 켜 둔 상태인지. 자동 재시작 여부를 결정한다. */
    this.wantsToListen = false;
    this.restartTimer = null;
    this.restartDelay = 300;
  }

  start() {
    if (!SpeechRecognitionCtor) {
      this.onError('이 브라우저는 음성인식을 지원하지 않습니다.', true);
      return;
    }
    this.wantsToListen = true;
    this._createAndStart();
  }

  stop() {
    this.wantsToListen = false;
    clearTimeout(this.restartTimer);
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

  _createAndStart() {
    // 매번 새 인스턴스를 만든다. 재사용하면 사파리에서 상태가 꼬인다.
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
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
      if (code === 'no-speech' || code === 'aborted') {
        // 정상적인 흐름. 자동 재시작에 맡긴다.
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.wantsToListen = false;
        this.onError('마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.', true);
        this.onState('stopped');
        return;
      }
      if (code === 'network') {
        this.onError('네트워크 오류로 음성인식이 끊겼습니다. 다시 연결합니다.', false);
        return;
      }
      this.onError(`음성인식 오류: ${code}`, false);
    };

    recognition.onend = () => {
      if (!this.wantsToListen) {
        this.onState('stopped');
        return;
      }
      // 사파리가 임의로 끊은 경우 -> 곧바로 다시 켠다.
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (this.wantsToListen) this._createAndStart();
      }, this.restartDelay);
    };

    try {
      recognition.start();
      this.recognition = recognition;
      this.onState('listening');
    } catch (err) {
      // 이전 인스턴스가 아직 살아있으면 InvalidStateError 가 난다. 잠시 후 재시도.
      clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        if (this.wantsToListen) this._createAndStart();
      }, 500);
    }
  }
}
