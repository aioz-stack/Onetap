// SQLite through Node's built-in driver. ONETAP_DATA_DIR holds the database and uploads,
// which Docker mounts as a volume so they survive rebuilds.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { LOGISTICS_PARTNERS, SHIPPING_ZONES } from '../data';
import { encrypt } from './crypto';

const DATA_DIR = process.env.ONETAP_DATA_DIR || path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let database;

// J&T, Ninja Van and LBC start connected to the built-in sandbox, never a live courier.
function seedPartners(db) {
  if (db.prepare('SELECT 1 FROM logistics_partners LIMIT 1').get()) return;
  const now = Date.now();
  LOGISTICS_PARTNERS.forEach((partner, i) => {
    const { id, name, ...data } = partner;
    db.prepare("INSERT INTO logistics_partners (id, name, status, is_default, data, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?)")
      .run(id, name, i === 0 ? 1 : 0, JSON.stringify(data), now, now);
    db.prepare("INSERT INTO api_integrations (partner_id, environment, secrets, status, last_tested_at) VALUES (?, 'sandbox', ?, 'connected', ?)")
      .run(id, encrypt({ webhookSecret: randomBytes(32).toString('hex') }), now);
  });
}

// Moves partners and products saved before Tuguegarao became the only service area. A partner's
// rate starts from its Luzon rate, which is the region Tuguegarao is in, and a location list that
// was left empty stays empty.
function moveToServiceArea(db) {
  const [area] = SHIPPING_ZONES;
  const locations = (list) => (list.length ? [area] : []);
  db.prepare('SELECT id, data FROM logistics_partners').all().forEach((row) => {
    const data = JSON.parse(row.data);
    if (area in data.base) return;
    const moved = { ...data, zones: locations(data.zones), pickupLocations: locations(data.pickupLocations), deliveryLocations: locations(data.deliveryLocations), base: { [area]: data.base.Luzon } };
    db.prepare('UPDATE logistics_partners SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(moved), Date.now(), row.id);
  });
  db.prepare("UPDATE products SET data = json_set(data, '$.shipping.destination', ?) WHERE json_extract(data, '$.shipping.destination') <> ?").run(area, area);
}

// Adds columns that older databases don't have yet. Names are constants here, never input.
function addColumns(db, table, columns) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  Object.entries(columns).filter(([name]) => !existing.includes(name)).forEach(([name, type]) => db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`));
}

export function getDb() {
  if (database) return database;
  mkdirSync(UPLOAD_DIR, { recursive: true });
  database = new DatabaseSync(path.join(DATA_DIR, 'onetap.db'));
  const firstApplications = !database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'seller_applications'").get();
  const firstCustomerApprovals = !database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'customer_approvals'").get();
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      violation TEXT,
      review_at INTEGER,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (seller, code)
    );
    CREATE INDEX IF NOT EXISTS products_seller ON products (seller);
    CREATE INDEX IF NOT EXISTS products_status ON products (status, review_at);
    -- Held sample orders only. Replaced by orders.
    DROP TABLE IF EXISTS seller_orders;
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      customer TEXT NOT NULL,
      data TEXT NOT NULL,
      placed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS orders_seller ON orders (seller, placed_at);
    CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer, placed_at);
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      customer TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      pinned INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      started INTEGER NOT NULL DEFAULT 0,
      seller_unread INTEGER NOT NULL DEFAULT 0,
      customer_unread INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      last_text TEXT NOT NULL DEFAULT '',
      last_sender TEXT NOT NULL DEFAULT '',
      last_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (seller, customer)
    );
    CREATE INDEX IF NOT EXISTS chat_threads_customer ON chat_threads (customer, last_at);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      meta TEXT,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages (thread_id, id);
    CREATE TABLE IF NOT EXISTS chat_settings (
      seller TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seller_applications (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      submitted_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seller_application_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seller_application_history_seller ON seller_application_history (seller, id);
    CREATE TABLE IF NOT EXISTS seller_documents (
      id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      stored TEXT NOT NULL,
      current INTEGER NOT NULL DEFAULT 1,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seller_documents_seller ON seller_documents (seller, kind);
    CREATE TABLE IF NOT EXISTS admins (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      detail TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seller_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seller_notifications_seller ON seller_notifications (seller, id);
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS product_reviews_product ON product_reviews (product_id, id);
    CREATE TABLE IF NOT EXISTS logistics_partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      environment TEXT NOT NULL DEFAULT 'sandbox',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_integrations (
      partner_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      secrets TEXT,
      base_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'not_configured',
      last_tested_at INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      fault TEXT NOT NULL DEFAULT 'none',
      PRIMARY KEY (partner_id, environment)
    );
    CREATE TABLE IF NOT EXISTS api_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      operation TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_logs_partner ON api_logs (partner_id, id);
    CREATE TABLE IF NOT EXISTS webhook_events (
      event_key TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      tracking TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sandbox_bookings (
      idempotency_key TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      checkout_id TEXT NOT NULL DEFAULT '',
      seller TEXT NOT NULL,
      customer TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      environment TEXT NOT NULL,
      method TEXT NOT NULL,
      tracking TEXT NOT NULL DEFAULT '',
      booking_ref TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      eta INTEGER,
      investigating INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shipments_order ON shipments (order_id);
    CREATE INDEX IF NOT EXISTS shipments_tracking ON shipments (tracking);
    CREATE TABLE IF NOT EXISTS shipment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shipment_events_shipment ON shipment_events (shipment_id, id);
    CREATE TABLE IF NOT EXISTS pickups (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      seller TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      address TEXT NOT NULL,
      scheduled_for INTEGER NOT NULL,
      status TEXT NOT NULL,
      booking_ref TEXT NOT NULL DEFAULT '',
      confirmation TEXT NOT NULL DEFAULT '',
      failed_reason TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cod_records (
      order_id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      customer TEXT NOT NULL,
      partner_id TEXT NOT NULL DEFAULT '',
      partner_name TEXT NOT NULL DEFAULT '',
      expected INTEGER NOT NULL,
      collected INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      remittance_id TEXT NOT NULL DEFAULT '',
      collected_at INTEGER,
      remitted_at INTEGER,
      due_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cod_remittances (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      reference TEXT NOT NULL UNIQUE,
      expected INTEGER NOT NULL,
      received INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      admin TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES customers (username) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sellers (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seller_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES sellers (username) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courier_users (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courier_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES courier_users (username) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courier_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS courier_notifications_partner ON courier_notifications (partner_id, id);
    CREATE TABLE IF NOT EXISTS checkouts (
      customer TEXT NOT NULL,
      key TEXT NOT NULL,
      orders TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (customer, key)
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_notifications_customer ON customer_notifications (customer, id);
    -- A partner's riders. username is what they sign in to the Rider Panel with. The mobile
    -- number is in phone, added below.
    CREATE TABLE IF NOT EXISTS riders (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      profile TEXT NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      has_login INTEGER NOT NULL DEFAULT 0,
      license_name TEXT NOT NULL,
      license_mime TEXT NOT NULL,
      license_size INTEGER NOT NULL,
      license_stored TEXT NOT NULL,
      license_hash TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS riders_partner ON riders (partner_id);
    CREATE TABLE IF NOT EXISTS rider_sessions (
      token_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES riders (username) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rider_assignments (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      rider_id TEXT NOT NULL,
      shipment_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      assigned_by TEXT NOT NULL,
      assigned_at INTEGER NOT NULL,
      accepted_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rider_assignments_partner ON rider_assignments (partner_id, assigned_at);
    CREATE INDEX IF NOT EXISTS rider_assignments_shipment ON rider_assignments (shipment_id);
    CREATE INDEX IF NOT EXISTS rider_assignments_order ON rider_assignments (order_id);
    -- One rider per open pickup or delivery. A rider can hold several orders at once.
    DROP INDEX IF EXISTS rider_one_task;
    CREATE UNIQUE INDEX IF NOT EXISTS shipment_one_rider ON rider_assignments (shipment_id, kind) WHERE status IN ('assigned', 'accepted');
    CREATE TABLE IF NOT EXISTS rider_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rider_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rider_notifications_rider ON rider_notifications (rider_id, id);
    CREATE TABLE IF NOT EXISTS login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_at INTEGER NOT NULL
    );
  `);
  addColumns(database, 'pickups', {
    method: "TEXT NOT NULL DEFAULT 'Pickup'",
    slot: "TEXT NOT NULL DEFAULT ''",
    area: "TEXT NOT NULL DEFAULT ''",
    contact_name: "TEXT NOT NULL DEFAULT ''",
    contact_phone: "TEXT NOT NULL DEFAULT ''",
    parcel: "TEXT NOT NULL DEFAULT '{}'",
    preferred_courier: "TEXT NOT NULL DEFAULT ''",
    rejected_by: "TEXT NOT NULL DEFAULT '[]'",
    auto_assign: 'INTEGER NOT NULL DEFAULT 0',
    review_note: "TEXT NOT NULL DEFAULT ''",
    reviewed_by: "TEXT NOT NULL DEFAULT ''",
    reviewed_at: 'INTEGER',
    booking_error: "TEXT NOT NULL DEFAULT ''",
    retries: 'INTEGER NOT NULL DEFAULT 0',
    retry_at: 'INTEGER',
    picked_up_at: 'INTEGER',
  });
  addColumns(database, 'shipments', { picked_up_at: 'INTEGER', delivered_at: 'INTEGER', proof: "TEXT NOT NULL DEFAULT ''", out_for_delivery_at: 'INTEGER' });
  database.exec(`
    -- Proof-of-delivery photos. Private: served only through proofResponse, never /api/uploads.
    CREATE TABLE IF NOT EXISTS proof_photos (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      rider_id TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL,
      stored TEXT NOT NULL,
      mime TEXT NOT NULL,
      shipment_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    -- One financial record per delivered order, written when the delivery is confirmed. The
    -- amounts are fixed then, so a later commission change doesn't rewrite history.
    CREATE TABLE IF NOT EXISTS collection_records (
      order_id TEXT PRIMARY KEY,
      seller TEXT NOT NULL,
      shop_name TEXT NOT NULL,
      customer TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      partner_id TEXT NOT NULL,
      partner_name TEXT NOT NULL,
      rider_id TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL,
      product_total REAL NOT NULL,
      rider_fee REAL NOT NULL,
      commission_rate REAL NOT NULL,
      admin_fee REAL NOT NULL,
      seller_proceeds REAL NOT NULL,
      total REAL NOT NULL,
      collected REAL NOT NULL,
      payment_reference TEXT NOT NULL DEFAULT '',
      collected_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS collection_records_day ON collection_records (collected_at);
    CREATE INDEX IF NOT EXISTS collection_records_rider ON collection_records (rider_id, collected_at);
  `);
  // Riders first signed in with their mobile number, held in username. They now have their own
  // username, so the number moves to phone, and an existing rider keeps signing in with it.
  addColumns(database, 'riders', { phone: "TEXT NOT NULL DEFAULT ''" });
  // A new task's notice keeps the order, customer, pickup location and assignment time as JSON.
  addColumns(database, 'rider_notifications', { details: "TEXT NOT NULL DEFAULT ''" });
  // The rider who collected a COD parcel's cash, and the remittance they handed it over in.
  addColumns(database, 'cod_records', { rider_id: "TEXT NOT NULL DEFAULT ''", rider_remittance_id: "TEXT NOT NULL DEFAULT ''" });
  database.exec(`
    CREATE TABLE IF NOT EXISTS rider_remittances (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      partner_id TEXT NOT NULL,
      rider_id TEXT NOT NULL,
      parcels INTEGER NOT NULL,
      expected REAL NOT NULL,
      declared REAL NOT NULL,
      received REAL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      review_note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      submitted_at INTEGER NOT NULL,
      reviewed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS rider_remittances_partner ON rider_remittances (partner_id, submitted_at);
    -- A rider has one handover waiting for the courier at a time.
    CREATE UNIQUE INDEX IF NOT EXISTS rider_one_remittance ON rider_remittances (rider_id) WHERE status = 'submitted';
    CREATE INDEX IF NOT EXISTS cod_records_rider ON cod_records (rider_id, rider_remittance_id);
  `);
  database.exec(`
    UPDATE riders SET phone = username WHERE phone = '';
    CREATE UNIQUE INDEX IF NOT EXISTS riders_phone ON riders (phone);
  `);
  // One open pickup and one live shipment per order, whatever happens above this layer.
  database.exec(`
    DROP INDEX IF EXISTS pickups_open;
    CREATE UNIQUE INDEX IF NOT EXISTS pickups_one_open ON pickups (order_id) WHERE status IN ('awaiting_payment', 'pending', 'approved', 'scheduled', 'confirmed');
    CREATE UNIQUE INDEX IF NOT EXISTS shipments_live ON shipments (order_id) WHERE status <> 'cancelled';
    CREATE INDEX IF NOT EXISTS pickups_partner ON pickups (partner_id, status);
    CREATE INDEX IF NOT EXISTS shipments_partner ON shipments (partner_id, status);
  `);
  // Orders booked before waybills carried a Sandbox label.
  database.exec("UPDATE orders SET data = json_set(data, '$.sandbox', json('true')) WHERE json_extract(data, '$.tracking') LIKE 'SBX-%' AND json_extract(data, '$.sandbox') IS NULL");
  if (firstApplications) {
    database.exec("INSERT OR IGNORE INTO seller_applications (username, status, submitted_at, decided_at, decided_by, updated_at) SELECT username, 'approved', created_at, created_at, 'existing account', created_at FROM sellers");
  }
  // Customer Approval. The valid ID is a private file in data/documents/customers. Its number
  // (normalised in id_key) and its image (id_hash) can't belong to two accounts, unless the
  // other was rejected, so a rejected application never blocks the real owner.
  database.exec(`
    CREATE TABLE IF NOT EXISTS customer_approvals (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      id_number TEXT NOT NULL DEFAULT '',
      id_key TEXT NOT NULL DEFAULT '',
      id_name TEXT NOT NULL DEFAULT '',
      id_mime TEXT NOT NULL DEFAULT '',
      id_size INTEGER NOT NULL DEFAULT 0,
      id_stored TEXT NOT NULL DEFAULT '',
      id_hash TEXT NOT NULL DEFAULT '',
      submitted_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_approvals_status ON customer_approvals (status, submitted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS customer_id_number ON customer_approvals (id_key) WHERE id_key <> '' AND status <> 'rejected';
    CREATE UNIQUE INDEX IF NOT EXISTS customer_id_image ON customer_approvals (id_hash) WHERE id_hash <> '' AND status <> 'rejected';
    CREATE TABLE IF NOT EXISTS customer_approval_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_approval_history_customer ON customer_approval_history (customer, id);
  `);
  // Customers from before approvals keep shopping: they are marked approved once.
  if (firstCustomerApprovals) {
    database.exec("INSERT OR IGNORE INTO customer_approvals (username, status, submitted_at, decided_at, decided_by, updated_at) SELECT username, 'approved', created_at, created_at, 'existing account', created_at FROM customers");
  }
  // When a customer was first approved. It stays set while they are re-verified after changing
  // their ID or name, so they keep their orders but can't buy until approved again.
  addColumns(database, 'customer_approvals', { approved_at: 'INTEGER' });
  // Notices for administrators. Each is for one permission, and each administrator's read
  // position is the newest id they have seen.
  database.exec(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permission TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    -- One-time codes for mobile number verification. The code is kept as an HMAC and the token
    -- that proves it as a SHA-256, never as themselves.
    CREATE TABLE IF NOT EXISTS phone_verifications (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      sent_at INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      verified_at INTEGER,
      token_hash TEXT NOT NULL DEFAULT '',
      token_expires_at INTEGER,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS phone_verifications_phone ON phone_verifications (phone, sent_at);
    CREATE INDEX IF NOT EXISTS phone_verifications_ip ON phone_verifications (ip, sent_at);
    CREATE TABLE IF NOT EXISTS admin_notification_reads (
      username TEXT PRIMARY KEY COLLATE NOCASE,
      last_id INTEGER NOT NULL
    );
  `);
  database.exec("UPDATE customer_approvals SET approved_at = COALESCE(decided_at, submitted_at) WHERE status = 'approved' AND approved_at IS NULL");
  // Products no longer wait for approval, so anything still waiting goes on sale.
  database.exec("UPDATE products SET status = 'live' WHERE status = 'review'");
  seedPartners(database);
  moveToServiceArea(database);
  return database;
}
