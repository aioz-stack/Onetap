// Logins for the Logistics Partner Panel. Each belongs to one partner, whose ID comes from here
// and never from the panel. Passwords only pass through this file to be hashed.

import { audit } from './admin';
import { endSessions, hashPassword } from './auth';
import { loadPartner } from './couriers';
import { getDb } from './db';
import { ApiError } from './errors';
import { transaction } from './shipments';

// Emails are optional for a login but required by the table, so this stands in and is never shown.
const NO_EMAIL = '@courier.onetap.local';

const db = () => getDb();

const toUser = (row) => {
  const { name, disabled } = JSON.parse(row.profile);
  return { username: row.username, email: row.email.endsWith(NO_EMAIL) ? '' : row.email, name, disabled: Boolean(disabled), createdAt: row.created_at };
};

const partnerRows = (partnerId) => db().prepare('SELECT * FROM courier_users ORDER BY created_at').all().filter((row) => JSON.parse(row.profile).partnerId === partnerId);

export const listCourierUsers = (partnerId) => partnerRows(partnerId).map(toUser);

export function countCourierUsers(partnerId) {
  const users = listCourierUsers(partnerId);
  return { total: users.length, active: users.filter((user) => !user.disabled).length };
}

// Staff work in the panel while their partner is active. Once it is deactivated they keep the
// panel only until their open parcels are finished, so nothing on the road is stranded, and a
// new partner stays closed until it is first activated. This is read on every request.
export function panelAccess(partnerId) {
  const { c: openParcels } = db().prepare("SELECT COUNT(*) AS c FROM shipments WHERE partner_id = ? AND status NOT IN ('pending', 'cancelled', 'delivered', 'return_to_sender')").get(partnerId);
  return { open: loadPartner(partnerId).status === 'active' || openParcels > 0, openParcels };
}

function checkNewPassword(password, confirmPassword) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new ApiError(422, 'Use a password of 12 to 128 characters.', { password: 'Use 12 to 128 characters.' });
  if (password !== confirmPassword) throw new ApiError(422, 'The passwords do not match.', { confirmPassword: 'The passwords do not match.' });
}

function cleanDetails({ username, email, name }) {
  const clean = { username: String(username ?? '').trim(), email: String(email ?? '').trim().toLowerCase(), name: String(name ?? '').trim().slice(0, 100) };
  if (!/^[A-Za-z0-9_.]{4,30}$/.test(clean.username)) throw new ApiError(422, 'Use a username of 4 to 30 letters, numbers, dots or underscores.', { username: 'Use 4 to 30 letters, numbers, dots or underscores.' });
  if (clean.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean.email)) throw new ApiError(422, 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  if (!clean.name) throw new ApiError(422, 'Enter a name.', { name: 'Enter a name.' });
  return { ...clean, email: clean.email || `${clean.username.toLowerCase()}${NO_EMAIL}` };
}

function checkAvailable({ username, email }, current = '') {
  const taken = (column, value) => db().prepare(`SELECT 1 FROM courier_users WHERE ${column} = ? AND username <> ?`).get(value, current);
  if (taken('username', username)) throw new ApiError(409, 'That username is already in use.', { username: 'That username is already in use.' });
  if (taken('email', email)) throw new ApiError(409, 'That email is already in use.', { email: 'That email is already in use.' });
}

// Hashing is slow and can't run in a transaction, so a new login is prepared first. `createCourierUser`
// then checks again and saves it, which lets a new partner and its login be saved together.
export async function prepareCourierUser(input) {
  const details = cleanDetails(input);
  checkNewPassword(input.password, input.confirmPassword);
  checkAvailable(details);
  return { ...details, active: input.active !== false, hash: await hashPassword(input.password) };
}

export function createCourierUser(admin, partnerId, { username, email, name, active, hash }) {
  checkAvailable({ username, email });
  db().prepare('INSERT INTO courier_users (username, email, password, profile, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, email, hash, JSON.stringify({ name, partnerId, disabled: !active }), Date.now());
  audit(admin, 'courier_user.created', 'partner', partnerId, { username, active });
}

// Signs the user out when their login changes or they lose access, but not for a new name or email.
export async function updateCourierUser(admin, partnerId, username, input) {
  const resetting = input.password !== undefined;
  if (resetting) checkNewPassword(input.password, input.confirmPassword);
  const hash = resetting ? await hashPassword(input.password) : null;
  transaction(() => {
    const row = db().prepare('SELECT * FROM courier_users WHERE username = ?').get(String(username));
    const profile = row ? JSON.parse(row.profile) : null;
    if (!row || profile.partnerId !== partnerId) throw new ApiError(404, 'We could not find that user.');
    const details = cleanDetails({ ...toUser(row), ...input });
    checkAvailable(details, row.username);
    const disabled = input.disabled === undefined ? Boolean(profile.disabled) : Boolean(input.disabled);
    const renamed = details.username !== row.username;
    if (renamed || resetting || (disabled && !profile.disabled)) endSessions('courier', row.username);
    db().prepare('UPDATE courier_users SET username = ?, email = ?, password = ?, profile = ? WHERE username = ?')
      .run(details.username, details.email, hash || row.password, JSON.stringify({ ...profile, name: details.name, disabled }), row.username);
    audit(admin, 'courier_user.updated', 'partner', partnerId, { username: details.username, previousUsername: renamed ? row.username : undefined, disabled, passwordChanged: resetting });
  });
}
