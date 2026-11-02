// A built-in stand-in for a courier API, labelled Sandbox everywhere in the console. It keeps
// real behaviours worth testing: idempotent bookings and injectable failures. No parcel moves.

import { randomBytes } from 'node:crypto';
import { getDb } from '../db';
import { TemporaryCourierError, CourierError } from './errors';

const FAULT_SEEN = new Set();
const DELIVERY_DAYS = 4;

// The _once faults fail a given request one time, so the retry succeeds.
function injectFault(fault, key, afterSuccess) {
  if (fault === 'always_fail') throw new TemporaryCourierError('Sandbox: courier unavailable (simulated).');
  if (fault === 'none' || FAULT_SEEN.has(key)) return;
  FAULT_SEEN.add(key);
  if (fault === 'timeout_once') throw new TemporaryCourierError('Sandbox: request timed out (simulated).');
  if (fault === 'error_once') throw new TemporaryCourierError('Sandbox: server error 503 (simulated).');
  if (fault === 'lost_response_once') {
    afterSuccess?.();
    throw new TemporaryCourierError('Sandbox: response lost after the booking was made (simulated).');
  }
}

function once(idempotencyKey, build) {
  const db = getDb();
  const saved = db.prepare('SELECT response FROM sandbox_bookings WHERE idempotency_key = ?').get(idempotencyKey);
  if (saved) return JSON.parse(saved.response);
  const response = build();
  db.prepare('INSERT INTO sandbox_bookings (idempotency_key, response, at) VALUES (?, ?, ?)').run(idempotencyKey, JSON.stringify(response), Date.now());
  return response;
}

const code = () => randomBytes(5).toString('hex').toUpperCase();

export const sandboxAdapter = {
  supportsSimulator: true,

  async testConnection({ fault, partner }) {
    injectFault(fault, `test:${partner.id}:${Date.now()}`);
    if (fault !== 'none' && fault !== 'always_fail') return { message: 'Sandbox responded after a simulated failure.' };
    return { message: 'Sandbox simulator responded. No live courier was contacted.' };
  },

  async createBooking({ fault, partner, idempotencyKey }) {
    const make = () => once(idempotencyKey, () => ({
      tracking: `SBX-${partner.id.toUpperCase()}-${code()}`,
      bookingRef: `BK-${code()}`,
      eta: Date.now() + DELIVERY_DAYS * 24 * 60 * 60 * 1000,
    }));
    injectFault(fault, `book:${idempotencyKey}`, make);
    return make();
  },

  async schedulePickup({ fault, idempotencyKey, scheduledFor }) {
    injectFault(fault, `pickup:${idempotencyKey}`);
    return once(idempotencyKey, () => ({ pickupRef: `PU-${code()}`, scheduledFor }));
  },

  async cancelBooking({ fault, tracking, idempotencyKey }) {
    injectFault(fault, `cancel:${tracking || idempotencyKey}`);
    return { cancelled: true };
  },

  async cancelPickup({ fault, pickupRef }) {
    injectFault(fault, `cancel-pickup:${pickupRef}`);
    return { cancelled: true };
  },

  async instruct({ fault, tracking, action, idempotencyKey }) {
    injectFault(fault, `instruct:${idempotencyKey || `${tracking}:${action}`}`);
    return { accepted: true };
  },

  async track({ fault, tracking }) {
    injectFault(fault, `track:${tracking}:${Date.now()}`);
    return { events: [] };
  },
};

// Real courier adapters go here. Each needs that courier's own API contract and credentials.
export const unavailableAdapter = {
  supportsSimulator: false,
  ...Object.fromEntries(['testConnection', 'createBooking', 'schedulePickup', 'cancelPickup', 'cancelBooking', 'instruct', 'track'].map((name) => [name, async ({ partner }) => {
    throw new CourierError(`No production adapter is installed for ${partner.name}. Use Sandbox until one is built against their API.`);
  }])),
};
