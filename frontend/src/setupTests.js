import '@testing-library/jest-dom';

// jsdom's crypto polyfill does not implement SubtleCrypto — swap in Node's
// WebCrypto so code under test using crypto.subtle (e.g. backup encryption) works.
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}
