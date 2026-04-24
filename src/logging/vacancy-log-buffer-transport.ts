import type { TransformableInfo } from 'logform';
import { MESSAGE } from 'triple-beam';
import Transport from 'winston-transport';

/** Cap growth if a single vacancy logs excessively; drop oldest lines first. */
const MAX_BUFFER_LINES = 500;

type CaptureState = {
  active: boolean;
  lines: string[];
};

class VacancyLogBufferTransport extends Transport {
  constructor(private readonly state: CaptureState) {
    super();
  }

  override log(info: TransformableInfo, callback: () => void): void {
    // Buffer synchronously so callers can takeAndClear() in the same tick (e.g. try/finally).
    if (!this.silent && this.state.active) {
      const line =
        typeof info[MESSAGE] === 'string'
          ? info[MESSAGE]
          : `${info.level}: ${String(info.message)}`;
      while (this.state.lines.length >= MAX_BUFFER_LINES) {
        this.state.lines.shift();
      }
      this.state.lines.push(line);
    }
    setImmediate(() => {
      this.emit('logged', info);
      callback();
    });
  }
}

export type VacancyLogCapture = {
  transport: VacancyLogBufferTransport;
  begin: () => void;
  takeAndClear: () => string;
};

export function createVacancyLogCapture(): VacancyLogCapture {
  const state: CaptureState = { active: false, lines: [] };
  const transport = new VacancyLogBufferTransport(state);

  return {
    transport,
    begin(): void {
      state.lines.length = 0;
      state.active = true;
    },
    takeAndClear(): string {
      const text = state.lines.join('\n');
      state.lines.length = 0;
      state.active = false;
      return text;
    },
  };
}
