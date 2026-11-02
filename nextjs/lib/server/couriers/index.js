// Every courier call goes through here: credentials stay on the server, temporary failures
// retry with exponential backoff, and each attempt is logged without any secret values.

import { decrypt } from '../crypto';
import { getDb } from '../db';
import { ApiError } from '../errors';
import { TemporaryCourierError } from './errors';
import { sandboxAdapter, unavailableAdapter } from './sandbox';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 150;
const TIMEOUT_MS = 8000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function withTimeout(work) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TemporaryCourierError('The courier did not respond in time.')), TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function adapterFor(environment) {
  return environment === 'sandbox' ? sandboxAdapter : unavailableAdapter;
}

export function loadPartner(id) {
  const row = getDb().prepare('SELECT * FROM logistics_partners WHERE id = ?').get(id);
  if (!row) throw new ApiError(404, 'We could not find that logistics partner.');
  return { ...JSON.parse(row.data), id: row.id, name: row.name, status: row.status, isDefault: Boolean(row.is_default), environment: row.environment };
}

export function loadIntegration(partnerId, environment) {
  return getDb().prepare('SELECT * FROM api_integrations WHERE partner_id = ? AND environment = ?').get(partnerId, environment);
}

export function secretsFor(integration) {
  return integration?.secrets ? decrypt(integration.secrets) : {};
}

function logAttempt(partner, environment, operation, reference, attempt, outcome, started, error = '') {
  getDb().prepare(`
    INSERT INTO api_logs (partner_id, environment, operation, reference, attempt, outcome, duration_ms, error, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(partner.id, environment, operation, reference, attempt, outcome, Date.now() - started, error.slice(0, 300), Date.now());
}

function redact(message, secrets) {
  return Object.values(secrets).filter(Boolean).reduce((text, secret) => text.split(secret).join('[redacted]'), String(message));
}

// Calls one adapter operation. Throws ApiError 502 once retries run out or on a lasting failure.
export async function callCourier(partner, operation, { reference = '', environment = partner.environment, ...args } = {}) {
  const adapter = adapterFor(environment);
  const integration = loadIntegration(partner.id, environment);
  const secrets = secretsFor(integration);
  const context = { partner, secrets, baseUrl: integration?.base_url || '', fault: integration?.fault || 'none', ...args };

  for (let attempt = 1; ; attempt += 1) {
    const started = Date.now();
    try {
      const result = await withTimeout(adapter[operation](context));
      logAttempt(partner, environment, operation, reference, attempt, 'success', started);
      return result;
    } catch (err) {
      const message = redact(err.message, secrets);
      const temporary = err instanceof TemporaryCourierError;
      if (temporary && attempt < MAX_ATTEMPTS) {
        logAttempt(partner, environment, operation, reference, attempt, 'retry', started, message);
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      } else {
        logAttempt(partner, environment, operation, reference, attempt, 'failed', started, message);
        const failure = new ApiError(502, `${partner.name}: ${message}`);
        failure.temporary = temporary;
        throw failure;
      }
    }
  }
}
