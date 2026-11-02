// Seller, customer, administrator, courier and rider accounts and sessions. Passwords are scrypt hashes. The session cookie is httpOnly
// and holds a random token, and only the token's SHA-256 is stored.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { CUSTOMER_SCHEMA, SELLER_SCHEMA } from '../schemas';
import { getDb } from './db';
import { ApiError } from './errors';

const scryptAsync = promisify(scrypt);

// Table names are constants here, never input.
const ROLES = {
  seller: { table: 'sellers', sessions: 'seller_sessions', cookie: 'onetap_seller_session', schema: SELLER_SCHEMA },
  customer: { table: 'customers', sessions: 'customer_sessions', cookie: 'onetap_customer_session', schema: CUSTOMER_SCHEMA },
  admin: { table: 'admins', sessions: 'admin_sessions', cookie: 'onetap_admin_session', sessionMs: 8 * 60 * 60 * 1000 },
  courier: { table: 'courier_users', sessions: 'courier_sessions', cookie: 'onetap_courier_session', sessionMs: 8 * 60 * 60 * 1000 },
  rider: { table: 'riders', sessions: 'rider_sessions', cookie: 'onetap_rider_session', sessionMs: 12 * 60 * 60 * 1000 },
};

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_PASSWORD = 128;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BAD_LOGIN = 'Incorrect username, email or password.';

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function checkPassword(password, stored) {
  const [salt, expected] = stored.split('$').map((part) => Buffer.from(part, 'base64'));
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return timingSafeEqual(hash, expected);
}

// Compared against when an account doesn't exist, so timing doesn't reveal which do.
const decoy = hashPassword(randomBytes(16).toString('hex'));

function validateAccount(schema, data) {
  const errors = {};
  schema.flatMap((section) => section.fields).filter((field) => field.type !== 'file').forEach((field) => {
    const value = typeof data[field.name] === 'string' ? data[field.name].trim() : '';
    if (!value) {
      if (!field.optional) errors[field.name] = `${field.label} is required.`;
    } else if (field.options && !field.options.includes(value)) {
      errors[field.name] = `Choose a valid ${field.label.toLowerCase()}.`;
    } else if (field.minlength && value.length < field.minlength) {
      errors[field.name] = `Use at least ${field.minlength} characters.`;
    } else if (value.length > (field.maxlength || MAX_PASSWORD)) {
      errors[field.name] = 'That is too long.';
    } else if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) {
      errors[field.name] = field.hint || `Enter a valid ${field.label.toLowerCase()}.`;
    } else if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      errors[field.name] = 'Enter a valid email address.';
    }
  });
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
}

// Anything without a stored decision counts as not approved.
function applicationStatus(username) {
  return getDb().prepare('SELECT status FROM seller_applications WHERE username = ?').get(username)?.status || 'pending';
}

// customer_approvals is the only source of a customer's status. No row counts as pending.
// `verifiedBefore` means approved once, and now waiting to be re-verified after a change.
function customerApproval(username) {
  const row = getDb().prepare('SELECT status, reason, approved_at FROM customer_approvals WHERE username = ?').get(username);
  return { approvalStatus: row?.status || 'pending', approvalReason: row?.status === 'rejected' ? row.reason : '', verifiedBefore: Boolean(row?.approved_at) };
}

function toAccount(role, row) {
  const account = { ...JSON.parse(row.profile), username: row.username, email: row.email, role, createdAt: row.created_at };
  if (role === 'seller') return { ...account, applicationStatus: applicationStatus(row.username) };
  if (role === 'customer') return { ...account, ...customerApproval(row.username) };
  return account;
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

function isHttps(request) {
  return request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';
}

async function startSession(role, request, username) {
  const { sessions, cookie } = ROLES[role];
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + (ROLES[role].sessionMs || SESSION_MS);
  getDb().prepare(`INSERT INTO ${sessions} (token_hash, username, expires_at) VALUES (?, ?, ?)`).run(tokenHash(token), username, expires);
  (await cookies()).set(cookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    expires: new Date(expires),
  });
}

function accountForToken(role, token) {
  if (!token) return null;
  const { table, sessions } = ROLES[role];
  const db = getDb();
  db.prepare(`DELETE FROM ${sessions} WHERE expires_at <= ?`).run(Date.now());
  const row = db.prepare(`
    SELECT ${table}.* FROM ${sessions} JOIN ${table} ON ${table}.username = ${sessions}.username
    WHERE ${sessions}.token_hash = ?
  `).get(tokenHash(token));
  if (!row) return null;
  const account = toAccount(role, row);
  return account.disabled ? null : account;
}

// For server components: the signed-in account, or null.
export async function currentAccount(role) {
  return accountForToken(role, (await cookies()).get(ROLES[role].cookie)?.value);
}

function accountFrom(role, request, message) {
  const account = accountForToken(role, request.cookies.get(ROLES[role].cookie)?.value);
  if (!account) throw new ApiError(401, message);
  return account;
}

// For route handlers: the signed-in account, or a 401.
export function sellerFrom(request) {
  const seller = accountFrom('seller', request, 'Log in to Seller Centre first.');
  if (seller.applicationStatus !== 'approved') throw new ApiError(403, 'Your seller account is not active yet.');
  return seller.username;
}

// A signed-in seller at any stage, for the application pages only.
export const applicantFrom = (request) => accountFrom('seller', request, 'Log in to Seller Centre first.').username;

// A signed-in customer at any approval stage, for their status, ID resubmission and notices only.
export const customerAccountFrom = (request) => accountFrom('customer', request, 'Log in to your Onetap account first.');

export const CUSTOMER_NOT_APPROVED = {
  pending: 'Your account is waiting for approval. You can shop once an administrator approves it.',
  rejected: 'Your registration was not approved. Update your valid ID to apply again.',
};

const REVERIFYING = 'Your updated details are waiting for approval. You can buy and chat with shops again once they are approved.';

// For buying and shop chat: only approved customers.
export function customerFrom(request) {
  const customer = customerAccountFrom(request);
  if (customer.approvalStatus !== 'approved') throw new ApiError(403, customer.verifiedBefore ? REVERIFYING : CUSTOMER_NOT_APPROVED[customer.approvalStatus] || CUSTOMER_NOT_APPROVED.pending);
  return customer;
}

// For a customer's existing orders: approved now, or approved before and being re-verified, so
// a change of ID never cuts them off from orders already on their way.
export function customerOrdersFrom(request) {
  const customer = customerAccountFrom(request);
  if (customer.approvalStatus !== 'approved' && !customer.verifiedBefore) throw new ApiError(403, CUSTOMER_NOT_APPROVED[customer.approvalStatus] || CUSTOMER_NOT_APPROVED.pending);
  return customer;
}

// A signed-in customer changes their password. Other devices are signed out, this one stays.
export async function changeCustomerPassword(request, { current, next, confirm }) {
  const customer = customerAccountFrom(request);
  const key = `customer-password|${customer.username}`;
  checkAttempts(key);
  const db = getDb();
  const row = db.prepare('SELECT password FROM customers WHERE username = ?').get(customer.username);
  if (typeof current !== 'string' || current.length > MAX_PASSWORD || !await checkPassword(current, row.password)) {
    recordFailure(key);
    throw new ApiError(422, 'Your current password is not right.', { current: 'Your current password is not right.' });
  }
  if (typeof next !== 'string' || next.length < 8 || next.length > MAX_PASSWORD) throw new ApiError(422, 'Use 8 to 128 characters.', { next: 'Use 8 to 128 characters.' });
  if (next === current) throw new ApiError(422, 'Choose a password you are not using now.', { next: 'Choose a password you are not using now.' });
  if (next !== confirm) throw new ApiError(422, 'The passwords do not match.', { confirm: 'The passwords do not match.' });
  const hash = await hashPassword(next);
  const token = request.cookies.get(ROLES.customer.cookie)?.value || '';
  db.prepare('UPDATE customers SET password = ? WHERE username = ?').run(hash, customer.username);
  db.prepare('DELETE FROM customer_sessions WHERE username = ? AND token_hash <> ?').run(customer.username, tokenHash(token));
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}

// Checks fields against their schema, for registration and profile edits alike.
export function checkFields(fields, data) {
  validateAccount([{ fields }], data);
}

// Ends every session for an account, for password changes and disabled administrators.
export function endSessions(role, username) {
  getDb().prepare(`DELETE FROM ${ROLES[role].sessions} WHERE username = ?`).run(username);
}

export function shopNameOf(username) {
  const row = getDb().prepare('SELECT * FROM sellers WHERE username = ?').get(username);
  return toAccount('seller', row).shopName;
}

// `alongside(username)` runs in the same transaction as the account insert, so a failure there
// leaves no account behind.
export async function registerAccount(role, request, input, alongside) {
  if (typeof input !== 'object' || input === null) throw new ApiError(400, 'That request could not be read.');
  const { table, schema } = ROLES[role];
  validateAccount(schema, input);
  const db = getDb();
  const { password, ...rest } = input;
  const username = rest.username.trim();
  const email = rest.email.trim().toLowerCase();
  if (db.prepare(`SELECT 1 FROM ${table} WHERE username = ?`).get(username)) {
    throw new ApiError(409, 'That username is already taken.', { username: 'That username is already taken.' });
  }
  if (db.prepare(`SELECT 1 FROM ${table} WHERE email = ?`).get(email)) {
    throw new ApiError(409, 'An account with this email already exists.', { email: 'An account with this email already exists.' });
  }
  const profile = Object.fromEntries(
    schema.flatMap((section) => section.fields)
      // Private fields, like a customer's ID number, are stored with their approval, never in the profile.
      .filter(({ name, type, private: hidden }) => !['username', 'email', 'password'].includes(name) && type !== 'file' && !hidden)
      .map(({ name }) => [name, String(rest[name] ?? '').trim()]),
  );
  const hash = await hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO ${table} (username, email, password, profile, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(username, email, hash, JSON.stringify(profile), Date.now());
    alongside?.(username);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (/UNIQUE/.test(err.message) && /\.(username|email)/.test(err.message)) throw new ApiError(409, 'That username or email was just taken. Try another.');
    throw err;
  }
  await startSession(role, request, username);
  return toAccount(role, db.prepare(`SELECT * FROM ${table} WHERE username = ?`).get(username));
}

function attemptKey(role, request, identifier) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  return `${role}|${identifier}|${ip}`;
}

function checkAttempts(key) {
  const db = getDb();
  db.prepare('DELETE FROM login_attempts WHERE first_at <= ?').run(Date.now() - ATTEMPT_WINDOW_MS);
  const row = db.prepare('SELECT count FROM login_attempts WHERE key = ?').get(key);
  if (row?.count >= MAX_ATTEMPTS) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
}

function recordFailure(key) {
  getDb().prepare(`
    INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET count = count + 1
  `).run(key, Date.now());
}

// `check` runs after the password is proven and can refuse the sign-in, so it reveals nothing to strangers.
export async function loginAccount(role, request, identifier, password, check) {
  if (typeof identifier !== 'string' || typeof password !== 'string' || password.length > MAX_PASSWORD) {
    throw new ApiError(422, BAD_LOGIN, { password: BAD_LOGIN });
  }
  const id = identifier.trim().toLowerCase();
  const key = attemptKey(role, request, id);
  checkAttempts(key);
  const db = getDb();
  const row = db.prepare(`SELECT * FROM ${ROLES[role].table} WHERE username = ? OR email = ?`).get(id, id);
  const matches = await checkPassword(password, row?.password || await decoy);
  if (!row || !matches || JSON.parse(row.profile).disabled) {
    recordFailure(key);
    throw new ApiError(401, BAD_LOGIN, { password: BAD_LOGIN });
  }
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
  check?.(toAccount(role, row));
  await startSession(role, request, row.username);
  return toAccount(role, row);
}

export async function logoutAccount(role) {
  const { sessions, cookie } = ROLES[role];
  const store = await cookies();
  const token = store.get(cookie)?.value;
  if (token) getDb().prepare(`DELETE FROM ${sessions} WHERE token_hash = ?`).run(tokenHash(token));
  store.delete(cookie);
}
