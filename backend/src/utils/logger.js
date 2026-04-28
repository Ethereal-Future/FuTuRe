const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function formatMessage(level, message, meta = {}) {
  return JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...meta,
  });
}

function info(message, meta) {
  if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'info') {
    console.log(formatMessage('info', message, meta));
  }
}

function warn(message, meta) {
  if (LOG_LEVEL !== 'error') {
    console.warn(formatMessage('warn', message, meta));
  }
}

function error(message, meta) {
  console.error(formatMessage('error', message, meta));
}

function debug(message, meta) {
  if (LOG_LEVEL === 'debug') {
    console.log(formatMessage('debug', message, meta));
  }
}

function child(bindings) {
  return {
    info: (meta, msg) => info(msg, { ...bindings, ...meta }),
    warn: (meta, msg) => warn(msg, { ...bindings, ...meta }),
    error: (meta, msg) => error(msg, { ...bindings, ...meta }),
    debug: (meta, msg) => debug(msg, { ...bindings, ...meta }),
  };
}

export const logger = {
  info,
  warn,
  error,
  debug,
  child,
};

export default logger;
