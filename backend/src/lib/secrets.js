'use strict';
// Encryption at rest for credentials we have to keep: a shop's Gmail refresh
// token gets into that shop's mailbox, so a copy of the database must not be
// enough to use one.
//
// AES-256-GCM with a key that lives only in the environment
// (TOKEN_ENCRYPTION_KEY, 32 bytes, base64) — never in the database it
// protects. Stored values look like
//
//   enc:v1:<iv>:<auth tag>:<ciphertext>      (each part base64)
//
// Anything without that prefix is a value from before encryption, and is
// read back as it is. Without a key, nothing is encrypted and everything
// works as it did — so this can ship before the key is set, and the first
// start with a key encrypts what is already there (see postgres.js).
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let warned = false;

function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(String(raw).trim(), 'base64');
  if (k.length !== 32) {
    if (!warned) {
      console.error('[secrets] TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 — tokens are NOT being encrypted.');
      warned = true;
    }
    return null;
  }
  return k;
}

const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);
const enabled = () => !!key();

// Encrypt for storage. Empty values and values already sealed pass through.
function seal(plain) {
  if (plain === null || plain === undefined || plain === '' || isSealed(plain)) return plain;
  const k = key();
  if (!k) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
}

// Decrypt from storage. A value that can't be opened — no key, the wrong
// key, or tampered with — comes back as null, which every caller already
// treats as "Gmail isn't connected": the shop is asked to reconnect rather
// than the server sending with garbage.
function open(stored) {
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) {
    console.error('[secrets] An encrypted token was read but TOKEN_ENCRYPTION_KEY is not set.');
    return null;
  }
  try {
    const [iv, tag, ct] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch (_) {
    console.error('[secrets] An encrypted token could not be decrypted (wrong key, or altered).');
    return null;
  }
}

module.exports = { seal, open, isSealed, enabled, PREFIX };
