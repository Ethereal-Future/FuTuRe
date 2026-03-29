import { v4 as uuidv4 } from 'uuid';
import logger from '../config/logger.js';
import { getConfig } from '../config/env.js';

/**
 * Error codes for different error types
 */
export const ErrorCodes = {
  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  
  // Stellar-specific errors
  STELLAR_ERROR: 'STELLAR_ERROR',
  STELLAR_ACCOUNT_NOT_FOUND: 'STELLAR_ACCOUNT_NOT_FOUND',
  STELLAR_INSUFFICIENT_BALANCE: 'STELLAR_INSUFFICIENT_BALANCE',
  STELLAR_INVALID_ADDRESS: 'STELLAR_INVALID_ADDRESS',
  STELLAR_TRANSACTION_FAILED: 'STELLAR_TRANSACTION_FAILED',
  STELLAR_NETWORK_ERROR: 'STELLAR_NETWORK_ERROR',
  STELLAR_TIMEOUT: 'STELLAR_TIMEOUT',
  
  // Database errors
  DATABASE_ERROR: 'DATABASE_ERROR',
  DATABASE_CONSTRAINT: 'DATABASE_CONSTRAINT',
  
  // Auth errors
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  
  // Validation errors
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
};

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = ErrorCodes.INTERNAL_ERROR, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

/**
 * Stellar-specific error class
 */
export class StellarError extends AppError {
  constructor(message, stellarError = null) {
    super(message, 500, ErrorCodes.STELLAR_ERROR);
    this.name = 'StellarError';
    this.stellarError = stellarError;
    
    // Parse Stellar SDK errors
    if (stellarError) {
      this.parseStellarError(stellarError);
    }
  }

  parseStellarError(error) {
    // Handle Stellar SDK specific error types
    if (error.response?.data?.extras) {
      const extras = error.response.data.extras;
      
      if (extras.result_codes?.transaction === 'tx_failed') {
        this.code = ErrorCodes.STELLAR_TRANSACTION_FAILED;
        this.statusCode = 400;
        this.details = {
          transactionCode: extras.result_codes.transaction,
          operationCodes: extras.result_codes.operations,
          resultXdr: extras.result_xdr,
        };
      } else if (extras.result_codes?.transaction === 'tx_bad_seq') {
        this.code = ErrorCodes.STELLAR_TRANSACTION_FAILED;
        this.statusCode = 409;
        this.details = {
          transactionCode: extras.result_codes.transaction,
          message: 'Transaction sequence number is incorrect',
        };
      }
    } else if (error.response?.status === 404) {
      this.code = ErrorCodes.STELLAR_ACCOUNT_NOT_FOUND;
      this.statusCode = 404;
    } else if (error.response?.status === 400) {
      this.code = ErrorCodes.STELLAR_INVALID_ADDRESS;
      this.statusCode = 400;
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      this.code = ErrorCodes.STELLAR_NETWORK_ERROR;
      this.statusCode = 503;
    }
  }
}

/**
 * Validation error class
 */
export class ValidationError extends AppError {
  constructor(message, field = null, value = null) {
    super(message, 422, ErrorCodes.VALIDATION_ERROR);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.details = { field, value };
  }
}

/**
 * Generate request ID for tracking
 */
export function generateRequestId() {
  return uuidv4();
}

/**
 * Request ID middleware
 */
export function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || generateRequestId();
  res.setHeader('X-Request-ID', req.id);
  next();
}

/**
 * Error logging middleware
 */
export function errorLogger(err, req, res, next) {
  const requestId = req.id || 'unknown';
  const method = req.method;
  const url = req.originalUrl || req.url;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'];
  
  const logContext = {
    requestId,
    method,
    url,
    ip,
    userAgent,
    statusCode: err.statusCode || 500,
    errorCode: err.code || ErrorCodes.INTERNAL_ERROR,
  };

  // Log based on error severity
  if (err.statusCode >= 500) {
    logger.error('Server error', {
      ...logContext,
      error: err.message,
      stack: err.stack,
      details: err.details,
    });
  } else if (err.statusCode >= 400) {
    logger.warn('Client error', {
      ...logContext,
      error: err.message,
      details: err.details,
    });
  } else {
    logger.info('Error', {
      ...logContext,
      error: err.message,
    });
  }

  next(err);
}

/**
 * Format error response
 */
function formatErrorResponse(err, req) {
  const requestId = req.id || 'unknown';
  const isProduction = getConfig().meta.appEnv === 'production';
  
  const response = {
    success: false,
    error: {
      code: err.code || ErrorCodes.INTERNAL_ERROR,
      message: err.message || 'An unexpected error occurred',
      requestId,
    },
  };

  // Add details in non-production environments
  if (!isProduction && err.details) {
    response.error.details = err.details;
  }

  // Add stack trace in development
  if (!isProduction && err.stack) {
    response.error.stack = err.stack;
  }

  return response;
}

/**
 * Centralized error handling middleware
 */
export function errorHandler(err, req, res, next) {
  // If response was already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  // Default error values
  let statusCode = err.statusCode || 500;
  let code = err.code || ErrorCodes.INTERNAL_ERROR;
  let message = err.message || 'An unexpected error occurred';

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 422;
    code = ErrorCodes.VALIDATION_INVALID_INPUT;
  } else if (err.name === 'StellarError') {
    statusCode = err.statusCode || 500;
    code = err.code || ErrorCodes.STELLAR_ERROR;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = ErrorCodes.AUTH_INVALID_TOKEN;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = ErrorCodes.AUTH_TOKEN_EXPIRED;
    message = 'Token expired';
  } else if (err.code === '23505') { // PostgreSQL unique constraint violation
    statusCode = 409;
    code = ErrorCodes.DATABASE_CONSTRAINT;
    message = 'Resource already exists';
  } else if (err.code === '23503') { // PostgreSQL foreign key constraint violation
    statusCode = 400;
    code = ErrorCodes.DATABASE_CONSTRAINT;
    message = 'Referenced resource does not exist';
  }

  // Handle rate limiting errors
  if (statusCode === 429) {
    code = ErrorCodes.RATE_LIMITED;
    message = err.message || 'Too many requests, please try again later';
  }

  // Create error response
  const errorResponse = formatErrorResponse({
    ...err,
    statusCode,
    code,
    message,
  }, req);

  // Send response
  res.status(statusCode).json(errorResponse);
}

/**
 * 404 handler for undefined routes
 */
export function notFoundHandler(req, res, next) {
  const error = new AppError(
    `Route not found: ${req.method} ${req.originalUrl || req.url}`,
    404,
    ErrorCodes.NOT_FOUND
  );
  next(error);
}

/**
 * Async error wrapper for route handlers
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create error with request context
 */
export function createError(message, statusCode = 500, code = ErrorCodes.INTERNAL_ERROR, details = null) {
  return new AppError(message, statusCode, code, details);
}

/**
 * Create validation error
 */
export function createValidationError(message, field = null, value = null) {
  return new ValidationError(message, field, value);
}

/**
 * Create Stellar error
 */
export function createStellarError(message, stellarError = null) {
  return new StellarError(message, stellarError);
}

export default {
  AppError,
  StellarError,
  ValidationError,
  ErrorCodes,
  requestIdMiddleware,
  errorLogger,
  errorHandler,
  notFoundHandler,
  asyncHandler,
  createError,
  createValidationError,
  createStellarError,
  generateRequestId,
};
