// Customer Approval. A new customer registers with a photo of a valid ID and its number, and
// waits as Pending until an administrator approves them. Until then they can sign in and browse,
// but `customerFrom` refuses buying, orders and shop chat. The ID photo is a private file outside
// the public uploads folder, served only to administrators with the `customers` permission.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ID_NUMBER } from '../schemas';
import { audit } from './admin';
import { registerAccount } from './auth';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, isoDate, listQuery, search } from './lists';
import { notifyCustomer } from './notifications';

const ID_DIR = path.join(UPLOAD_DIR, '..', 'documents', 'customers');
const MAX_ID_BYTES = 10 * 1024 * 1024;
const STATUSES = ['pending', 'approved', 'rejected'];
const ID_PATTERN = new RegExp(`^(?:${ID_NUMBER.pattern})$`);

const db = () => getDb();
const now = () => Date.now();
const invalid = (field, message) => new ApiError(422, 'Check the highlighted fields.', { [field]: message });

// The type comes from the file's own bytes, because the browser's can be anything.
function imageType(bytes) {
  const part = (start, end) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (part(1, 4) === 'PNG') return { mime: 'image/png', extension: 'png' };
  if (part(0, 4) === 'RIFF' && part(8, 12) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

async function readValidId(form) {
  const file = form.get('validId');
  if (!(file instanceof File) || !file.size) throw invalid('validId', 'Upload a clear photo of your valid ID.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) throw invalid('validId', 'Use a JPG, PNG or WebP photo of your ID.');
  if (bytes.length > MAX_ID_BYTES) throw invalid('validId', 'Photos must be 10 MB or smaller.');
  return { ...type, bytes, name: String(file.name || '').slice(0, 120) || `valid-id.${type.extension}`, hash: createHash('sha256').update(bytes).digest('hex') };
}

function readIdNumber(value) {
  const number = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (number.length < ID_NUMBER.minlength || number.length > ID_NUMBER.maxlength || !ID_PATTERN.test(number)) throw invalid('idNumber', ID_NUMBER.hint);
  // Spaces, hyphens and case don't make a different ID.
  return { number, key: number.toUpperCase().replace(/[\s-]/g, '') };
}

// One ID belongs to one account. A rejected application doesn't hold its ID, so the real owner can still register.
function checkIdFree(id, file, username = '') {
  if (db().prepare("SELECT 1 FROM customer_approvals WHERE id_key = ? AND status <> 'rejected' AND username <> ?").get(id.key, username)) {
    throw new ApiError(409, 'This ID number is already registered to another account.', { idNumber: 'This ID number is already registered to another account.' });
  }
  if (db().prepare("SELECT 1 FROM customer_approvals WHERE id_hash = ? AND status <> 'rejected' AND username <> ?").get(file.hash, username)) {
    throw new ApiError(409, 'This ID photo is already registered to another account.', { validId: 'This ID photo is already registered to another account. Take a new photo of your own ID.' });
  }
}

function storeId(file) {
  mkdirSync(ID_DIR, { recursive: true });
  const stored = `${randomUUID()}.${file.extension}`;
  writeFileSync(path.join(ID_DIR, stored), file.bytes);
  return stored;
}

function record(customer, action, actor, reason = '') {
  db().prepare('INSERT INTO customer_approval_history (customer, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(customer, action, actor, reason, now());
}

const duplicate = (err) => (/customer_approvals\.id_key|customer_id_number/.test(err.message)
  ? new ApiError(409, 'This ID number is already registered to another account.', { idNumber: 'This ID number is already registered to another account.' })
  : /customer_approvals\.id_hash|customer_id_image/.test(err.message)
    ? new ApiError(409, 'This ID photo is already registered to another account.', { validId: 'This ID photo is already registered to another account.' })
    : err);

export async function registerCustomer(request) {
  const form = await request.formData();
  const input = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'));
  const id = readIdNumber(input.idNumber);
  const file = await readValidId(form);
  checkIdFree(id, file);
  const stored = storeId(file);
  try {
    // The account, its Pending approval and its ID are saved together.
    return await registerAccount('customer', request, input, (username) => {
      const time = now();
      db().prepare(`INSERT INTO customer_approvals (username, status, id_number, id_key, id_name, id_mime, id_size, id_stored, id_hash, submitted_at, updated_at)
        VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(username, id.number, id.key, file.name, file.mime, file.bytes.length, stored, file.hash, time, time);
      record(username, 'submitted', username);
      notifyCustomer(username, 'Registration received', 'Your account is waiting for approval. We check your valid ID, then you can start shopping.', '/');
    });
  } catch (err) {
    rmSync(path.join(ID_DIR, stored), { force: true });
    throw duplicate(err);
  }
}

function findApproval(username) {
  const row = db().prepare(`
    SELECT a.*, c.email, c.profile, c.created_at AS registered_at FROM customer_approvals a
    JOIN customers c ON c.username = a.username WHERE a.username = ?
  `).get(String(username ?? ''));
  if (!row) throw new ApiError(404, 'We could not find that customer.');
  return row;
}

const historyFor = (customer) => db().prepare('SELECT action, actor, reason, at FROM customer_approval_history WHERE customer = ? ORDER BY id DESC').all(customer);

// The customer's own view. Reviewer names and the stored ID stay in the Admin Console.
export function approvalFor(username) {
  const row = findApproval(username);
  return {
    status: row.status, reason: row.status === 'rejected' ? row.reason : '', submittedAt: row.submitted_at, decidedAt: row.decided_at,
    idNumber: row.id_number ? `••••${row.id_number.slice(-4)}` : '',
  };
}

// A rejected customer sends a new ID photo and number, and waits as Pending again.
export async function resubmitApproval(username, request) {
  const row = findApproval(username);
  if (row.status !== 'rejected') throw new ApiError(409, row.status === 'approved' ? 'Your account is already approved.' : 'Your registration is already waiting for review.');
  const form = await request.formData();
  const id = readIdNumber(form.get('idNumber'));
  const file = await readValidId(form);
  checkIdFree(id, file, row.username);
  const stored = storeId(file);
  const time = now();
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const changed = database.prepare(`UPDATE customer_approvals SET status = 'pending', reason = '', id_number = ?, id_key = ?, id_name = ?, id_mime = ?, id_size = ?, id_stored = ?, id_hash = ?, submitted_at = ?, decided_at = NULL, decided_by = '', updated_at = ?
      WHERE username = ? AND status = 'rejected'`).run(id.number, id.key, file.name, file.mime, file.bytes.length, stored, file.hash, time, time, row.username).changes;
    if (!changed) throw new ApiError(409, 'Your registration has changed. Refresh and try again.');
    record(row.username, 'resubmitted', row.username);
    notifyCustomer(row.username, 'Registration resubmitted', 'Your new ID is waiting for approval.', '/');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    rmSync(path.join(ID_DIR, stored), { force: true });
    throw duplicate(err);
  }
  if (row.id_stored) rmSync(path.join(ID_DIR, row.id_stored), { force: true });
  return approvalFor(row.username);
}

export function validIdResponse(username) {
  const row = findApproval(username);
  if (!row.id_stored) throw new ApiError(404, 'This customer has no ID on file.');
  return new Response(readFileSync(path.join(ID_DIR, row.id_stored)), {
    headers: {
      'Content-Type': row.id_mime,
      'Content-Disposition': `inline; filename="valid-id.${row.id_stored.split('.').pop()}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}

export function customerApprovalCounts() {
  const counts = Object.fromEntries(db().prepare('SELECT status, COUNT(*) AS c FROM customer_approvals GROUP BY status').all().map((row) => [row.status, row.c]));
  return Object.fromEntries(STATUSES.map((status) => [status, counts[status] || 0]));
}

const fullName = (profile) => [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(' ');
const addressOf = (profile) => [profile.street, profile.barangay, profile.city, profile.province, profile.country, profile.zip].filter(Boolean).join(', ');

function toSummary(row) {
  const profile = JSON.parse(row.profile);
  return {
    username: row.username, email: row.email, name: fullName(profile), contact: profile.contact, city: profile.city, idNumber: row.id_number, hasId: Boolean(row.id_stored),
    status: row.status, reason: row.reason, registeredAt: row.registered_at, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decided_by,
  };
}

export function listCustomerApprovals(params) {
  const status = params.get('tab');
  const where = [
    ...(STATUSES.includes(status) ? [['a.status = ?', status]] : []),
    ...search(params, ['a.username', 'c.email', 'c.profile', 'a.id_number']),
    ...dateRange(params, 'a.submitted_at'),
  ];
  const { rows, ...page } = listQuery(db(), {
    select: 'a.*, c.email, c.profile, c.created_at AS registered_at',
    from: 'customer_approvals a JOIN customers c ON c.username = a.username',
    where,
    sorts: { submitted: 'a.submitted_at', decided: 'a.decided_at', status: 'a.status', customer: 'a.username' },
    defaultSort: 'submitted',
  }, params);
  const customers = rows.map(toSummary);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-customer-approvals.csv', [
      ['Username', (c) => c.username], ['Name', (c) => c.name], ['Email', (c) => c.email], ['Contact number', (c) => c.contact], ['ID number', (c) => c.idNumber], ['Status', (c) => c.status],
      ['Reason', (c) => c.reason], ['Registered', (c) => isoDate(c.registeredAt)], ['Submitted', (c) => isoDate(c.submittedAt)], ['Decided', (c) => isoDate(c.decidedAt)], ['Reviewer', (c) => c.decidedBy],
    ], customers);
  }
  return Response.json({ ...page, rows: customers, counts: customerApprovalCounts() });
}

export function customerApprovalDetail(username) {
  const row = findApproval(username);
  const profile = JSON.parse(row.profile);
  // Other accounts that share this customer's contact number, so a reviewer can spot repeat sign-ups.
  const sameContact = profile.contact
    ? db().prepare("SELECT username FROM customers WHERE username <> ? AND json_extract(profile, '$.contact') = ? LIMIT 5").all(row.username, profile.contact).map((r) => r.username)
    : [];
  return {
    ...toSummary(row), profile, address: addressOf(profile), idFile: row.id_stored ? { name: row.id_name, mime: row.id_mime, size: row.id_size } : null,
    sameContact, history: historyFor(row.username),
  };
}

const DECISIONS = {
  approve: { from: ['pending'], status: 'approved', title: 'Your Onetap account is approved', body: () => 'Welcome! You can now check out, see your purchases and chat with shops.' },
  reject: { from: ['pending'], status: 'rejected', needsReason: true, title: 'Your registration was not approved', body: (reason) => `Reason: ${reason} You can send a new photo of your valid ID to apply again.` },
};

export function decideCustomer(admin, username, action, reason) {
  const decision = Object.hasOwn(DECISIONS, action) ? DECISIONS[action] : null;
  if (!decision) throw new ApiError(400, 'Unknown action.');
  const row = findApproval(username);
  if (!decision.from.includes(row.status)) throw new ApiError(409, 'This registration has changed. Refresh and try again.');
  const text = String(reason || '').trim();
  if (decision.needsReason && (text.length < 10 || text.length > 500)) throw invalid('reason', 'Enter a reason of 10 to 500 characters.');
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const changed = database.prepare('UPDATE customer_approvals SET status = ?, reason = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE username = ? AND status = ?')
      .run(decision.status, decision.needsReason ? text : '', now(), admin.username, now(), row.username, row.status).changes;
    if (!changed) throw new ApiError(409, 'This registration has changed. Refresh and try again.');
    record(row.username, action, admin.username, text);
    notifyCustomer(row.username, decision.title, decision.body(text), '/');
    audit(admin, `customer.${action}`, 'customer', row.username, { reason: text || undefined });
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  return customerApprovalDetail(row.username);
}
