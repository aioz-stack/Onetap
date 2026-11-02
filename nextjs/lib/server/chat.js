// Buyer and seller conversations. Every query is scoped to the account making the request.
// Seller notes and block reasons never leave the seller's own responses.

import { randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_SETTINGS } from '../data';
import { priceRange } from '../products';
import { getDb } from './db';
import { ApiError } from './errors';

const MAX_TEXT = 500;
const IMAGE_URL = /^\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/;
const DAY = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = 30;

function toThread(row, role) {
  const thread = {
    id: row.id,
    seller: row.seller,
    shopName: row.shop_name,
    customer: row.customer,
    customerName: row.customer_name,
    status: row.status,
    preview: row.last_text,
    lastSender: row.last_sender,
    lastAt: row.last_at,
    unread: role === 'seller' ? row.seller_unread : row.customer_unread,
    blocked: Boolean(row.blocked),
  };
  return role === 'seller' ? { ...thread, pinned: Boolean(row.pinned), note: row.note } : thread;
}

const toMessage = (row) => ({ id: row.id, sender: row.sender, text: row.text, meta: row.meta ? JSON.parse(row.meta) : null, at: row.at });

function findThread(role, owner, id) {
  const row = getDb().prepare(`SELECT * FROM chat_threads WHERE id = ? AND ${role === 'seller' ? 'seller' : 'customer'} = ?`).get(id, owner);
  if (!row) throw new ApiError(404, 'We could not find that conversation.');
  return row;
}

function addMessage(thread, sender, text, meta = null) {
  const db = getDb();
  const at = Date.now();
  db.prepare('INSERT INTO chat_messages (thread_id, sender, text, meta, at) VALUES (?, ?, ?, ?, ?)').run(thread.id, sender, text, meta && JSON.stringify(meta), at);
  const preview = text || (meta?.image ? 'Sent an image' : `Sent a product: ${meta?.product?.name}`);
  if (sender === 'customer') {
    db.prepare("UPDATE chat_threads SET last_text = ?, last_sender = 'customer', last_at = ?, seller_unread = seller_unread + 1, status = 'open', started = 1 WHERE id = ?").run(preview, at, thread.id);
  } else if (sender === 'seller') {
    db.prepare("UPDATE chat_threads SET last_text = ?, last_sender = 'seller', last_at = ?, customer_unread = customer_unread + 1 WHERE id = ?").run(preview, at, thread.id);
  } else {
    db.prepare('UPDATE chat_threads SET last_text = ?, last_at = ?, customer_unread = customer_unread + 1 WHERE id = ?').run(preview, at, thread.id);
  }
}

function cleanText(text) {
  if (typeof text !== 'string' || !text.trim()) throw new ApiError(422, 'Write a message first.');
  if (text.trim().length > MAX_TEXT) throw new ApiError(422, `Keep messages to ${MAX_TEXT} characters.`);
  return text.trim();
}

export function getChatSettings(seller) {
  const row = getDb().prepare('SELECT data FROM chat_settings WHERE seller = ?').get(seller);
  return row ? JSON.parse(row.data) : DEFAULT_CHAT_SETTINGS;
}

function checkString(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(422, `${label} must be 1 to ${max} characters.`);
  return value.trim();
}

export function saveChatSettings(seller, input) {
  const { greeting, shortcuts, faq } = input || {};
  if (!greeting || !Array.isArray(shortcuts) || !Array.isArray(faq?.items)) throw new ApiError(400, 'That request could not be read.');
  if (shortcuts.length > 30) throw new ApiError(422, 'You can keep up to 30 shortcuts.');
  if (faq.items.length > 5) throw new ApiError(422, 'You can keep up to 5 questions.');
  const data = {
    greeting: { enabled: Boolean(greeting.enabled), text: checkString(greeting.text, MAX_TEXT, 'The greeting') },
    shortcuts: shortcuts.map((item) => ({ title: checkString(item.title, 40, 'A shortcut name'), text: checkString(item.text, MAX_TEXT, 'A shortcut message') })),
    faq: {
      enabled: Boolean(faq.enabled),
      items: faq.items.map((item) => ({ q: checkString(item.q, 100, 'A question'), a: checkString(item.a, MAX_TEXT, 'An answer') })),
    },
  };
  if (data.faq.enabled && !data.faq.items.length) throw new ApiError(422, 'Add a question before turning on FAQ.');
  getDb().prepare(`
    INSERT INTO chat_settings (seller, data) VALUES (?, ?)
    ON CONFLICT (seller) DO UPDATE SET data = excluded.data
  `).run(seller, JSON.stringify(data));
  return data;
}

export function listThreads(role, owner) {
  const query = role === 'seller'
    ? 'SELECT * FROM chat_threads WHERE seller = ? AND started = 1 ORDER BY pinned DESC, last_at DESC'
    : 'SELECT * FROM chat_threads WHERE customer = ? ORDER BY last_at DESC';
  return getDb().prepare(query).all(owner).map((row) => toThread(row, role));
}

// Finds or starts a customer's conversation with a shop. A new one gets the automatic messages.
export function openThread(customer, seller) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM sellers WHERE username = ?').get(String(seller));
  if (!account) throw new ApiError(404, 'We could not find that shop.');
  const existing = db.prepare('SELECT * FROM chat_threads WHERE seller = ? AND customer = ?').get(account.username, customer.username);
  if (existing) return toThread(existing, 'customer');

  const { shopName } = JSON.parse(account.profile);
  const now = Date.now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO chat_threads (id, seller, shop_name, customer, customer_name, last_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, account.username, shopName, customer.username, `${customer.firstName} ${customer.lastName}`, now, now);
  const thread = { id };
  const { greeting, faq } = getChatSettings(account.username);
  if (greeting.enabled) addMessage(thread, 'bot', greeting.text);
  if (faq.enabled && faq.items.length) addMessage(thread, 'bot', 'Frequently asked questions', { faq: faq.items.map((item) => item.q) });
  return toThread(findThread('customer', customer.username, id), 'customer');
}

function customerSummary(seller, customer) {
  const db = getDb();
  const account = db.prepare('SELECT created_at FROM customers WHERE username = ?').get(customer);
  const orders = db.prepare('SELECT data FROM orders WHERE seller = ? AND customer = ? ORDER BY placed_at DESC').all(seller, customer).map((row) => JSON.parse(row.data));
  const kept = orders.filter((order) => order.status !== 'cancelled' && !order.refunded);
  return {
    username: customer,
    memberSince: account?.created_at || null,
    orderCount: orders.length,
    totalSpent: kept.reduce((sum, order) => sum + order.total, 0),
    orders: orders.slice(0, 5).map(({ id, status, total, placedAt, items }) => ({ id, status, total, placedAt, firstItem: items[0]?.name, itemCount: items.length })),
  };
}

export function getThread(role, owner, id, markRead) {
  const db = getDb();
  const row = findThread(role, owner, id);
  if (markRead) db.prepare(`UPDATE chat_threads SET ${role === 'seller' ? 'seller_unread' : 'customer_unread'} = 0 WHERE id = ?`).run(id);
  const messages = db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY id').all(id).map(toMessage);
  const thread = toThread(findThread(role, owner, id), role);
  return role === 'seller' ? { thread, messages, customer: customerSummary(owner, row.customer) } : { thread, messages };
}

export function sendAsCustomer(customer, id, { text, faq } = {}) {
  const row = findThread('customer', customer, id);
  if (row.blocked) throw new ApiError(403, 'This shop is not accepting messages from your account.');
  if (Number.isInteger(faq)) {
    const item = getChatSettings(row.seller).faq.items[faq];
    if (!item) throw new ApiError(404, 'That question is no longer available.');
    addMessage(row, 'customer', item.q);
    addMessage(row, 'bot', item.a);
  } else {
    addMessage(row, 'customer', cleanText(text));
  }
  return getThread('customer', customer, id, true);
}

export function sendAsSeller(seller, id, { text, image, productId } = {}) {
  const row = findThread('seller', seller, id);
  if (image) {
    if (typeof image !== 'string' || !IMAGE_URL.test(image)) throw new ApiError(422, 'Upload the image again.');
    addMessage(row, 'seller', '', { image });
  } else if (productId) {
    const product = getDb().prepare("SELECT * FROM products WHERE id = ? AND seller = ? AND status = 'live'").get(String(productId), seller);
    if (!product) throw new ApiError(404, 'Only your live products can be sent.');
    const data = JSON.parse(product.data);
    addMessage(row, 'seller', '', { product: { id: product.id, name: data.name, image: data.images[0], price: priceRange(data)?.[0] ?? null } });
  } else {
    addMessage(row, 'seller', cleanText(text));
  }
  return getThread('seller', seller, id, true);
}

export function updateThread(seller, id, changes) {
  findThread('seller', seller, id);
  const db = getDb();
  const { status, pinned, blocked, unread, note } = changes || {};
  if (status !== undefined) {
    if (!['open', 'resolved'].includes(status)) throw new ApiError(422, 'Choose a valid status.');
    db.prepare('UPDATE chat_threads SET status = ? WHERE id = ?').run(status, id);
  }
  if (pinned !== undefined) db.prepare('UPDATE chat_threads SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
  if (blocked !== undefined) db.prepare('UPDATE chat_threads SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, id);
  if (unread !== undefined) db.prepare('UPDATE chat_threads SET seller_unread = ? WHERE id = ?').run(unread ? 1 : 0, id);
  if (note !== undefined) {
    if (typeof note !== 'string' || note.length > MAX_TEXT) throw new ApiError(422, `Keep notes to ${MAX_TEXT} characters.`);
    db.prepare('UPDATE chat_threads SET note = ? WHERE id = ?').run(note.trim(), id);
  }
  return toThread(findThread('seller', seller, id), 'seller');
}

// A reply is timed from the first customer message still waiting for one.
function responseEvents(messages) {
  const byThread = new Map();
  messages.forEach((m) => byThread.set(m.thread_id, [...(byThread.get(m.thread_id) || []), m]));
  const events = [];
  byThread.forEach((list, thread) => {
    let waiting = null;
    list.forEach((m) => {
      if (m.sender === 'customer' && !waiting) {
        waiting = { thread, askedAt: m.at, repliedAt: null };
        events.push(waiting);
      } else if (m.sender === 'seller' && waiting) {
        waiting.repliedAt = m.at;
        waiting = null;
      }
    });
  });
  return events;
}

function summarise(events) {
  const threads = new Set(events.map((e) => e.thread));
  const answered = new Set(events.filter((e) => e.repliedAt).map((e) => e.thread));
  const times = events.filter((e) => e.repliedAt).map((e) => e.repliedAt - e.askedAt);
  return {
    enquiries: threads.size,
    responseRate: threads.size ? answered.size / threads.size : null,
    responseMs: times.length ? times.reduce((sum, ms) => sum + ms, 0) / times.length : null,
  };
}

export function chatPerformance(seller) {
  const now = Date.now();
  const from = now - PERIOD_DAYS * DAY;
  const previousFrom = from - PERIOD_DAYS * DAY;
  const messages = getDb().prepare(`
    SELECT chat_messages.* FROM chat_messages JOIN chat_threads ON chat_threads.id = chat_messages.thread_id
    WHERE chat_threads.seller = ? AND chat_messages.at >= ? ORDER BY chat_messages.id
  `).all(seller, previousFrom);
  const events = responseEvents(messages);
  const between = (start, end) => events.filter((e) => e.askedAt >= start && e.askedAt < end);
  const days = Array.from({ length: 7 }, (_, i) => {
    const end = now - i * DAY;
    return { end, ...summarise(between(end - DAY, end)) };
  }).reverse();
  return {
    from,
    to: now,
    current: summarise(between(from, now + 1)),
    previous: summarise(between(previousFrom, from)),
    days,
  };
}
