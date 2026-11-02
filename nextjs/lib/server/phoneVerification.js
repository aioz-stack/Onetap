// Mobile number verification by one-time code. A customer asks for a 6-digit code, types it in,
// and gets a short-lived token that registration (or a contact change in My Profile) spends in
// its own transaction. Only an HMAC of the code and the SHA-256 of the token are stored.

import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { getDb } from './db';
import { ApiError } from './errors';
import { sendSms } from './sms';

const CODE_MS = 5 * 60 * 1000;
const TOKEN_MS = 30 * 60 * 1000;
const RESEND_MS = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_TRIES = 5;
const MAX_SENDS_PER_NUMBER = 5;
const MAX_SENDS_PER_ADDRESS = 15;
export const PURPOSES = ['register', 'profile'];

const db = () => getDb();
const now = () => Date.now();
const contactError = (message, status = 422) => new ApiError(status, message, { contact: message });

// Philippine mobile numbers, stored as 09XXXXXXXXX.
export function normalizeMobile(value) {
  const match = String(value ?? '').replace(/[\s()-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
  return match ? `0${match[1]}` : null;
}

export const maskMobile = (phone) => `${phone.slice(0, 4)} ••• ${phone.slice(-4)}`;

// The secret keeps a stolen database from giving up codes by trying all million of them.
function codeHash(id, code) {
  return createHmac('sha256', process.env.ONETAP_SECRET_KEY || 'onetap-dev-only').update(`${id}:${code}`).digest('hex');
}
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

// One account per verified number. Numbers saved before verification are compared the same way.
export function mobileTaken(phone, exceptUsername = '') {
  return db().prepare("SELECT username, json_extract(profile, '$.contact') AS contact FROM customers WHERE username <> ?").all(exceptUsername)
    .some((row) => normalizeMobile(row.contact) === phone);
}

function checkPurpose(purpose, username) {
  if (!PURPOSES.includes(purpose)) throw new ApiError(400, 'Unknown verification.');
  if (purpose === 'profile' && !username) throw new ApiError(401, 'Log in to your Onetap account first.');
}

export async function sendCode({ contact, purpose, username = '', ip = '' }) {
  checkPurpose(purpose, username);
  const phone = normalizeMobile(contact);
  if (!phone) throw contactError('Enter a Philippine mobile number, like 0917 123 4567.');
  if (mobileTaken(phone, username)) throw contactError('This mobile number is already registered to an account.', 409);
  if (purpose === 'profile') {
    const current = db().prepare("SELECT json_extract(profile, '$.contact') AS contact FROM customers WHERE username = ?").get(username)?.contact;
    if (normalizeMobile(current) === phone) throw contactError('This is already your mobile number.');
  }
  const time = now();
  const last = db().prepare('SELECT sent_at FROM phone_verifications WHERE phone = ? ORDER BY sent_at DESC LIMIT 1').get(phone);
  if (last && time - last.sent_at < RESEND_MS) {
    throw contactError(`Wait ${Math.ceil((RESEND_MS - (time - last.sent_at)) / 1000)} seconds before asking for another code.`, 429);
  }
  const sends = (where, value) => db().prepare(`SELECT COUNT(*) AS c FROM phone_verifications WHERE ${where} = ? AND sent_at > ?`).get(value, time - HOUR).c;
  if (sends('phone', phone) >= MAX_SENDS_PER_NUMBER) throw contactError('Too many codes for this number. Try again in an hour.', 429);
  if (ip && sends('ip', ip) >= MAX_SENDS_PER_ADDRESS) throw contactError('Too many codes from this connection. Try again in an hour.', 429);

  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    // Only the newest code for a number works.
    database.prepare('UPDATE phone_verifications SET expires_at = ? WHERE phone = ? AND purpose = ? AND verified_at IS NULL AND expires_at > ?').run(time, phone, purpose, time);
    database.prepare('INSERT INTO phone_verifications (id, phone, purpose, username, code_hash, attempts, expires_at, sent_at, ip) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
      .run(id, phone, purpose, username, codeHash(id, code), time + CODE_MS, time, ip);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  let sent;
  try {
    sent = await sendSms(phone, `${code} is your Onetap verification code. It expires in 5 minutes. Never share it with anyone.`);
  } catch {
    db().prepare('UPDATE phone_verifications SET expires_at = ? WHERE id = ?').run(now(), id);
    throw contactError('We could not send a text message right now. Try again in a minute.', 502);
  }
  return {
    sentTo: maskMobile(phone), expiresAt: time + CODE_MS, resendAt: time + RESEND_MS,
    // Only the Sandbox, which sends nothing, hands the code back to show on screen.
    ...(sent?.sandbox ? { sandboxCode: code } : {}),
  };
}

export function verifyCode({ contact, purpose, username = '', code }) {
  checkPurpose(purpose, username);
  const phone = normalizeMobile(contact);
  if (!phone) throw contactError('Enter a Philippine mobile number, like 0917 123 4567.');
  const entered = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(entered)) throw new ApiError(422, 'Enter the 6-digit code.', { code: 'Enter the 6-digit code.' });
  const row = db().prepare('SELECT * FROM phone_verifications WHERE phone = ? AND purpose = ? AND username = ? AND verified_at IS NULL ORDER BY sent_at DESC LIMIT 1').get(phone, purpose, username);
  const time = now();
  if (!row || row.expires_at <= time) throw new ApiError(410, 'This code has expired. Ask for a new one.', { code: 'This code has expired. Ask for a new one.' });
  if (row.attempts >= MAX_TRIES) throw new ApiError(429, 'Too many wrong tries. Ask for a new code.', { code: 'Too many wrong tries. Ask for a new code.' });
  if (codeHash(row.id, entered) !== row.code_hash) {
    db().prepare('UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = MAX_TRIES - row.attempts - 1;
    const message = left ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Ask for a new code.';
    throw new ApiError(422, message, { code: message });
  }
  const token = randomBytes(32).toString('base64url');
  db().prepare('UPDATE phone_verifications SET verified_at = ?, token_hash = ?, token_expires_at = ? WHERE id = ?').run(time, tokenHash(token), time + TOKEN_MS, row.id);
  return { token, phone, verifiedUntil: time + TOKEN_MS };
}

// Spends a verification token. Run it inside the transaction that saves the number, so a token
// works once and only for the number and account it was issued for.
export function useVerifiedMobile({ contact, purpose, username = '', token }) {
  const phone = normalizeMobile(contact);
  const again = 'Verify your mobile number with the code we text you.';
  if (!phone || typeof token !== 'string' || !token) throw contactError(again);
  const time = now();
  const changed = db().prepare(`UPDATE phone_verifications SET used_at = ? WHERE token_hash = ? AND phone = ? AND purpose = ? AND username = ?
    AND verified_at IS NOT NULL AND used_at IS NULL AND token_expires_at > ?`).run(time, tokenHash(token), phone, purpose, username, time).changes;
  if (!changed) throw contactError('Your mobile number verification has expired. Verify it again.');
  return { phone, verifiedAt: time };
}
