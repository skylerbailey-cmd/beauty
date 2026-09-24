'use strict';

// Keeping one bad request from taking the shops offline.
//
// Express 4 does not catch a rejected promise returned by an `async` route
// handler. The rejection escapes to the process, and Node ends the process
// over it — so a single malformed request logs everyone out of both registers
// mid-trade. It is not hypothetical: a line item that reached Postgres with no
// unit_price failed its insert and the server exited on the spot.
//
// Most handlers here are async and most have no try/catch. Rather than add one
// to each — and rely on remembering it in every handler written after this —
// every handler on a mounted router is wrapped so a rejection is handed to
// `next()`. Express's error handler then answers 500 and the server stays up.

function wrapHandler(fn) {
  if (typeof fn !== 'function') return fn;

  // Express tells error middleware from ordinary middleware by counting
  // arguments, so each shape has to keep its own.
  if (fn.length === 4) {
    return function hardenedErrorHandler(err, req, res, next) {
      try {
        return Promise.resolve(fn(err, req, res, next)).catch(next);
      } catch (e) {
        return next(e);
      }
    };
  }

  return function hardenedHandler(req, res, next) {
    try {
      return Promise.resolve(fn(req, res, next)).catch(next);
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Wrap every handler already registered on a router, in place.
 *
 * Called on each router as it is mounted, which is after its routes are
 * defined — so this walks what is there rather than intercepting `.get`/`.post`
 * as they are called.
 */
function hardenRouter(router) {
  for (const layer of router?.stack || []) {
    if (layer.route) {
      // A path with one or more handlers behind it.
      for (const entry of layer.route.stack) entry.handle = wrapHandler(entry.handle);
    } else if (typeof layer.handle === 'function' && layer.handle.stack) {
      // A router mounted inside this one — recurse rather than wrap it, or the
      // sub-router would stop dispatching.
      hardenRouter(layer.handle);
    } else {
      // Plain middleware: auth checks, body parsers, the legacy data bridge.
      layer.handle = wrapHandler(layer.handle);
    }
  }
  return router;
}

module.exports = { hardenRouter, wrapHandler };
