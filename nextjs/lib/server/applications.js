// Seller registration approval. Documents are private: they live outside the public uploads
// folder and are only served to the applicant and to administrators with the right permission.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applicationSchema } from '../schemas';
import { audit } from './admin';
import { registerAccount } from './auth';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';
import { csvResponse, isoDate, listQuery, search } from './lists';
import { notifySeller } from './notifications';

const DOCUMENT_DIR = path.join(UPLOAD_DIR, '..', 'documents');
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const STATUS_LINK = '/seller/application';
const DOCUMENT_LABELS = { governmentId: 'Government ID', businessPermit: 'Business Permit' };
const INDIVIDUAL = 'Individual';

const isFile = (value) => value instanceof File && value.size > 0;

function documentType(bytes) {
  const text = (start, end) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (text(1, 4) === 'PNG') return { mime: 'image/png', extension: 'png' };
  if (text(0, 5) === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  return null;
}

async function readDocuments(form, { required }) {
  const files = {};
  const errors = {};
  for (const kind of Object.keys(DOCUMENT_LABELS)) {
    const file = form.get(kind);
    if (isFile(file)) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const type = documentType(bytes);
      if (!type) errors[kind] = 'Use a JPG, PNG or PDF file.';
      else if (bytes.length > MAX_DOCUMENT_BYTES) errors[kind] = 'Files must be 10 MB or smaller.';
      else files[kind] = { ...type, bytes, name: file.name.slice(0, 120) };
    }
  }
  if (required && !files.governmentId && !errors.governmentId) errors.governmentId = 'Upload a valid government ID.';
  const needsPermit = form.get('businessType') !== INDIVIDUAL;
  if (required && needsPermit && !files.businessPermit && !errors.businessPermit) errors.businessPermit = 'Businesses must upload a permit or registration.';
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  return files;
}

function storeDocuments(seller, files) {
  mkdirSync(DOCUMENT_DIR, { recursive: true });
  const db = getDb();
  Object.entries(files).forEach(([kind, file]) => {
    const id = randomUUID();
    const stored = `${id}.${file.extension}`;
    writeFileSync(path.join(DOCUMENT_DIR, stored), file.bytes);
    db.prepare('UPDATE seller_documents SET current = 0 WHERE seller = ? AND kind = ?').run(seller, kind);
    db.prepare('INSERT INTO seller_documents (id, seller, kind, name, mime, size, stored, current, at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, seller, kind, file.name, file.mime, file.bytes.length, stored, Date.now());
  });
}

function record(seller, action, actor, reason = '') {
  getDb().prepare('INSERT INTO seller_application_history (seller, action, actor, reason, at) VALUES (?, ?, ?, ?, ?)').run(seller, action, actor, reason, Date.now());
}

export async function registerSeller(request) {
  const form = await request.formData();
  const input = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'));
  const files = await readDocuments(form, { required: true });
  const account = await registerAccount('seller', request, input);
  const now = Date.now();
  getDb().prepare("INSERT INTO seller_applications (username, status, submitted_at, updated_at) VALUES (?, 'pending', ?, ?)").run(account.username, now, now);
  storeDocuments(account.username, files);
  record(account.username, 'submitted', account.username);
  notifySeller(account.username, 'Application received', 'Your seller application is waiting for admin review.', STATUS_LINK);
  return { ...account, applicationStatus: 'pending' };
}

function findApplication(username) {
  const row = getDb().prepare(`
    SELECT a.*, s.email, s.profile, s.created_at AS registered_at FROM seller_applications a
    JOIN sellers s ON s.username = a.username WHERE a.username = ?
  `).get(username);
  if (!row) throw new ApiError(404, 'We could not find that application.');
  return row;
}

const toDocument = ({ id, kind, name, mime, size, at, current }) => ({ id, kind, label: DOCUMENT_LABELS[kind], name, mime, size, at, current: Boolean(current) });

function documentsFor(seller) {
  return getDb().prepare('SELECT * FROM seller_documents WHERE seller = ? ORDER BY at DESC').all(seller).map(toDocument);
}

const historyFor = (seller) => getDb().prepare('SELECT action, actor, reason, at FROM seller_application_history WHERE seller = ? ORDER BY id DESC').all(seller);

// The applicant's view. Reviewer names stay in the Admin Console.
export function applicationFor(seller) {
  const row = findApplication(seller);
  return {
    status: row.status,
    reason: row.reason,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    profile: { ...JSON.parse(row.profile), email: row.email },
    documents: documentsFor(seller).filter((doc) => doc.current),
    history: historyFor(seller).map(({ action, reason, at }) => ({ action, reason, at })),
  };
}

const RESUBMIT_FROM = ['needs_info', 'disapproved'];

export async function resubmitApplication(seller, request) {
  const row = findApplication(seller);
  if (!RESUBMIT_FROM.includes(row.status)) throw new ApiError(409, 'This application can\'t be changed right now.');
  const form = await request.formData();
  const profile = JSON.parse(row.profile);
  const errors = {};
  const updates = {};
  applicationSchema().flatMap((section) => section.fields).filter((field) => field.type !== 'file').forEach((field) => {
    const value = typeof form.get(field.name) === 'string' ? form.get(field.name).trim() : '';
    if (!value && !field.optional) errors[field.name] = `${field.label} is required.`;
    else if (value.length > (field.maxlength || 150)) errors[field.name] = 'That is too long.';
    else if (value && field.options && !field.options.includes(value)) errors[field.name] = `Choose a valid ${field.label.toLowerCase()}.`;
    else if (value && field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) errors[field.name] = field.hint || `Enter a valid ${field.label.toLowerCase()}.`;
    updates[field.name] = value;
  });
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  const files = await readDocuments(form, { required: false });
  const db = getDb();
  const permit = db.prepare("SELECT 1 FROM seller_documents WHERE seller = ? AND kind = 'businessPermit' AND current = 1").get(seller);
  if (updates.businessType !== INDIVIDUAL && !permit && !files.businessPermit) {
    throw new ApiError(422, 'Check the highlighted fields.', { businessPermit: 'Businesses must upload a permit or registration.' });
  }
  storeDocuments(seller, files);
  db.prepare('UPDATE sellers SET profile = ? WHERE username = ?').run(JSON.stringify({ ...profile, ...updates }), seller);
  db.prepare("UPDATE seller_applications SET status = 'pending', reason = '', submitted_at = ?, updated_at = ? WHERE username = ?").run(Date.now(), Date.now(), seller);
  record(seller, 'resubmitted', seller);
  notifySeller(seller, 'Application resubmitted', 'Your updated application is waiting for admin review.', STATUS_LINK);
  return applicationFor(seller);
}

export function documentResponse(seller, id) {
  const row = getDb().prepare('SELECT * FROM seller_documents WHERE id = ? AND seller = ?').get(String(id), seller);
  if (!row) throw new ApiError(404, 'File not found.');
  return new Response(readFileSync(path.join(DOCUMENT_DIR, row.stored)), {
    headers: {
      'Content-Type': row.mime,
      'Content-Disposition': `inline; filename="${row.kind}.${row.stored.split('.').pop()}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    },
  });
}

const STATUS_FILTERS = { pending: ['pending', 'needs_info'], approved: ['approved'], disapproved: ['disapproved'], suspended: ['suspended'] };

export function applicationCounts() {
  const counts = Object.fromEntries(getDb().prepare('SELECT status, COUNT(*) AS c FROM seller_applications GROUP BY status').all().map((row) => [row.status, row.c]));
  return { pending: (counts.pending || 0) + (counts.needs_info || 0), approved: counts.approved || 0, disapproved: counts.disapproved || 0, suspended: counts.suspended || 0 };
}

const toSummary = (row) => {
  const profile = JSON.parse(row.profile);
  return { username: row.username, email: row.email, shopName: profile.shopName, businessName: profile.businessName, businessType: profile.businessType, contact: profile.contact, status: row.status, reason: row.reason, submittedAt: row.submitted_at, decidedAt: row.decided_at, decidedBy: row.decided_by };
};

export function listApplications(params) {
  const statuses = STATUS_FILTERS[params.get('tab')];
  const where = [
    ...(statuses ? [[`a.status IN (${statuses.map(() => '?').join(', ')})`, ...statuses]] : []),
    ...search(params, ['a.username', 's.email', 's.profile']),
  ];
  const { rows, ...page } = listQuery(getDb(), {
    select: 'a.*, s.email, s.profile',
    from: 'seller_applications a JOIN sellers s ON s.username = a.username',
    where,
    sorts: { submitted: 'a.submitted_at', decided: 'a.decided_at', status: 'a.status', seller: 'a.username' },
    defaultSort: 'submitted',
  }, params);
  const applications = rows.map(toSummary);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-seller-applications.csv', [
      ['Username', (a) => a.username], ['Shop', (a) => a.shopName], ['Business', (a) => a.businessName], ['Type', (a) => a.businessType], ['Email', (a) => a.email], ['Status', (a) => a.status], ['Reason', (a) => a.reason], ['Submitted', (a) => isoDate(a.submittedAt)], ['Decided', (a) => isoDate(a.decidedAt)], ['Reviewer', (a) => a.decidedBy],
    ], applications);
  }
  return Response.json({ ...page, rows: applications, counts: applicationCounts() });
}

export function applicationDetail(username) {
  const row = findApplication(username);
  return { ...toSummary(row), profile: JSON.parse(row.profile), registeredAt: row.registered_at, documents: documentsFor(row.username), history: historyFor(row.username) };
}

const DECISIONS = {
  approve: {
    from: ['pending', 'needs_info', 'suspended'], status: 'approved', title: 'Your seller account is approved', body: () => 'Seller Centre is now open. You can start listing products.', link: '/seller/dashboard',
  },
  disapprove: {
    from: ['pending', 'needs_info'], status: 'disapproved', needsReason: true, title: 'Your seller application was disapproved', body: (reason) => `Reason: ${reason} You can update your details and apply again.`,
  },
  request_info: {
    from: ['pending'], status: 'needs_info', needsReason: true, title: 'More information is needed', body: (reason) => `Our reviewer asked: ${reason}`,
  },
  suspend: {
    from: ['approved'], status: 'suspended', needsReason: true, title: 'Your seller account was suspended', body: (reason) => `Reason: ${reason} Your products are hidden until this is resolved.`,
  },
};

export function decideApplication(admin, username, action, reason) {
  const decision = Object.hasOwn(DECISIONS, action) ? DECISIONS[action] : null;
  if (!decision) throw new ApiError(400, 'Unknown action.');
  const row = findApplication(username);
  if (!decision.from.includes(row.status)) throw new ApiError(409, 'This application has changed. Refresh and try again.');
  const text = String(reason || '').trim();
  if (decision.needsReason && (text.length < 10 || text.length > 500)) throw new ApiError(422, 'Enter a reason of 10 to 500 characters.', { reason: 'Enter a reason of 10 to 500 characters.' });

  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE seller_applications SET status = ?, reason = ?, decided_at = ?, decided_by = ?, updated_at = ? WHERE username = ?')
      .run(decision.status, decision.needsReason ? text : '', Date.now(), admin.username, Date.now(), row.username);
    record(row.username, action, admin.username, text);
    notifySeller(row.username, decision.title, decision.body(text), decision.link || STATUS_LINK);
    audit(admin, `seller.${action}`, 'seller', row.username, { reason: text });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return applicationDetail(row.username);
}
