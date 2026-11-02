// Customer Approval. A new customer registers with a photo of a valid ID and its number, and
// waits as Pending until an administrator approves them. Until then they can sign in and browse,
// but `customerFrom` refuses buying, orders and shop chat. The ID photo is a private file outside
// the public uploads folder, served only to administrators with the `customers` permission.

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { verificationOf } from '../adminLabels';
import { CUSTOMER_PROFILE_SECTIONS, ID_NUMBER } from '../schemas';
import { audit } from './admin';
import { checkFields, registerAccount } from './auth';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';
import { csvResponse, dateRange, isoDate, listQuery, search } from './lists';
import { notifyAdmins, notifyCustomer } from './notifications';
import { mobileTaken, normalizeMobile, useVerifiedMobile } from './phoneVerification';

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
  // Accounts from before approvals have no photo, so an empty hash is never a match.
  if (file.hash && db().prepare("SELECT 1 FROM customer_approvals WHERE id_hash = ? AND status <> 'rejected' AND username <> ?").get(file.hash, username)) {
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
  // The mobile number must be verified by code first, and is saved in one format.
  input.contact = normalizeMobile(input.contact) || input.contact;
  if (!input.phoneToken) throw invalid('contact', 'Verify your mobile number with the code we text you.');
  const id = readIdNumber(input.idNumber);
  const file = await readValidId(form);
  checkIdFree(id, file);
  const stored = storeId(file);
  try {
    // The account, its Pending approval and its ID are saved together.
    return await registerAccount('customer', request, input, (username) => {
      const time = now();
      if (mobileTaken(input.contact, username)) throw invalid('contact', 'This mobile number is already registered to an account.');
      const mobile = useVerifiedMobile({ contact: input.contact, purpose: 'register', token: input.phoneToken });
      db().prepare("UPDATE customers SET profile = json_set(profile, '$.contactVerifiedAt', ?) WHERE username = ?").run(mobile.verifiedAt, username);
      db().prepare(`INSERT INTO customer_approvals (username, status, id_number, id_key, id_name, id_mime, id_size, id_stored, id_hash, submitted_at, updated_at)
        VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(username, id.number, id.key, file.name, file.mime, file.bytes.length, stored, file.hash, time, time);
      record(username, 'submitted', username);
      notifyCustomer(username, 'Pending Verification', 'We received your valid ID. Our team verifies it, then you can start shopping.', '/profile');
      askAdmins(username, input, 'New customer verification request', 'registered and submitted a valid ID');
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

// Tells administrators who review customers that one is waiting. Runs inside the caller's transaction.
function askAdmins(username, profile, title, what) {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || username;
  notifyAdmins('customers', title, `${name} (@${username}) ${what}. Review it in Customer Approval.`, `/admin/customers?tab=pending&open=${encodeURIComponent(username)}`);
}

// Sends the account back to Pending Verification, for an administrator to check again. Runs inside the caller's transaction.
function sendForReview(row, action, title, body, fields = '', values = []) {
  const time = now();
  const changed = db().prepare(`UPDATE customer_approvals SET status = 'pending', reason = ''${fields}, submitted_at = ?, decided_at = NULL, decided_by = '', updated_at = ? WHERE username = ? AND status = ?`)
    .run(...values, time, time, row.username, row.status).changes;
  if (!changed) throw new ApiError(409, 'Your account has changed. Refresh and try again.');
  record(row.username, action, row.username);
  notifyCustomer(row.username, title, body, '/profile');
  askAdmins(row.username, JSON.parse(row.profile), 'Customer verification request', action === 'details_changed' ? 'changed their name, which must match their valid ID' : 'submitted a valid ID');
}

// A customer changes their valid ID: a new photo, a new number, or both. At any stage this sends
// the account for approval again. A rejected customer applies again the same way.
export async function updateIdentity(username, request) {
  const row = findApproval(username);
  const form = await request.formData();
  const id = readIdNumber(form.get('idNumber'));
  const upload = form.get('validId');
  const file = upload instanceof File && upload.size ? await readValidId(form) : null;
  if (!file && !row.id_stored) throw invalid('validId', 'Upload a clear photo of your valid ID.');
  if (!file && id.key === row.id_key) throw invalid('idNumber', 'Change your ID number or choose a new photo to update your ID.');
  checkIdFree(id, file || { hash: row.id_hash }, row.username);
  const stored = file ? storeId(file) : null;
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const photo = file ? ', id_name = ?, id_mime = ?, id_size = ?, id_stored = ?, id_hash = ?' : '';
    sendForReview(row, 'resubmitted', 'Pending Verification', 'We received your valid ID. Our team verifies it, then you can shop again.',
      `, id_number = ?, id_key = ?${photo}`, [id.number, id.key, ...(file ? [file.name, file.mime, file.bytes.length, stored, file.hash] : [])]);
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    if (stored) rmSync(path.join(ID_DIR, stored), { force: true });
    throw duplicate(err);
  }
  if (file && row.id_stored) rmSync(path.join(ID_DIR, row.id_stored), { force: true });
  return profileFor(row.username);
}

// The name on the account must match the ID, so changing it is checked again too.
export const IDENTITY_FIELDS = ['firstName', 'middleName', 'lastName', 'suffix'];
const EDITABLE = CUSTOMER_PROFILE_SECTIONS.flatMap((section) => section.fields);

// A customer edits their email, contact number, name and address. A changed name sends the
// account for approval again, in the same transaction.
export function updateProfile(username, input) {
  if (typeof input !== 'object' || input === null) throw new ApiError(400, 'That request could not be read.');
  const row = findApproval(username);
  checkFields(EDITABLE, input);
  const profile = JSON.parse(row.profile);
  const email = String(input.email).trim().toLowerCase();
  if (email !== row.email && db().prepare('SELECT 1 FROM customers WHERE email = ? AND username <> ?').get(email, row.username)) {
    throw new ApiError(409, 'An account with this email already exists.', { email: 'An account with this email already exists.' });
  }
  const next = { ...profile, ...Object.fromEntries(EDITABLE.filter((field) => field.name !== 'email').map(({ name }) => [name, String(input[name] ?? '').trim()])) };
  // The same number written differently isn't a change. A new one must be verified by code.
  const mobile = normalizeMobile(next.contact);
  const contactChanged = mobile !== normalizeMobile(profile.contact);
  next.contact = contactChanged ? mobile || next.contact : profile.contact;
  const nameChanged = IDENTITY_FIELDS.some((name) => (next[name] || '') !== (profile[name] || ''));
  const changed = email !== row.email || EDITABLE.some(({ name }) => name !== 'email' && next[name] !== (profile[name] ?? ''));
  if (!changed) throw new ApiError(422, 'Nothing has changed yet.');
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    if (contactChanged) {
      if (mobileTaken(mobile, row.username)) throw invalid('contact', 'This mobile number is already registered to an account.');
      next.contactVerifiedAt = useVerifiedMobile({ contact: mobile, purpose: 'profile', username: row.username, token: input.phoneToken }).verifiedAt;
    }
    database.prepare('UPDATE customers SET email = ?, profile = ? WHERE username = ?').run(email, JSON.stringify(next), row.username);
    if (nameChanged && row.status !== 'pending') sendForReview(row, 'details_changed', 'Pending Verification', 'Your name must match your valid ID, so our team verifies it again before you can buy.');
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    if (/UNIQUE/.test(err.message)) throw new ApiError(409, 'An account with this email already exists.', { email: 'An account with this email already exists.' });
    throw err;
  }
  return { ...profileFor(row.username), reviewing: nameChanged && row.status !== 'pending', contactVerified: contactChanged };
}

// Everything My Profile shows. The ID number is the customer's own, so it is shown in full.
export function profileFor(username) {
  const row = findApproval(username);
  const profile = JSON.parse(row.profile);
  return {
    username: row.username, email: row.email, profile, registeredAt: row.registered_at,
    approval: { status: row.status, verification: verificationOf(row.status), reason: row.status === 'rejected' ? row.reason : '', submittedAt: row.submitted_at, decidedAt: row.decided_at, verifiedBefore: Boolean(row.approved_at) },
    idNumber: row.id_number, idFile: row.id_stored ? { name: row.id_name, size: row.id_size, at: row.updated_at } : null,
  };
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
    status: row.status, reason: row.reason, registeredAt: row.registered_at, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decided_by, verifiedBefore: Boolean(row.approved_at),
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
  approve: { from: ['pending'], status: 'approved', title: 'Your account is Verified', body: () => 'Your identity is verified. You can now check out, see your purchases and chat with shops.' },
  reject: { from: ['pending'], status: 'rejected', needsReason: true, title: 'Verification not approved', body: (reason) => `Your account is Unverified. Reason: ${reason} Resubmit your valid ID in My Profile.` },
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
    const changed = database.prepare(`UPDATE customer_approvals SET status = ?, reason = ?, decided_at = ?, decided_by = ?, updated_at = ?${decision.status === 'approved' ? ', approved_at = COALESCE(approved_at, ?)' : ''} WHERE username = ? AND status = ?`)
      .run(decision.status, decision.needsReason ? text : '', now(), admin.username, now(), ...(decision.status === 'approved' ? [now()] : []), row.username, row.status).changes;
    if (!changed) throw new ApiError(409, 'This registration has changed. Refresh and try again.');
    record(row.username, action, admin.username, text);
    notifyCustomer(row.username, decision.title, decision.body(text), '/profile');
    audit(admin, `customer.${action}`, 'customer', row.username, { reason: text || undefined });
    database.exec('COMMIT');
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
  return customerApprovalDetail(row.username);
}
