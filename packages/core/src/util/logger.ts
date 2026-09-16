export interface Logger {
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child?(bindings: object): Logger;
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function consoleLogger(prefix = 'core'): Logger {
  const fmt = (level: string, obj: object | string, msg?: string) => {
    const text = typeof obj === 'string' ? obj : (msg ?? '');
    const data = typeof obj === 'string' ? '' : ` ${JSON.stringify(obj)}`;
    return `[${prefix}] ${level} ${text}${data}`;
  };
  return {
    debug: (o, m) => console.debug(fmt('debug', o, m)),
    info: (o, m) => console.info(fmt('info', o, m)),
    warn: (o, m) => console.warn(fmt('warn', o, m)),
    error: (o, m) => console.error(fmt('error', o, m)),
  };
}
