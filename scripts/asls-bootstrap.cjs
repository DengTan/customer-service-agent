// Must be loaded with `node --require ./scripts/asls-bootstrap.cjs` BEFORE any
// Next.js modules are required. Next.js 16 calls into AsyncLocalStorage inside
// its `app-render/async-local-storage` shim; when the file is loaded through
// the `tsx` esbuild loader on Node 22 the internal `SharedAsyncLocalStorage`
// instance is undefined and Next.js throws the
// `AsyncLocalStorage accessed in runtime where it is not available` invariant.
//
// Exposing AsyncLocalStorage on globalThis before Next.js is required makes
// the invariant check pass regardless of loader ordering.

const { AsyncLocalStorage } = require('node:async_hooks');

if (typeof globalThis.AsyncLocalStorage !== 'function') {
  Object.defineProperty(globalThis, 'AsyncLocalStorage', {
    configurable: true,
    writable: true,
    value: AsyncLocalStorage,
  });
}
