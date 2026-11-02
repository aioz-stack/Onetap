// Sellers' saved withdrawal accounts (Finance > Bank Accounts) and the list of supported
// Philippine banks and e-wallets. Account numbers are encrypted at rest (AES-256-GCM with
// ONETAP_SECRET_KEY), with an HMAC fingerprint to refuse duplicates and the last four digits for
// display. Sellers only ever get masked numbers back. An account can receive withdrawals only once
// an administrator has verified it, because no bank or wallet API is connected to check it.

import { randomUUID } from 'node:crypto';
import { audit } from './admin';
import { decrypt, encrypt, hmac } from './crypto';
import { getDb } from './db';
import { ApiError } from './errors';
import { notifyAdmins, notifySeller } from './notifications';

export const ACCOUNT_KINDS = { bank: 'Bank Account', ewallet: 'E-Wallet' };
export const BANK_ACCOUNT_TYPES = ['Savings', 'Checking'];
const MAX_ACCOUNTS = 10;

const db = () => getDb();
const now = () => Date.now();
const text = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const fingerprint = (providerId, number) => hmac(process.env.ONETAP_SECRET_KEY || 'onetap-dev-only', `${providerId}:${number}`);
const mask = (last4) => `•••• ${last4}`;

const toProvider = (row) => ({ id: row.id, kind: row.kind, name: row.name, minDigits: row.min_digits, maxDigits: row.max_digits, active: Boolean(row.active) });

export function listProviders({ all = false } = {}) {
  return db().prepare(`SELECT * FROM payout_providers ${all ? '' : 'WHERE active = 1'} ORDER BY kind, sort, name`).all().map(toProvider);
}

function provider(id) {
  const row = db().prepare('SELECT * FROM payout_providers WHERE id = ?').get(String(id ?? ''));
  return row ? toProvider(row) : null;
}

// What sellers see: never the full number.
function toAccount(row) {
  return {
    id: row.id, kind: row.kind, kindLabel: ACCOUNT_KINDS[row.kind], providerId: row.provider_id, provider: row.provider_name, holderName: row.holder_name, accountType: row.account_type,
    number: mask(row.last4), isDefault: Boolean(row.is_default), status: row.status, reviewNote: row.status === 'rejected' ? row.review_note : '', verifiedAt: row.reviewed_at && row.status === 'verified' ? row.reviewed_at : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const ACCOUNT_SELECT = 'SELECT a.*, p.name AS provider_name FROM seller_payout_accounts a JOIN payout_providers p ON p.id = a.provider_id';

function ownAccount(seller, id) {
  const row = db().prepare(`${ACCOUNT_SELECT} WHERE a.id = ? AND a.seller = ? AND a.deleted_at IS NULL`).get(String(id ?? ''), seller);
  if (!row) throw new ApiError(404, 'We could not find that account.');
  return row;
}

export function sellerAccounts(seller) {
  return {
    accounts: db().prepare(`${ACCOUNT_SELECT} WHERE a.seller = ? AND a.deleted_at IS NULL ORDER BY a.is_default DESC, a.created_at`).all(seller).map(toAccount),
    providers: listProviders(),
    kinds: ACCOUNT_KINDS,
    bankAccountTypes: BANK_ACCOUNT_TYPES,
    max: MAX_ACCOUNTS,
  };
}

// Philippine mobile numbers, as 09XXXXXXXXX.
const mobile = (value) => {
  const match = String(value ?? '').replace(/[\s()-]/g, '').match(/^(?:\+?63|0)(9\d{9})$/);
  return match ? `0${match[1]}` : null;
};

// Checks a form against the provider's rules. `current` is the saved account when editing.
function readAccount(input, current) {
  const errors = {};
  const kind = Object.hasOwn(ACCOUNT_KINDS, input.kind) ? input.kind : '';
  if (!kind) errors.kind = 'Choose Bank Account or E-Wallet.';
  const chosen = provider(input.providerId);
  if (!chosen || (!chosen.active && chosen.id !== current?.provider_id) || chosen.kind !== kind) errors.providerId = kind === 'ewallet' ? 'Choose an e-wallet.' : 'Choose a bank.';
  const holderName = text(input.holderName, 100);
  if (holderName.length < 3 || !/^\p{L}[\p{L} .,'-]*$/u.test(holderName)) errors.holderName = 'Enter the name on the account, as the bank or wallet shows it.';
  const accountType = kind === 'bank' ? text(input.accountType, 20) : '';
  if (kind === 'bank' && !BANK_ACCOUNT_TYPES.includes(accountType)) errors.accountType = 'Choose Savings or Checking.';
  // Editing without typing a new number keeps the saved one.
  const typed = String(input.number ?? '').trim();
  let number = null;
  if (typed || !current) {
    if (kind === 'ewallet') {
      number = mobile(typed);
      if (!number) errors.number = 'Enter the registered mobile number, like 0917 123 4567.';
    } else {
      number = typed.replace(/[\s-]/g, '');
      if (chosen && (!/^\d+$/.test(number) || number.length < chosen.minDigits || number.length > chosen.maxDigits)) {
        errors.number = chosen.minDigits === chosen.maxDigits ? `${chosen.name} account numbers have ${chosen.minDigits} digits.` : `${chosen.name} account numbers have ${chosen.minDigits} to ${chosen.maxDigits} digits.`;
      }
    }
  }
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  return { kind, provider: chosen, holderName, accountType, number };
}

function checkDuplicate(providerId, hash, exceptId = '') {
  if (db().prepare('SELECT 1 FROM seller_payout_accounts WHERE provider_id = ? AND number_hash = ? AND deleted_at IS NULL AND id <> ?').get(providerId, hash, exceptId)) {
    throw new ApiError(409, 'This account is already registered on Onetap.', { number: 'This account is already registered on Onetap.' });
  }
}

const askToVerify = (seller, account, what) => notifyAdmins('cod', 'Seller account to verify', `${seller} ${what} a ${account.provider.name} account ending ${account.number.slice(-4)}. Verify it before withdrawals can go to it.`, '/admin/payout-accounts?status=pending');

export function addAccount(seller, input) {
  const account = readAccount(input || {});
  const hash = fingerprint(account.provider.id, account.number);
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const count = database.prepare('SELECT COUNT(*) AS c FROM seller_payout_accounts WHERE seller = ? AND deleted_at IS NULL').get(seller).c;
    if (count >= MAX_ACCOUNTS) throw new ApiError(409, `You can save up to ${MAX_ACCOUNTS} accounts. Delete one you no longer use first.`);
    checkDuplicate(account.provider.id, hash);
    const id = randomUUID();
    const time = now();
    database.prepare(`INSERT INTO seller_payout_accounts (id, seller, kind, provider_id, holder_name, account_type, number_enc, number_hash, last4, is_default, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, seller, account.kind, account.provider.id, account.holderName, account.accountType, encrypt(account.number), hash, account.number.slice(-4), count === 0 ? 1 : 0, time, time);
    askToVerify(seller, account, 'added');
    audit({ username: seller, adminRole: 'seller' }, 'payout_account.added', 'payout_account', id, { provider: account.provider.id, last4: account.number.slice(-4) });
    database.exec('COMMIT');
    return toAccount(ownAccount(seller, id));
  } catch (err) {
    database.exec('ROLLBACK');
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'This account is already registered on Onetap.', { number: 'This account is already registered on Onetap.' });
    throw err;
  }
}

// Changing the provider, number or holder name needs verifying again.
export function updateAccount(seller, id, input) {
  const row = ownAccount(seller, id);
  if (input?.kind && input.kind !== row.kind) throw new ApiError(422, 'An account can\'t change between bank and e-wallet. Add a new one instead.', { kind: 'Add a new account instead.' });
  const account = readAccount({ ...input, kind: row.kind }, row);
  const number = account.number ?? decrypt(row.number_enc);
  const hash = fingerprint(account.provider.id, number);
  const reverify = account.provider.id !== row.provider_id || hash !== row.number_hash || account.holderName !== row.holder_name;
  if (!reverify && account.accountType === row.account_type) throw new ApiError(422, 'Nothing has changed yet.');
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    checkDuplicate(account.provider.id, hash, row.id);
    if (reverify && database.prepare("SELECT 1 FROM seller_payouts WHERE account_id = ? AND status IN ('pending', 'processing')").get(row.id)) {
      throw new ApiError(409, 'A payout to this account is in progress. You can change it once that payout is done.');
    }
    database.prepare(`UPDATE seller_payout_accounts SET provider_id = ?, holder_name = ?, account_type = ?, number_enc = ?, number_hash = ?, last4 = ?, updated_at = ?
      ${reverify ? ", status = 'pending', review_note = '', reviewed_by = '', reviewed_at = NULL" : ''} WHERE id = ?`)
      .run(account.provider.id, account.holderName, account.accountType, encrypt(number), hash, number.slice(-4), now(), row.id);
    if (reverify) askToVerify(seller, { ...account, number }, 'changed');
    audit({ username: seller, adminRole: 'seller' }, 'payout_account.updated', 'payout_account', row.id, { reverify });
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'This account is already registered on Onetap.', { number: 'This account is already registered on Onetap.' });
    throw err;
  }
  return { account: toAccount(ownAccount(seller, row.id)), reverify };
}

export function setDefaultAccount(seller, id) {
  const row = ownAccount(seller, id);
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('UPDATE seller_payout_accounts SET is_default = 0 WHERE seller = ? AND is_default = 1').run(seller);
    database.prepare('UPDATE seller_payout_accounts SET is_default = 1, updated_at = ? WHERE id = ?').run(now(), row.id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// Deleted accounts are kept, hidden, so past payouts still show where they went.
export function deleteAccount(seller, id) {
  const row = ownAccount(seller, id);
  if (db().prepare("SELECT 1 FROM seller_payouts WHERE account_id = ? AND status IN ('pending', 'processing')").get(row.id)) {
    throw new ApiError(409, 'A payout to this account is in progress. You can delete it once that payout is done.');
  }
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('UPDATE seller_payout_accounts SET deleted_at = ?, is_default = 0 WHERE id = ?').run(now(), row.id);
    // The oldest remaining account becomes the default.
    if (row.is_default) {
      const next = database.prepare('SELECT id FROM seller_payout_accounts WHERE seller = ? AND deleted_at IS NULL ORDER BY status = \'verified\' DESC, created_at LIMIT 1').get(seller);
      if (next) database.prepare('UPDATE seller_payout_accounts SET is_default = 1 WHERE id = ?').run(next.id);
    }
    audit({ username: seller, adminRole: 'seller' }, 'payout_account.deleted', 'payout_account', row.id);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// For a withdrawal: the seller's own, verified account, with its full details for the payout.
export function accountForPayout(seller, id) {
  const row = db().prepare(`${ACCOUNT_SELECT} WHERE a.id = ? AND a.seller = ? AND a.deleted_at IS NULL`).get(String(id ?? ''), seller);
  if (!row) throw new ApiError(422, 'Choose one of your saved accounts.', { accountId: 'Choose one of your saved accounts.' });
  if (row.status !== 'verified') throw new ApiError(422, 'This account isn\'t verified yet. Choose a verified account.', { accountId: 'This account isn\'t verified yet. Choose a verified account.' });
  return { id: row.id, kind: row.kind, provider: row.provider_name, holderName: row.holder_name, number: decrypt(row.number_enc), last4: row.last4 };
}

// Admin Console > Payout Accounts.
export function listAccounts(params) {
  const status = params.get('status');
  const q = text(params.get('q'), 60).toLowerCase();
  const rows = db().prepare(`${ACCOUNT_SELECT} WHERE a.deleted_at IS NULL ORDER BY a.status = 'pending' DESC, a.updated_at DESC`).all()
    .filter((row) => (!status || row.status === status) && (!q || [row.seller, row.holder_name, row.provider_name, row.last4].some((v) => v.toLowerCase().includes(q))))
    .map((row) => ({ ...toAccount(row), seller: row.seller, reviewedBy: row.reviewed_by, reviewNote: row.review_note }));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const counts = Object.fromEntries(db().prepare('SELECT status, COUNT(*) AS c FROM seller_payout_accounts WHERE deleted_at IS NULL GROUP BY status').all().map((r) => [r.status, r.c]));
  return Response.json({ rows: rows.slice((page - 1) * 20, page * 20), total: rows.length, page, pageSize: 20, counts });
}

// The full number, for checking it against the bank or wallet. Every look is audited.
export function revealAccount(admin, id) {
  const row = db().prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(String(id ?? ''));
  if (!row) throw new ApiError(404, 'We could not find that account.');
  audit(admin, 'payout_account.viewed', 'payout_account', row.id, { seller: row.seller });
  const shop = db().prepare('SELECT profile FROM sellers WHERE username = ?').get(row.seller);
  const profile = shop ? JSON.parse(shop.profile) : {};
  return {
    ...toAccount(row), seller: row.seller, number: decrypt(row.number_enc), reviewNote: row.review_note, reviewedBy: row.reviewed_by,
    owner: { shopName: profile.shopName || '', name: [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' '), businessName: profile.businessName || '' },
  };
}

export function reviewAccount(admin, id, { action, note }) {
  if (!['verify', 'reject'].includes(action)) throw new ApiError(400, 'Unknown action.');
  const row = db().prepare(`${ACCOUNT_SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`).get(String(id ?? ''));
  if (!row) throw new ApiError(404, 'We could not find that account.');
  if (row.status !== 'pending') throw new ApiError(409, 'This account has changed. Refresh and try again.');
  const reason = text(note, 300);
  if (action === 'reject' && reason.length < 10) throw new ApiError(422, 'Enter a reason of at least 10 characters.', { note: 'Enter a reason of at least 10 characters.' });
  const status = action === 'verify' ? 'verified' : 'rejected';
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const changed = database.prepare("UPDATE seller_payout_accounts SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'").run(status, reason, admin.username, now(), row.id).changes;
    if (!changed) throw new ApiError(409, 'This account has changed. Refresh and try again.');
    notifySeller(row.seller, action === 'verify' ? 'Account verified' : 'Account not verified',
      action === 'verify' ? `Your ${row.provider_name} account ${mask(row.last4)} is verified. You can withdraw to it.` : `Your ${row.provider_name} account ${mask(row.last4)} was not verified: ${reason} Edit it to try again.`, '/seller/bank-accounts');
    audit(admin, `payout_account.${action}`, 'payout_account', row.id, { seller: row.seller, note: reason || undefined });
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

// Administrators add providers, rename them, change their digit rules, or switch them off.
// A provider switched off can't be chosen for new accounts, but saved ones keep working.
export function saveProvider(admin, id, input) {
  const kind = Object.hasOwn(ACCOUNT_KINDS, input.kind) ? input.kind : '';
  const name = text(input.name, 80);
  const min = Number(input.minDigits);
  const max = Number(input.maxDigits);
  const errors = {};
  if (!id && !kind) errors.kind = 'Choose Bank Account or E-Wallet.';
  if (name.length < 2) errors.name = 'Enter the provider name.';
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 6 || max > 20 || min > max) errors.maxDigits = 'Use whole numbers from 6 to 20, with the first no more than the second.';
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  const active = input.active === undefined ? 1 : input.active ? 1 : 0;
  if (id) {
    const changed = db().prepare('UPDATE payout_providers SET name = ?, min_digits = ?, max_digits = ?, active = ? WHERE id = ?').run(name, min, max, active, String(id)).changes;
    if (!changed) throw new ApiError(404, 'We could not find that provider.');
    audit(admin, 'payout_provider.updated', 'payout_provider', id, { name, min, max, active: Boolean(active) });
    return provider(id);
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || randomUUID();
  if (provider(slug) || db().prepare('SELECT 1 FROM payout_providers WHERE lower(name) = lower(?)').get(name)) throw new ApiError(409, 'That provider is already on the list.', { name: 'That provider is already on the list.' });
  db().prepare('INSERT INTO payout_providers (id, kind, name, min_digits, max_digits, active, sort, created_at) VALUES (?, ?, ?, ?, ?, 1, 100, ?)').run(slug, kind, name, kind === 'ewallet' ? 11 : min, kind === 'ewallet' ? 11 : max, now());
  audit(admin, 'payout_provider.added', 'payout_provider', slug, { kind, name });
  return provider(slug);
}
