// Proof-of-delivery photos. They show a buyer's door and sometimes the buyer, so they live
// outside the public uploads folder and are served only to the people on that delivery. A photo
// is uploaded before the delivery is confirmed, then tied to that one shipment.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { can } from '../adminRoles';
import { LIMITS } from '../products';
import { currentAccount } from './auth';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';
import { imageType } from './uploads';

const PROOF_DIR = path.join(UPLOAD_DIR, '..', 'documents', 'proofs');
const PROOF_URL = /^\/api\/proofs\/([a-f0-9-]{36})$/;

const db = () => getDb();

export async function saveProofPhoto(file, { partnerId, riderId = '', uploadedBy }) {
  if (!(file instanceof File) || !file.size) throw new ApiError(400, 'Choose a photo.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = imageType(bytes);
  if (!mime) throw new ApiError(415, 'Use a JPG, PNG or WebP image.');
  if (bytes.length > LIMITS.imageBytes) throw new ApiError(413, `That photo is over the ${LIMITS.imageBytes / 1024 / 1024} MB limit.`);
  mkdirSync(PROOF_DIR, { recursive: true });
  const id = randomUUID();
  const stored = `${id}.${LIMITS.imageTypes[mime]}`;
  writeFileSync(path.join(PROOF_DIR, stored), bytes);
  db().prepare('INSERT INTO proof_photos (id, partner_id, rider_id, uploaded_by, stored, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, partnerId, riderId, uploadedBy, stored, mime, Date.now());
  return `/api/proofs/${id}`;
}

function photoRow(url) {
  const match = PROOF_URL.exec(String(url ?? ''));
  return match ? db().prepare('SELECT * FROM proof_photos WHERE id = ?').get(match[1]) : null;
}

export const MAX_PROOF_PHOTOS = 3;

// The photos for one delivery: each uploaded by this partner (and by this rider, when a rider
// sends it) and not used on another delivery. Returns each with the time it was uploaded.
export function checkProofPhotos(urls, partnerId, { required = false, riderId = '' } = {}) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).map((url) => String(url ?? '').trim()).filter(Boolean))];
  if (!list.length) {
    if (required) throw new ApiError(422, 'Take or upload a photo of the delivered parcel.', { photo: 'Take or upload a photo of the delivered parcel.' });
    return [];
  }
  if (list.length > MAX_PROOF_PHOTOS) throw new ApiError(422, `Send up to ${MAX_PROOF_PHOTOS} photos.`, { photo: `Send up to ${MAX_PROOF_PHOTOS} photos.` });
  return list.map((url) => {
    const row = photoRow(url);
    if (!row || row.partner_id !== partnerId || row.shipment_id || (riderId && row.rider_id !== riderId)) {
      throw new ApiError(422, 'Upload the delivery photo again.', { photo: 'Upload the delivery photo again.' });
    }
    return { url, at: row.created_at };
  });
}

export function linkProofPhoto(url, shipmentId) {
  const match = PROOF_URL.exec(String(url ?? ''));
  if (match) db().prepare("UPDATE proof_photos SET shipment_id = ? WHERE id = ? AND shipment_id = ''").run(shipmentId, match[1]);
}

// For the buyer and seller of that delivery, the courier's staff, the rider who took it, and
// administrators who monitor shipments. Anyone else gets a 404, so they can't tell it exists.
export async function proofResponse(id) {
  const row = db().prepare('SELECT * FROM proof_photos WHERE id = ?').get(String(id));
  if (!row) throw new ApiError(404, 'File not found.');
  const shipment = row.shipment_id ? db().prepare('SELECT seller, customer FROM shipments WHERE id = ?').get(row.shipment_id) : null;
  const [customer, seller, courier, rider, admin] = await Promise.all(['customer', 'seller', 'courier', 'rider', 'admin'].map((role) => currentAccount(role)));
  const same = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
  const allowed = courier?.partnerId === row.partner_id
    || (row.rider_id && rider?.riderId === row.rider_id)
    || (shipment && (same(customer?.username, shipment.customer) || same(seller?.username, shipment.seller) || (admin && can(admin, 'shipments'))));
  if (!allowed) throw new ApiError(404, 'File not found.');
  return new Response(readFileSync(path.join(PROOF_DIR, row.stored)), {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
