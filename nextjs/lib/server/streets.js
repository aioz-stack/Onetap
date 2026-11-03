// Tuguegarao streets for the standard address (lib/address.js). The `streets` table is the list
// the Street dropdowns show, by barangay. It starts from lib/tuguegaraoStreets.json, built from
// OpenStreetMap by scripts/import-tuguegarao-streets.mjs: new streets in the file are added on
// start, and nothing an administrator changed is overwritten. Anyone filling in an address can
// report a missing street. A pending request can already be used in that barangay's addresses,
// and an administrator with the `logistics` permission approves it into the list or rejects it.

import { createHash } from 'node:crypto';
import { BARANGAYS, CITY, HOUSE_NUMBER_MAX, isBarangay, STREET_NAME_MAX, STREET_NAME_PATTERN } from '../address';
import seed from '../tuguegaraoStreets.json';
import { audit } from './admin';
import { getDb } from './db';
import { ApiError } from './errors';
import { csvResponse, isoDate, listQuery, search } from './lists';
import { notifyAdmins, notifyCourier, notifyCustomer, notifySeller } from './notifications';

const db = () => getDb();
const now = () => Date.now();
const REQUESTS_PER_DAY = 10;
const DAY = 24 * 60 * 60 * 1000;
export const STREET_REQUEST_STATUSES = ['pending', 'approved', 'rejected'];

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  const insert = db().prepare("INSERT OR IGNORE INTO streets (barangay, name, source, created_at, updated_at) VALUES (?, ?, 'osm', ?, ?)");
  const time = now();
  // One transaction for speed, unless the caller is already in one.
  const own = !db().isTransaction;
  if (own) db().exec('BEGIN');
  try {
    Object.entries(seed.barangays).forEach(([barangay, names]) => {
      if (isBarangay(barangay)) names.forEach((name) => insert.run(barangay, name, time, time));
    });
    if (own) db().exec('COMMIT');
  } catch (err) {
    if (own) db().exec('ROLLBACK');
    throw err;
  }
  seeded = true;
}

const cleanName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// A barangay's streets for the dropdown, A to Z, with any street still awaiting review marked.
export function streetsFor(barangay) {
  ensureSeeded();
  if (!isBarangay(barangay)) throw new ApiError(404, 'Choose a barangay of Tuguegarao City.');
  const listed = db().prepare('SELECT name FROM streets WHERE barangay = ? AND hidden = 0 ORDER BY name').all(barangay).map((row) => ({ name: row.name, pending: false }));
  const pending = db().prepare("SELECT name FROM street_requests WHERE barangay = ? AND status = 'pending' ORDER BY name").all(barangay)
    .filter((row) => !listed.some((street) => street.name.toLowerCase() === row.name.toLowerCase()))
    .map((row) => ({ name: row.name, pending: true }));
  return [...listed, ...pending].sort((a, b) => a.name.localeCompare(b.name));
}

// The saved spelling of a street in that barangay's list, or of a pending request for it, or null.
export function knownStreet(barangay, street) {
  ensureSeeded();
  const name = cleanName(street);
  if (!isBarangay(barangay) || !name) return null;
  return db().prepare('SELECT name FROM streets WHERE barangay = ? AND name = ? AND hidden = 0').get(barangay, name)?.name
    || db().prepare("SELECT name FROM street_requests WHERE barangay = ? AND name = ? AND status = 'pending'").get(barangay, name)?.name
    || null;
}

// Field errors for a standard address ({ barangay, street, houseNumber }), for every form that saves one.
export function addressErrors(data) {
  const errors = {};
  const barangay = cleanName(data?.barangay);
  if (!isBarangay(barangay)) errors.barangay = 'Choose your barangay from the list.';
  else if (!cleanName(data?.street)) errors.street = 'Choose your street from the list.';
  else if (!knownStreet(barangay, data.street)) errors.street = `Choose a street in ${barangay} from the list, or report it as missing.`;
  return errors;
}

// The address as stored: the street in its listed spelling and the house number tidied.
export function standardAddress(data) {
  const barangay = cleanName(data.barangay);
  return { barangay, street: knownStreet(barangay, data.street) || cleanName(data.street), houseNumber: cleanName(data.houseNumber) };
}

// Whether a saved address is in the standard format and its street still on the list (or awaiting
// review). Older free-text addresses and streets an administrator rejected or hid are not.
export const isCurrentAddress = (address) => Boolean(address) && isBarangay(address.barangay) && Boolean(knownStreet(address.barangay, address.street));

const ipHash = (request) => createHash('sha256').update((request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local').digest('hex');

// Reports a missing street. `who` is { role, username }, or { role: 'guest' } during sign-up.
// Returns the street to use now: the listed one if it turns out to exist, or the pending request.
export function requestStreet(request, who, input) {
  ensureSeeded();
  const barangay = cleanName(input?.barangay);
  const name = cleanName(input?.name);
  const note = cleanName(input?.note).slice(0, 300);
  if (!isBarangay(barangay)) throw new ApiError(422, 'Choose your barangay first.', { barangay: 'Choose your barangay first.' });
  if (!new RegExp(`^(?:${STREET_NAME_PATTERN})$`, 'u').test(name)) {
    throw new ApiError(422, `Enter the street's name, 2 to ${STREET_NAME_MAX} characters.`, { name: `Enter the street's name, 2 to ${STREET_NAME_MAX} characters.` });
  }
  const listed = db().prepare('SELECT name, hidden FROM streets WHERE barangay = ? AND name = ?').get(barangay, name);
  if (listed && !listed.hidden) return { name: listed.name, status: 'listed' };
  const open = db().prepare("SELECT name FROM street_requests WHERE barangay = ? AND name = ? AND status = 'pending'").get(barangay, name);
  if (open) return { name: open.name, status: 'pending' };
  if (db().prepare("SELECT 1 FROM street_requests WHERE barangay = ? AND name = ? AND status = 'rejected'").get(barangay, name)) {
    throw new ApiError(409, `${name} was checked and isn't a street in ${barangay}. Choose another street, or contact support if this is wrong.`, { name: "This street was checked and isn't in that barangay." });
  }
  const hash = ipHash(request);
  const recent = db().prepare('SELECT COUNT(*) AS c FROM street_requests WHERE (ip_hash = ? OR (username <> \'\' AND username = ? AND role = ?)) AND created_at > ?').get(hash, who.username || '', who.role, now() - DAY).c;
  if (recent >= REQUESTS_PER_DAY) throw new ApiError(429, `You can report up to ${REQUESTS_PER_DAY} streets a day. Try again tomorrow.`);
  db().prepare('INSERT INTO street_requests (barangay, name, note, role, username, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(barangay, name, note, who.role, who.username || '', hash, now());
  notifyAdmins('logistics', 'Missing street reported', `${name}, ${barangay}${who.username ? `, from ${who.role} ${who.username}` : ''}. Approve it to add it to the street list.`, '/admin/streets');
  return { name, status: 'pending' };
}

const toRequest = (row) => ({
  id: row.id, barangay: row.barangay, name: row.name, note: row.note, role: row.role, username: row.username,
  status: row.status, reason: row.reason, createdAt: row.created_at, decidedAt: row.decided_at, decidedBy: row.decided_by,
  // How many saved addresses already use it, so a rejection's effect is clear.
  inUse: addressesUsing(row.barangay, row.name),
});

function addressesUsing(barangay, street) {
  const like = (table) => db().prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE json_extract(profile, '$.barangay') = ? AND json_extract(profile, '$.street') = ? COLLATE NOCASE`).get(barangay, street).c;
  return like('customers') + like('sellers');
}

export function streetRequestCounts() {
  return Object.fromEntries(STREET_REQUEST_STATUSES.map((status) => [status, db().prepare('SELECT COUNT(*) AS c FROM street_requests WHERE status = ?').get(status).c]));
}

export function listStreetRequests(params) {
  const status = params.get('tab');
  const barangay = params.get('barangay');
  const where = [
    ...(STREET_REQUEST_STATUSES.includes(status) ? [['status = ?', status]] : []),
    ...(isBarangay(barangay) ? [['barangay = ?', barangay]] : []),
    ...search(params, ['name', 'barangay', 'username', 'note']),
  ];
  const { rows, ...page } = listQuery(db(), { from: 'street_requests', where, sorts: { created: 'created_at', decided: 'decided_at', name: 'name', barangay: 'barangay' }, defaultSort: 'created' }, params);
  const requests = rows.map(toRequest);
  if (params.get('format') === 'csv') {
    return csvResponse('onetap-street-requests.csv', [
      ['Street', (r) => r.name], ['Barangay', (r) => r.barangay], ['Note', (r) => r.note], ['From', (r) => (r.username ? `${r.role} ${r.username}` : r.role)],
      ['Status', (r) => r.status], ['Reason', (r) => r.reason], ['Reported', (r) => isoDate(r.createdAt)], ['Decided', (r) => isoDate(r.decidedAt)], ['Reviewer', (r) => r.decidedBy],
    ], requests);
  }
  return Response.json({ ...page, rows: requests, counts: streetRequestCounts(), source: streetSource() });
}

function tellRequester(row, title, body) {
  if (!row.username) return;
  if (row.role === 'customer') notifyCustomer(row.username, title, body, '/profile');
  else if (row.role === 'seller') notifySeller(row.username, title, body, '/seller/dashboard');
  else if (row.role === 'courier') notifyCourier(row.username, title, body, '/courier/profile');
}

// Approve adds the street to its barangay's list. Reject needs a reason, and addresses that used it
// are asked to choose another street.
export function decideStreetRequest(admin, id, input) {
  const action = input?.action;
  const reason = cleanName(input?.reason);
  if (!['approve', 'reject'].includes(action)) throw new ApiError(400, 'Choose approve or reject.');
  if (action === 'reject' && (reason.length < 5 || reason.length > 300)) throw new ApiError(422, 'Give a reason of 5 to 300 characters.', { reason: 'Give a reason of 5 to 300 characters.' });
  db().exec('BEGIN IMMEDIATE');
  try {
    const row = db().prepare('SELECT * FROM street_requests WHERE id = ?').get(Number(id));
    if (!row) throw new ApiError(404, 'That request no longer exists.');
    if (row.status !== 'pending') throw new ApiError(409, `This request was already ${row.status}.`);
    const time = now();
    db().prepare('UPDATE street_requests SET status = ?, reason = ?, decided_at = ?, decided_by = ? WHERE id = ?')
      .run(action === 'approve' ? 'approved' : 'rejected', reason, time, admin.username, row.id);
    if (action === 'approve') {
      db().prepare("INSERT INTO streets (barangay, name, source, created_at, updated_at) VALUES (?, ?, 'request', ?, ?) ON CONFLICT (barangay, name) DO UPDATE SET hidden = 0, updated_at = excluded.updated_at")
        .run(row.barangay, row.name, time, time);
      tellRequester(row, 'Street added', `${row.name} is now on the street list for ${row.barangay}.`);
    } else {
      tellRequester(row, 'Street not added', `${row.name} wasn't added to ${row.barangay}: ${reason} Choose another street in your address.`);
    }
    audit(admin, action === 'approve' ? 'street_request.approved' : 'street_request.rejected', 'street_request', row.id, { barangay: row.barangay, name: row.name, reason });
    db().exec('COMMIT');
    return toRequest(db().prepare('SELECT * FROM street_requests WHERE id = ?').get(row.id));
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }
}

// Every street of one barangay for administrators, hidden ones included, with where each came from.
export function adminStreets(barangay) {
  ensureSeeded();
  if (!isBarangay(barangay)) throw new ApiError(404, 'Choose a barangay of Tuguegarao City.');
  return db().prepare('SELECT * FROM streets WHERE barangay = ? ORDER BY name').all(barangay)
    .map((row) => ({ id: row.id, name: row.name, source: row.source, hidden: Boolean(row.hidden), inUse: addressesUsing(barangay, row.name) }));
}

// Administrators add a street they have checked, or hide one that is wrong (it stays on saved
// addresses, which are then asked to choose again), or show it again.
export function changeStreet(admin, input) {
  ensureSeeded();
  const time = now();
  if (input?.action === 'add') {
    const barangay = cleanName(input.barangay);
    const name = cleanName(input.name);
    if (!isBarangay(barangay)) throw new ApiError(422, 'Choose a barangay.');
    if (!new RegExp(`^(?:${STREET_NAME_PATTERN})$`, 'u').test(name)) throw new ApiError(422, `Enter a street name of 2 to ${STREET_NAME_MAX} characters.`, { name: `Enter a street name of 2 to ${STREET_NAME_MAX} characters.` });
    db().prepare("INSERT INTO streets (barangay, name, source, created_at, updated_at) VALUES (?, ?, 'admin', ?, ?) ON CONFLICT (barangay, name) DO UPDATE SET hidden = 0, updated_at = excluded.updated_at").run(barangay, name, time, time);
    audit(admin, 'street.added', 'street', `${barangay}/${name}`, { barangay, name });
    return adminStreets(barangay);
  }
  if (input?.action === 'hide' || input?.action === 'show') {
    const row = db().prepare('SELECT * FROM streets WHERE id = ?').get(Number(input.id));
    if (!row) throw new ApiError(404, 'That street no longer exists.');
    db().prepare('UPDATE streets SET hidden = ?, updated_at = ? WHERE id = ?').run(input.action === 'hide' ? 1 : 0, time, row.id);
    audit(admin, input.action === 'hide' ? 'street.hidden' : 'street.shown', 'street', row.id, { barangay: row.barangay, name: row.name });
    return adminStreets(row.barangay);
  }
  throw new ApiError(400, 'That change could not be read.');
}

export const streetSource = () => ({ source: seed.source, license: seed.license, osmDataAt: seed.osmDataAt, method: seed.method, barangays: BARANGAYS.length });

// Saves a standard address on its own: a seller's store address from Seller Centre, or a logistics
// partner's hub from its Company Profile. Returns the saved parts.
export function checkedAddress(input) {
  if (typeof input !== 'object' || input === null) throw new ApiError(400, 'That request could not be read.');
  const errors = addressErrors(input);
  if (cleanName(input.houseNumber).length > HOUSE_NUMBER_MAX) errors.houseNumber = `Use up to ${HOUSE_NUMBER_MAX} characters.`;
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  return { ...standardAddress(input), ...CITY };
}
