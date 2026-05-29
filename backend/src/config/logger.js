import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { sanitizeLogData } from '../utils/sanitizeLogData.js';

const { combine, timestamp, json, colorize, simple, errors } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

// Custom format to sanitize sensitive data
const sanitizeFormat = winston.format((info) => {
  if (info.message && typeof info.message === 'object') {
    info.message = sanitizeLogData(info.message);
  }
  if (info.meta && typeof info.meta === 'object') {
    info.meta = sanitizeLogData(info.meta);
  }
  // Sanitize all properties except standard winston fields
  const standardFields = ['level', 'message', 'timestamp', 'label', 'meta'];
  for (const key of Object.keys(info)) {
    if (!standardFields.includes(key) && typeof info[key] === 'object') {
      info[key] = sanitizeLogData(info[key]);
    }
  }
  return info;
});

const fileTransport = new DailyRotateFile({
  dirname: 'logs',
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  maxSize: '20m',
  format: combine(sanitizeFormat(), timestamp(), errors({ stack: true }), json()),
});

const errorFileTransport = new DailyRotateFile({
  dirname: 'logs',
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  maxFiles: '30d',
  maxSize: '20m',
  format: combine(sanitizeFormat(), timestamp(), errors({ stack: true }), json()),
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    fileTransport,
    errorFileTransport,
    new winston.transports.Console({
      format: isProduction
        ? combine(sanitizeFormat(), timestamp(), errors({ stack: true }), json())
        : combine(sanitizeFormat(), colorize(), simple()),
    }),
  ],
});

export default logger;
