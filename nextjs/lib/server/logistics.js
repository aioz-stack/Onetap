// Logistics partners and their API integrations. Responses here never contain credentials:
// the browser only learns which fields have been set.

import { randomBytes } from 'node:crypto';
import { audit } from './admin';
import { adapterFor, callCourier, loadIntegration, loadPartner, secretsFor } from './couriers';
import { countCourierUsers, createCourierUser, panelAccess, prepareCourierUser } from './courierUsers';
import { encrypt } from './crypto';
import { getDb } from './db';
import { ApiError } from './errors';
import { transaction } from './shipments';
import { SHIPPING_ZONES } from '../data';

const SECRET_FIELDS = ['apiKey', 'clientId', 'clientSecret', 'accessToken', 'webhookSecret'];
const SANDBOX_FAULTS = ['none', 'timeout_once', 'error_once', 'lost_response_once', 'always_fail'];

const rows = () => getDb().prepare('SELECT id FROM logistics_partners ORDER BY is_default DESC, name').all().map((row) => loadPartner(row.id));

function deliveryStats(partnerId) {
  const counts = Object.fromEntries(getDb().prepare('SELECT status, COUNT(*) AS c FROM shipments WHERE partner_id = ? GROUP BY status').all(partnerId).map((row) => [row.status, row.c]));
  const delivered = counts.delivered || 0;
  const failed = (counts.failed_delivery || 0) + (counts.return_to_sender || 0);
  return { shipments: Object.values(counts).reduce((sum, c) => sum + c, 0), delivered, failed, successRate: delivered + failed ? delivered / (delivered + failed) : null };
}

function integrationSummary(partner) {
  return ['sandbox', 'production'].map((environment) => {
    const row = loadIntegration(partner.id, environment);
    const secrets = secretsFor(row);
    return {
      environment,
      active: partner.environment === environment,
      status: row?.status || 'not_configured',
      baseUrl: row?.base_url || '',
      lastTestedAt: row?.last_tested_at || null,
      lastError: row?.last_error || '',
      fault: row?.fault || 'none',
      configured: Object.fromEntries(SECRET_FIELDS.map((field) => [field, Boolean(secrets[field])])),
      adapterAvailable: environment === 'sandbox',
    };
  });
}

function apiHealth(partnerId) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const logs = getDb().prepare('SELECT outcome, duration_ms FROM api_logs WHERE partner_id = ? AND at >= ?').all(partnerId, since);
  const failed = logs.filter((log) => log.outcome === 'failed').length;
  const times = logs.map((log) => log.duration_ms);
  return { requests: logs.length, failed, retries: logs.filter((log) => log.outcome === 'retry').length, averageMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null };
}

export function listPartners() {
  return rows().map((partner) => ({ ...partner, stats: deliveryStats(partner.id), accounts: countCourierUsers(partner.id), access: panelAccess(partner.id), integration: integrationSummary(partner).find((item) => item.active) }));
}

export function listIntegrations() {
  return rows().map(({ id, name, status, environment }) => ({ id, name, status, environment, health: apiHealth(id), integrations: integrationSummary(loadPartner(id)) }));
}

// Public rates for checkout and sellers. Only partners ready to take bookings appear.
export function logisticsOptions() {
  return rows().filter((partner) => partner.status === 'active').map(({ id, name, base, perHalfKg, zones, pickupLocations, deliveryLocations, services, forSellers, forCustomers, isDefault }) => ({ id, name, base, perHalfKg, zones, pickupLocations, deliveryLocations, services, forSellers, forCustomers, isDefault }));
}

function cleanPartner(input) {
  const list = (value) => (Array.isArray(value) ? value.filter((item) => SHIPPING_ZONES.includes(item)) : []);
  const name = String(input.name || '').trim();
  if (!name || name.length > 60) throw new ApiError(422, 'Enter a partner name.', { name: 'Enter a partner name.' });
  const base = Object.fromEntries(SHIPPING_ZONES.map((zone) => [zone, Number(input.base?.[zone])]));
  if (Object.values(base).some((rate) => !Number.isFinite(rate) || rate < 0)) throw new ApiError(422, 'Enter a rate for every area.', { base: 'Enter a rate for every area.' });
  const trackingUrl = String(input.trackingUrl || '').trim();
  if (trackingUrl && !/^https:\/\/\S+$/.test(trackingUrl)) throw new ApiError(422, 'Use an https link.', { trackingUrl: 'Use an https link, with {tracking} where the number goes.' });
  const perHalfKg = Number(input.perHalfKg);
  const remittanceDays = Number(input.remittanceDays);
  if (!Number.isFinite(perHalfKg) || perHalfKg < 0) throw new ApiError(422, 'Enter the rate per half kilo.', { perHalfKg: 'Enter a rate.' });
  if (!Number.isInteger(remittanceDays) || remittanceDays < 0 || remittanceDays > 60) throw new ApiError(422, 'Enter 0 to 60 days.', { remittanceDays: 'Enter 0 to 60 days.' });
  return {
    name,
    data: {
      contact: String(input.contact || '').trim().slice(0, 100),
      trackingUrl,
      services: (Array.isArray(input.services) ? input.services : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10),
      zones: list(input.zones),
      pickupLocations: list(input.pickupLocations),
      deliveryLocations: list(input.deliveryLocations),
      base,
      perHalfKg,
      remittanceDays,
      forSellers: Boolean(input.forSellers),
      forCustomers: Boolean(input.forCustomers),
    },
  };
}

// A partner and its first Courier Panel login are saved together, so neither can exist without the other.
export async function addPartner(admin, input) {
  const { name, data } = cleanPartner(input);
  const db = getDb();
  const checkName = () => {
    if (db.prepare('SELECT 1 FROM logistics_partners WHERE name = ?').get(name)) throw new ApiError(409, 'That partner already exists.', { name: 'That partner already exists.' });
  };
  checkName();
  const account = await prepareCourierUser({ ...input.account, email: '', name });
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'partner'}${randomBytes(2).toString('hex')}`;
  return transaction(() => {
    checkName();
    const now = Date.now();
    db.prepare("INSERT INTO logistics_partners (id, name, status, data, created_at, updated_at) VALUES (?, ?, 'inactive', ?, ?, ?)").run(id, name, JSON.stringify(data), now, now);
    db.prepare("INSERT INTO api_integrations (partner_id, environment, secrets, status) VALUES (?, 'sandbox', ?, 'not_tested')")
      .run(id, encrypt({ webhookSecret: randomBytes(32).toString('hex') }));
    audit(admin, 'partner.created', 'partner', id, { name });
    createCourierUser(admin, id, account);
    return loadPartner(id);
  });
}

// Shipments, pickups, orders and COD keep a copy of the courier's name, so a new name goes to them too.
function renameInRecords(id, from, name) {
  const db = getDb();
  ['shipments', 'pickups', 'cod_records', 'cod_remittances'].forEach((table) => db.prepare(`UPDATE ${table} SET partner_name = ? WHERE partner_id = ?`).run(name, id));
  db.prepare('UPDATE pickups SET preferred_courier = ? WHERE preferred_courier = ?').run(name, from);
  db.prepare("UPDATE orders SET data = json_set(data, '$.courier', ?) WHERE json_extract(data, '$.courier') = ? AND id IN (SELECT order_id FROM shipments WHERE partner_id = ?)").run(name, from, id);
}

export function updatePartner(admin, id, input) {
  const { name: previous } = loadPartner(id);
  const { name, data } = cleanPartner(input);
  const db = getDb();
  if (db.prepare('SELECT 1 FROM logistics_partners WHERE name = ? AND id <> ?').get(name, id)) throw new ApiError(409, 'That partner already exists.', { name: 'That partner already exists.' });
  return transaction(() => {
    db.prepare('UPDATE logistics_partners SET name = ?, data = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(data), Date.now(), id);
    if (name !== previous) renameInRecords(id, previous, name);
    audit(admin, 'partner.updated', 'partner', id, { name });
    return loadPartner(id);
  });
}

function setStatus(admin, id, status, action) {
  transaction(() => {
    getDb().prepare('UPDATE logistics_partners SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
    audit(admin, action, 'partner', id);
  });
  return loadPartner(id);
}

// What stops a partner working once it's live. Anything here would leave it active but unusable.
function activationProblem(partner) {
  if (!partner.services.length) return `Add ${partner.name}'s delivery options before activating it.`;
  if (!partner.zones.length) return `Add ${partner.name}'s service coverage before activating it.`;
  if (!partner.pickupLocations.length) return `Add ${partner.name}'s pickup locations before activating it.`;
  if (!partner.deliveryLocations.length) return `Add ${partner.name}'s delivery locations before activating it.`;
  if (!countCourierUsers(partner.id).active) return `${partner.name} has no active login. Add or activate one under Panel Users first.`;
  return '';
}

// Read back from the same queries the panels use, so it reports what actually took effect.
function activationReport(partner) {
  const offered = logisticsOptions().find((option) => option.id === partner.id);
  return {
    environment: partner.environment,
    sellers: Boolean(offered?.forSellers),
    customers: Boolean(offered?.forCustomers),
    logins: countCourierUsers(partner.id).active,
    panelOpen: panelAccess(partner.id).open,
    zones: partner.zones,
    pickupLocations: partner.pickupLocations,
    deliveryLocations: partner.deliveryLocations,
  };
}

// One action that checks the partner can work, proves the courier connection, then puts it live.
// A failure at any step leaves it inactive. Sellers, customers and the Courier Panel read the
// status from the database, so the update below is all they need.
export async function activatePartner(admin, id) {
  const problem = activationProblem(loadPartner(id));
  if (problem) throw new ApiError(409, problem);
  const { ok, message } = await testIntegration(admin, id, loadPartner(id).environment);
  if (!ok) throw new ApiError(409, `The connection test failed, so this courier stays inactive. ${message}`);
  const partner = setStatus(admin, id, 'active', 'partner.activated');
  return { partner, activation: activationReport(partner) };
}

export function deactivatePartner(admin, id) {
  if (loadPartner(id).isDefault) throw new ApiError(409, 'Set another default partner first.');
  return { partner: setStatus(admin, id, 'inactive', 'partner.deactivated') };
}

export function setDefaultPartner(admin, id) {
  const partner = loadPartner(id);
  if (partner.status !== 'active') throw new ApiError(409, 'Only an active partner can be the default.');
  const db = getDb();
  db.exec('UPDATE logistics_partners SET is_default = 0');
  db.prepare('UPDATE logistics_partners SET is_default = 1 WHERE id = ?').run(id);
  audit(admin, 'partner.default_set', 'partner', id);
  return loadPartner(id);
}

function checkEnvironment(environment) {
  if (!['sandbox', 'production'].includes(environment)) throw new ApiError(422, 'Choose Sandbox or Production.');
}

// Blank fields keep what is stored, because saved values are never sent back to the form.
export function saveIntegration(admin, id, environment, input) {
  loadPartner(id);
  checkEnvironment(environment);
  const db = getDb();
  const row = loadIntegration(id, environment);
  const secrets = secretsFor(row);
  SECRET_FIELDS.forEach((field) => {
    const value = input.secrets?.[field];
    if (typeof value === 'string' && value.trim()) secrets[field] = value.trim();
  });
  const baseUrl = String(input.baseUrl || '').trim();
  if (baseUrl && !/^https:\/\/\S+$/.test(baseUrl)) throw new ApiError(422, 'Use an https API address.', { baseUrl: 'Use an https address.' });
  const fault = environment === 'sandbox' && SANDBOX_FAULTS.includes(input.fault) ? input.fault : 'none';
  if (row) {
    db.prepare("UPDATE api_integrations SET secrets = ?, base_url = ?, fault = ?, status = 'not_tested', last_error = '' WHERE partner_id = ? AND environment = ?")
      .run(encrypt(secrets), baseUrl, fault, id, environment);
  } else {
    db.prepare("INSERT INTO api_integrations (partner_id, environment, secrets, base_url, fault, status) VALUES (?, ?, ?, ?, ?, 'not_tested')")
      .run(id, environment, encrypt(secrets), baseUrl, fault);
  }
  audit(admin, 'integration.saved', 'partner', id, { environment, fields: SECRET_FIELDS.filter((f) => input.secrets?.[f]?.trim?.()), fault });
}

export async function testIntegration(admin, id, environment) {
  const partner = loadPartner(id);
  checkEnvironment(environment);
  const db = getDb();
  const record = (status, error) => db.prepare('UPDATE api_integrations SET status = ?, last_tested_at = ?, last_error = ? WHERE partner_id = ? AND environment = ?')
    .run(status, Date.now(), error, id, environment);
  if (!loadIntegration(id, environment)) throw new ApiError(409, 'Save this environment before testing it.');
  try {
    const { message } = await callCourier(partner, 'testConnection', { environment, reference: 'connection-test' });
    record('connected', '');
    audit(admin, 'integration.tested', 'partner', id, { environment, ok: true });
    return { ok: true, message };
  } catch (err) {
    record('failed', err.message);
    audit(admin, 'integration.tested', 'partner', id, { environment, ok: false });
    return { ok: false, message: err.message };
  }
}

export function disconnectIntegration(admin, id, environment) {
  const partner = loadPartner(id);
  checkEnvironment(environment);
  if (partner.status === 'active' && partner.environment === environment) throw new ApiError(409, 'Deactivate this courier before disconnecting its active API.');
  getDb().prepare('DELETE FROM api_integrations WHERE partner_id = ? AND environment = ?').run(id, environment);
  audit(admin, 'integration.disconnected', 'partner', id, { environment });
}

export function setEnvironment(admin, id, environment) {
  const partner = loadPartner(id);
  checkEnvironment(environment);
  if (partner.status === 'active') throw new ApiError(409, 'Deactivate this courier before switching environments.');
  if (!adapterFor(environment).supportsSimulator && environment === 'production') {
    throw new ApiError(409, `No production adapter is installed for ${partner.name}, so it has to stay on Sandbox.`);
  }
  getDb().prepare('UPDATE logistics_partners SET environment = ?, updated_at = ? WHERE id = ?').run(environment, Date.now(), id);
  audit(admin, 'integration.environment_changed', 'partner', id, { environment });
}
