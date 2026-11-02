// Administrator access: sessions, permissions, the audit log and team management.

import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { ADMIN_ROLES, can } from '../adminRoles';
import { checkPassword, currentAccount, endSessions, hashPassword, loginAccount } from './auth';
import { getDb } from './db';
import { ApiError } from './errors';
import { route } from './route';

// A page guard for server components.
export async function pageAdmin(permission) {
  const admin = await currentAccount('admin');
  if (!admin) redirect('/admin/login');
  if (permission && !can(admin, permission)) redirect('/admin');
  return admin;
}

export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) throw new ApiError(403, 'That request came from another site.');
}

// Wraps an admin API route: requires a session, the permission, and a same-site request.
export function adminRoute(permission, handler) {
  return route(async (request, context) => {
    if (request.method !== 'GET') checkOrigin(request);
    const admin = await currentAccount('admin');
    if (!admin) throw new ApiError(401, 'Log in to the Admin Console first.');
    if (permission && !can(admin, permission)) throw new ApiError(403, 'Your role does not allow this.');
    return handler(request, admin, context);
  });
}

export function audit(admin, action, targetType, targetId, detail = {}) {
  getDb().prepare('INSERT INTO admin_audit (admin, role, action, target_type, target_id, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(admin.username, admin.adminRole, action, targetType, String(targetId), JSON.stringify(detail), Date.now());
}

async function createAdmin({ username, email, password, name, adminRole }) {
  getDb().prepare('INSERT INTO admins (username, email, password, profile, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, email, await hashPassword(password), JSON.stringify({ name, adminRole, disabled: false }), Date.now());
}

// The first administrator comes from the server's environment, never from a web form.
export async function adminLogin(request, identifier, password) {
  const db = getDb();
  const { ONETAP_ADMIN_USERNAME: username, ONETAP_ADMIN_PASSWORD: secret } = process.env;
  if (username && secret && !db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
    await createAdmin({ username, email: `${username}@onetap.local`, password: secret, name: 'Administrator', adminRole: 'super_admin' });
  }
  return loginAccount('admin', request, identifier, password);
}

const toMember = (row) => {
  const { name, adminRole, disabled } = JSON.parse(row.profile);
  return { username: row.username, email: row.email, name, adminRole, disabled, createdAt: row.created_at };
};

export function listAdmins() {
  return getDb().prepare('SELECT * FROM admins ORDER BY created_at').all().map(toMember);
}

function checkMember({ username, email, name, adminRole, password }) {
  if (!/^[A-Za-z0-9_.]{4,30}$/.test(username || '')) throw new ApiError(422, 'Use a username of 4 to 30 letters, numbers, dots or underscores.', { username: 'Use 4 to 30 letters, numbers, dots or underscores.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw new ApiError(422, 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  if (!name?.trim()) throw new ApiError(422, 'Enter a name.', { name: 'Enter a name.' });
  if (!ADMIN_ROLES[adminRole]) throw new ApiError(422, 'Choose a role.');
  if (typeof password !== 'string' || password.length < 12) throw new ApiError(422, 'Use a password of at least 12 characters.', { password: 'Use at least 12 characters.' });
}

export async function addAdmin(actor, input) {
  checkMember(input);
  const db = getDb();
  if (db.prepare('SELECT 1 FROM admins WHERE username = ? OR email = ?').get(input.username, input.email)) {
    throw new ApiError(409, 'That username or email is already in use.', { username: 'That username or email is already in use.' });
  }
  await createAdmin({ ...input, name: input.name.trim() });
  audit(actor, 'admin.created', 'admin', input.username, { role: input.adminRole });
}

export function updateAdmin(actor, username, { adminRole, disabled }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!row) throw new ApiError(404, 'We could not find that administrator.');
  if (row.username === actor.username) throw new ApiError(409, 'You cannot change your own role or access.');
  if (adminRole !== undefined && !ADMIN_ROLES[adminRole]) throw new ApiError(422, 'Choose a role.');
  const profile = JSON.parse(row.profile);
  const next = { ...profile, adminRole: adminRole ?? profile.adminRole, disabled: disabled ?? profile.disabled };
  db.prepare('UPDATE admins SET profile = ? WHERE username = ?').run(JSON.stringify(next), row.username);
  if (next.disabled || next.adminRole !== profile.adminRole) endSessions('admin', row.username);
  audit(actor, 'admin.updated', 'admin', row.username, { role: next.adminRole, disabled: next.disabled });
}

export async function changeAdminPassword(actor, current, next) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(actor.username);
  if (typeof current !== 'string' || !await checkPassword(current, row.password)) throw new ApiError(422, 'Your current password is not right.', { current: 'Your current password is not right.' });
  if (typeof next !== 'string' || next.length < 12) throw new ApiError(422, 'Use at least 12 characters.', { next: 'Use at least 12 characters.' });
  db.prepare('UPDATE admins SET password = ? WHERE username = ?').run(await hashPassword(next), row.username);
  audit(actor, 'admin.password_changed', 'admin', row.username);
}

export const randomId = () => randomBytes(8).toString('hex');
