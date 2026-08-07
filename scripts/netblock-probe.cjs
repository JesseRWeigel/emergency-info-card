'use strict';
// The positive control for scripts/netblock.cjs.
//
// Run as `node --require scripts/netblock.cjs scripts/netblock-probe.cjs`. It tries every
// outbound primitive the netblock claims to have taken away and requires each one to throw
// ENETBLOCK. Exit 0 means the netblock is armed. Exit 1 means something is still reachable and
// the byte-identical-output test in verify.sh proves nothing.
//
// Without this control the netblock could be an empty file: the build would still produce
// identical output, verify.sh would still pass, and the "sends nothing" claim would rest on a
// no-op. A scanner that reads nothing is silent in exactly the same way as a clean tree.
//
// Nothing here is allowed to actually reach the network. Every call is either to a documented
// unroutable address (TEST-NET-1, 192.0.2.0/24, RFC 5737) or to a name under .invalid
// (RFC 2606), so a probe run on a machine where the netblock has been removed fails to connect
// rather than succeeding in contacting anything.

const UNROUTABLE_IP = '192.0.2.1';
const UNRESOLVABLE_HOST = 'emergency-info-card.invalid';

const attempts = [];

function attempt(what, fn) {
  let outcome;
  try {
    const value = fn();
    // A promise that rejects with ENETBLOCK is not good enough. `forbid` throws
    // synchronously, so anything that returns is a primitive that was not replaced.
    if (value && typeof value.then === 'function') value.catch(() => {});
    outcome = { what, blocked: false, detail: 'returned without throwing' };
  } catch (err) {
    outcome = {
      what,
      blocked: err && err.code === 'ENETBLOCK',
      detail: err && err.code ? `${err.code}: ${err.message.slice(0, 60)}` : String(err).slice(0, 80)
    };
  }
  attempts.push(outcome);
}

const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const cp = require('node:child_process');

attempt('net.connect', () => net.connect(80, UNROUTABLE_IP));
attempt('net.createConnection', () => net.createConnection(80, UNROUTABLE_IP));
attempt('new net.Socket().connect', () => new net.Socket().connect(80, UNROUTABLE_IP));
attempt('tls.connect', () => tls.connect(443, UNROUTABLE_IP));
attempt('dgram.createSocket', () => dgram.createSocket('udp4'));
attempt('dns.lookup', () => dns.lookup(UNRESOLVABLE_HOST, () => {}));
attempt('dns.resolve', () => dns.resolve(UNRESOLVABLE_HOST, () => {}));
attempt('dns.promises.lookup', () => dns.promises.lookup(UNRESOLVABLE_HOST));
attempt('http.request', () => http.request(`http://${UNROUTABLE_IP}/`));
attempt('http.get', () => http.get(`http://${UNROUTABLE_IP}/`));
attempt('https.request', () => https.request(`https://${UNROUTABLE_IP}/`));
attempt('fetch', () => globalThis.fetch(`http://${UNROUTABLE_IP}/`));
attempt('child_process.execSync', () => cp.execSync('true'));
attempt('child_process.spawnSync', () => cp.spawnSync('true'));

const leaked = attempts.filter((a) => !a.blocked);
for (const a of attempts) {
  process.stdout.write(`  ${a.blocked ? 'blocked' : 'REACHABLE'}  ${a.what}  (${a.detail})\n`);
}

if (leaked.length > 0) {
  process.stderr.write(`\nNETBLOCK POSITIVE CONTROL FAILED: ${leaked.length} of ${attempts.length} `
    + 'outbound primitives are still reachable under the preload, so the byte-identical-output '
    + 'test proves nothing about whether this tool can send data.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`\nNETBLOCK POSITIVE CONTROL PASSED: all ${attempts.length} outbound `
    + 'primitives throw ENETBLOCK\n');
  process.exitCode = 0;
}
