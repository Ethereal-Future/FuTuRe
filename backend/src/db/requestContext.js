import { AsyncLocalStorage } from 'async_hooks';

// Request-scoped context so database helpers can observe the originating
// HTTP request's abort signal without threading it through every call site.
const storage = new AsyncLocalStorage();

export class RequestAbortedError extends Error {
  constructor(message = 'Request aborted by client') {
    super(message);
    this.name = 'RequestAbortedError';
    this.code = 'REQUEST_ABORTED';
  }
}

export function runWithRequestContext(context, fn) {
  return storage.run(context, fn);
}

export function getRequestContext() {
  return storage.getStore();
}

export function getRequestSignal() {
  return storage.getStore()?.signal;
}

export function throwIfAborted(signal = getRequestSignal()) {
  if (signal?.aborted) throw new RequestAbortedError();
}

/**
 * Builds an AbortSignal that fires when the client disconnects before the
 * response has been fully sent.
 */
export function createRequestAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableFinished && !controller.signal.aborted) {
      controller.abort(new RequestAbortedError());
    }
  };
  req.on('aborted', abort);
  res.on('close', abort);
  return controller.signal;
}
