'use strict';
// Take the network away from Node, then run the tool anyway.
//
// Used as `node --require scripts/netblock.cjs bin/emcard.js build`. A --require preload runs
// before the main module's graph is instantiated, so every builtin this file patches is already
// patched by the time src/ sees it.
//
// The point is the difference between two sentences:
//
//   "this tool makes no network requests"          a claim
//   "this tool produced byte-identical output with every outbound primitive throwing"   a test
//
// Only the second one is worth anything when the input file is a child's medication list. So
// scripts/verify.sh builds twice, once normally and once under this preload, and requires the
// two output trees to be identical. Any attempt to open a socket, resolve a name, fetch a URL
// or shell out to curl throws ENETBLOCK, which would change the exit code and the output.
//
// This file needs its own positive control, for the same reason the privacy scanner does: a
// netblock that patches nothing is silent in exactly the same way as a program that never calls
// out. scripts/netblock-probe.cjs is that control. It calls each primitive in turn under this
// preload and fails if any of them is still reachable.

const BLOCKED = [];

function forbid(what) {
  return function blocked() {
    BLOCKED.push(what);
    const err = new Error(
      `NETBLOCK: ${what} was called. emergency-info-card must not touch the network, and this `
      + 'process was started with the network taken away so that the claim is tested rather '
      + 'than asserted.');
    err.code = 'ENETBLOCK';
    throw err;
  };
}

/** Replace one property, and say so if it was not there to replace. */
function patch(object, name, what) {
  if (!object || typeof object[name] === 'undefined') return false;
  try {
    Object.defineProperty(object, name, {
      configurable: true,
      writable: true,
      enumerable: Object.prototype.propertyIsEnumerable.call(object, name),
      value: forbid(what)
    });
    return true;
  } catch {
    return false;
  }
}

const patched = [];
const record = (ok, label) => { if (ok) patched.push(label); };

// --- sockets ---------------------------------------------------------------------------
const net = require('node:net');
record(patch(net, 'connect', 'net.connect'), 'net.connect');
record(patch(net, 'createConnection', 'net.createConnection'), 'net.createConnection');
record(patch(net.Socket.prototype, 'connect', 'net.Socket.connect'), 'net.Socket.connect');
record(patch(net.Server.prototype, 'listen', 'net.Server.listen'), 'net.Server.listen');

const tls = require('node:tls');
record(patch(tls, 'connect', 'tls.connect'), 'tls.connect');
record(patch(tls, 'createServer', 'tls.createServer'), 'tls.createServer');

const dgram = require('node:dgram');
record(patch(dgram, 'createSocket', 'dgram.createSocket'), 'dgram.createSocket');

// --- name resolution -------------------------------------------------------------------
const dns = require('node:dns');
for (const name of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
  'resolveCname', 'resolveMx', 'resolveNs', 'resolveSrv', 'resolveTxt', 'reverse']) {
  record(patch(dns, name, `dns.${name}`), `dns.${name}`);
  record(patch(dns.promises, name, `dns.promises.${name}`), `dns.promises.${name}`);
}

// --- the http stack --------------------------------------------------------------------
for (const [mod, label] of [[require('node:http'), 'http'], [require('node:https'), 'https']]) {
  record(patch(mod, 'request', `${label}.request`), `${label}.request`);
  record(patch(mod, 'get', `${label}.get`), `${label}.get`);
  record(patch(mod, 'createServer', `${label}.createServer`), `${label}.createServer`);
}
try {
  const http2 = require('node:http2');
  record(patch(http2, 'connect', 'http2.connect'), 'http2.connect');
} catch {
  // http2 can be absent from a stripped build. Nothing to take away.
}

// --- the web-shaped globals --------------------------------------------------------------
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator']) {
  if (name === 'navigator') continue;
  record(patch(globalThis, name, name), name);
}

// --- shelling out ------------------------------------------------------------------------
// Blocking sockets and leaving `curl` reachable would be theatre. `emcard build` runs no
// subprocess at all, so the whole module goes. `emcard shoot` does run Chrome, which is why
// shoot is a separate verb and is never run under this preload.
const cp = require('node:child_process');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  record(patch(cp, name, `child_process.${name}`), `child_process.${name}`);
}

if (patched.length < 20) {
  process.stderr.write(`NETBLOCK IS NOT ARMED: only ${patched.length} primitives were replaced. `
    + 'Refusing to run, because a preload that patches nothing would let the build pass while '
    + 'proving nothing.\n');
  process.exit(3);
}

if (process.env.EMCARD_NETBLOCK_REPORT === '1') {
  process.stderr.write(`netblock armed: ${patched.length} primitives replaced\n`);
}

module.exports = { patched, BLOCKED };
