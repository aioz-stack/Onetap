// Order storage and rules. Checkout creates one order per shop and reserves stock in the same
// transaction. Every action checks the order's current state before it changes anything.

import { randomBytes } from 'node:crypto';
import { checkoutShippingFee, findSaleRow, salePrice, withStockChange } from '../products';
import { createCodRecord, voidCodRecord } from './cod';
import { logisticsOptions } from './logistics';
import { audit } from './admin';
import { notifyCustomer, notifySeller } from './notifications';
import { checkPickupRequest, closeUnbookedPickup, pickupPaid, queuePickup, releasePickup, submitPickupRequest } from './pickups';
import { cancelShipment, instructCourier } from './shipments';
import { orderRiders } from './riderTasks';
import { trackingFor } from './tracking';
import { SERVICE_AREA, SHIPPING_ZONES } from '../data';
import {
  BUYER_CANCEL_SCHEMA, checkoutSchema, PAYMENT_METHODS, RETURN_REQUEST_SCHEMA, SELLER_CANCEL_SCHEMA, serviceAddressErrors,
} from '../schemas';
import { getDb } from './db';
import { ApiError } from './errors';

const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STANDARD_PREPARE_DAYS = 3;
const MAX_LINES = 50;
const MAX_QTY = 99;

const optionsFor = (schema, name) => schema[0].fields.find((field) => field.name === name).options;

function checkOption(schema, name, value) {
  if (!optionsFor(schema, name).includes(value)) throw new ApiError(422, `Choose a valid ${name}.`);
}

function checkNote(note, label = 'reason', max = 300) {
  if (typeof note !== 'string' || note.trim().length < 10 || note.trim().length > max) {
    throw new ApiError(422, `Enter a ${label} of 10 to ${max} characters.`);
  }
  return note.trim();
}

const toOrder = (row) => JSON.parse(row.data);
// Riders are read from their tasks each time, so an order never keeps a stale copy.
const withRiders = (order, audience) => ({ ...order, riders: orderRiders(order.id, audience), trackingHistory: trackingFor(order, audience) });
const now = () => new Date().toISOString();

function transaction(work) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function changeStock(productId, variation, delta) {
  const db = getDb();
  const row = db.prepare('SELECT data FROM products WHERE id = ?').get(productId);
  // The seller may have deleted the listing since the order was placed.
  if (!row) return;
  const product = withStockChange(JSON.parse(row.data), variation, delta);
  db.prepare('UPDATE products SET data = ? WHERE id = ?').run(JSON.stringify(product), productId);
}

// What Seller Centre may see of an order: no delivery fee, and no totals that include it. A COD
// order keeps the amount the rider collects, which the waybill has to print.
export function forSellerOrder(order) {
  const { shippingFee, total, paidAmount, ...rest } = order;
  return { ...rest, productTotal: order.subtotal ?? order.items.reduce((sum, item) => sum + item.price * item.qty, 0), codAmount: order.payment === 'Cash on Delivery' ? total : 0 };
}

export function listOrders(seller) {
  return getDb().prepare('SELECT * FROM orders WHERE seller = ? ORDER BY placed_at DESC').all(seller).map((row) => withRiders(toOrder(row), 'seller'));
}

export function listCustomerOrders(customer) {
  return getDb().prepare('SELECT * FROM orders WHERE customer = ? ORDER BY placed_at DESC').all(customer).map((row) => withRiders(toOrder(row), 'customer'));
}

function checkAddress(address) {
  if (typeof address !== 'object' || address === null) throw new ApiError(400, 'That request could not be read.');
  const errors = {};
  checkoutSchema()[0].fields.forEach((field) => {
    const value = typeof address[field.name] === 'string' ? address[field.name].trim() : '';
    if (!value) errors[field.name] = `${field.label} is required.`;
    else if (value.length > (field.maxlength || 100)) errors[field.name] = 'That is too long.';
    else if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value)) errors[field.name] = field.hint || `Enter a valid ${field.label.toLowerCase()}.`;
  });
  if (Object.keys(errors).length) throw new ApiError(422, 'Check the highlighted fields.', errors);
  const outside = serviceAddressErrors(address);
  if (Object.keys(outside).length) throw new ApiError(422, `Sorry, we only deliver within ${SERVICE_AREA.city}.`, outside);
}

// Prices, names and stock all come from the database, never from the request.
function resolveLine(line) {
  const qty = Number(line?.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new ApiError(422, `Quantities must be 1 to ${MAX_QTY}.`);
  const row = getDb().prepare(`
    SELECT p.* FROM products p JOIN seller_applications a ON a.username = p.seller
    WHERE p.id = ? AND p.status = 'live' AND a.status = 'approved'
  `).get(String(line.productId));
  if (!row) throw new ApiError(409, 'An item in your cart is no longer available.');
  const product = JSON.parse(row.data);
  const variation = typeof line.variation === 'string' ? line.variation : '';
  const sale = findSaleRow(product, variation);
  if (!sale) throw new ApiError(409, `${product.name} is no longer available in that option.`);
  if (Number(sale.stock) < qty) throw new ApiError(409, `Only ${sale.stock} left of ${product.name}. Update your cart and try again.`);
  return { row, product, variation, qty, price: salePrice(sale) };
}

function createOrder(customer, seller, lines, { address, zone, payment, checkoutId }) {
  const items = lines.map(({ row, product, variation, qty, price }) => ({
    product: row.id, variation, qty, price, name: product.name, image: product.images[0],
  }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const shippingFee = checkoutShippingFee(lines, zone, logisticsOptions());
  if (!shippingFee) throw new ApiError(409, 'No courier delivers to that area right now.');
  const placedAt = new Date();
  const prepareDays = Math.max(STANDARD_PREPARE_DAYS, ...lines.map(({ product }) => (product.preOrder ? Number(product.preOrderDays) : 0)));
  const cod = payment === 'Cash on Delivery';
  const order = {
    id: `OT-${randomBytes(4).toString('hex').toUpperCase()}`,
    checkoutId,
    seller,
    shopName: lines[0].row.shop_name,
    customer: customer.username,
    buyer: {
      name: address.name.trim(),
      username: customer.username,
      phone: address.contact.trim(),
      address: [address.street, address.barangay, address.city, address.province, address.zip].map((part) => part.trim()).join(', '),
    },
    zone,
    placedAt: placedAt.toISOString(),
    items,
    subtotal,
    shippingFee,
    voucher: 0,
    total: subtotal + shippingFee,
    payment,
    paid: false,
    shipBy: new Date(placedAt.getTime() + prepareDays * 24 * 60 * 60 * 1000).toISOString(),
    status: cod ? 'to_ship' : 'unpaid',
    events: [{ label: 'Order placed', at: placedAt.toISOString() }],
  };
  getDb().prepare('INSERT INTO orders (id, seller, customer, data, placed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(order.id, seller, customer.username, JSON.stringify(order), placedAt.getTime(), placedAt.getTime());
  if (cod) createCodRecord(order);
  notifySeller(seller, 'New order', `${order.id} from ${order.buyer.name}. ${cod ? 'Cash on delivery' : 'Prepaid'}, products ₱${order.subtotal}. Approve it to start fulfilment.`, `/seller/orders/${order.id}`);
  return order;
}

// All or nothing: if any item fails, no order is created and no stock moves.
export function placeOrders(customer, input) {
  const { lines, address, zone, payment, checkoutKey } = input || {};
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) throw new ApiError(422, 'Your cart is empty.');
  checkAddress(address);
  if (!SHIPPING_ZONES.includes(zone)) throw new ApiError(422, 'Choose your delivery area.');
  if (!PAYMENT_METHODS.includes(payment)) throw new ApiError(422, 'Choose a payment method.');

  const key = typeof checkoutKey === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(checkoutKey) ? checkoutKey : '';

  return transaction(() => {
    // A repeated submission gets its first result back, not a second set of orders.
    const earlier = key && getDb().prepare('SELECT orders FROM checkouts WHERE customer = ? AND key = ?').get(customer.username, key);
    if (earlier) return JSON.parse(earlier.orders).map((id) => toOrder(getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id)));
    const bySeller = new Map();
    lines.forEach((line) => {
      const resolved = resolveLine(line);
      changeStock(resolved.row.id, resolved.variation, -resolved.qty);
      const { seller } = resolved.row;
      bySeller.set(seller, [...(bySeller.get(seller) || []), resolved]);
    });
    const checkoutId = randomBytes(6).toString('hex');
    const orders = [...bySeller].map(([seller, group]) => createOrder(customer, seller, group, { address, zone, payment, checkoutId }));
    if (key) getDb().prepare('INSERT INTO checkouts (customer, key, orders, at) VALUES (?, ?, ?, ?)').run(customer.username, key, JSON.stringify(orders.map((order) => order.id)), Date.now());
    return orders;
  });
}

const openFailure = (order) => order.status === 'failed' && order.failed?.status === 'pending';
const pendingCancel = (order) => order.cancel?.status === 'pending';
const cancellable = (order) => pendingCancel(order) && ['unpaid', 'to_ship', 'ready'].includes(order.status);
const pendingReturn = (order) => order.return?.status === 'pending';

const tell = (order, title, body) => notifyCustomer(order.customer, title, body, `/orders/${order.id}`);

// Each action has a guard on the order's state, and returns the changes plus the history line.
// `after` runs in the same transaction, once the order is saved.
const SELLER_ACTIONS = {
  approve: {
    allowed: (order) => ['unpaid', 'to_ship'].includes(order.status) && !order.approvedAt && !pendingCancel(order),
    apply: () => [{ approvedAt: now() }, 'Order approved by seller'],
    after: (order) => tell(order, 'Order approved', `${order.shopName} approved ${order.id} and is preparing it.`),
  },
  reattempt: {
    allowed: openFailure,
    apply: (order) => [{ status: 'shipping', failed: { ...order.failed, status: 'reattempted' } }, `Redelivery requested from ${order.courier}`],
  },
  returnToSeller: {
    allowed: openFailure,
    apply: (order) => [{ failed: { ...order.failed, status: 'returning' } }, 'Parcel returning to seller'],
  },
  receiveFailed: {
    allowed: (order) => order.failed?.status === 'returning',
    restock: true,
    apply: (order) => [
      { refunded: order.paid, failed: { ...order.failed, status: 'returned' } },
      `Returned parcel received.${order.paid ? ' Refund released' : ''}`,
    ],
  },
  cancel: {
    allowed: (order) => ['unpaid', 'to_ship'].includes(order.status) && !pendingCancel(order),
    restock: true,
    apply(order, { reason }) {
      checkOption(SELLER_CANCEL_SCHEMA, 'reason', reason);
      return [
        { status: 'cancelled', refunded: order.paid, cancel: { by: 'Seller', reason, status: 'approved', at: now() } },
        `Cancelled by seller: ${reason}`,
      ];
    },
    after: (order) => tell(order, 'Order cancelled', `${order.shopName} cancelled ${order.id}.`),
  },
  approveCancel: {
    allowed: cancellable,
    restock: true,
    apply: (order) => [
      { status: 'cancelled', refunded: order.paid, cancel: { ...order.cancel, status: 'approved' } },
      `Cancellation approved.${order.paid ? ' Refund released' : ''}`,
    ],
    after: (order) => tell(order, 'Cancellation approved', `${order.id} was cancelled.`),
  },
  rejectCancel: {
    allowed: pendingCancel,
    apply(order, { note }) {
      const response = checkNote(note);
      return [{ cancel: { ...order.cancel, status: 'rejected', response } }, `Cancellation rejected: ${response}`];
    },
    after(order) {
      tell(order, 'Cancellation declined', `${order.shopName} declined to cancel ${order.id}.`);
      queuePickup(order.id);
    },
  },
  approveReturn: {
    allowed: pendingReturn,
    apply(order) {
      if (order.return.type === 'Refund Only') {
        return [{ refunded: true, return: { ...order.return, status: 'refunded' } }, 'Refund approved and released'];
      }
      return [{ return: { ...order.return, status: 'awaiting' } }, 'Return approved. Waiting for the item'];
    },
  },
  rejectReturn: {
    allowed: pendingReturn,
    apply(order, { note }) {
      const response = checkNote(note);
      return [{ return: { ...order.return, status: 'rejected', response } }, `Return rejected: ${response}`];
    },
  },
  receiveReturn: {
    allowed: (order) => order.return?.status === 'awaiting',
    apply: (order) => [{ refunded: true, return: { ...order.return, status: 'refunded' } }, 'Returned item received. Refund released'],
  },
};

const CUSTOMER_ACTIONS = {
  pay: {
    allowed: (order) => order.status === 'unpaid',
    // The payment record a prepaid collection is reconciled against. Simulated until a provider is connected.
    apply: (order) => [{ status: 'to_ship', paid: true, paidAt: now(), paidAmount: order.total, paymentReference: `SIM-PAY-${randomBytes(4).toString('hex').toUpperCase()}`, paymentSimulated: true }, 'Payment confirmed'],
    after(order) {
      notifySeller(order.seller, 'Payment received', `${order.customer} paid for ${order.id}.`, `/seller/orders/${order.id}`);
      pickupPaid(order.id);
    },
  },
  requestCancel: {
    allowed: (order) => ['unpaid', 'to_ship', 'ready'].includes(order.status) && !order.cancel,
    apply(order, { reason }) {
      checkOption(BUYER_CANCEL_SCHEMA, 'reason', reason);
      const cancel = { by: 'Buyer', reason, at: now() };
      // Nothing is prepared before payment, so an unpaid order cancels straight away.
      if (order.status === 'unpaid') {
        return [{ status: 'cancelled', cancel: { ...cancel, status: 'approved' }, restocked: true }, `Cancelled by buyer: ${reason}`];
      }
      return [{ cancel: { ...cancel, status: 'pending' } }, 'Buyer requested cancellation'];
    },
    after(order) {
      if (order.status === 'cancelled') closeUnbookedPickup(order.id);
      notifySeller(order.seller, order.status === 'cancelled' ? 'Order cancelled' : 'Cancellation requested', `${order.customer} ${order.status === 'cancelled' ? 'cancelled' : 'asked to cancel'} ${order.id}.`, `/seller/orders/${order.id}`);
    },
  },
  requestReturn: {
    allowed: (order) => order.status === 'completed' && !order.return && Date.now() - Date.parse(order.deliveredAt) <= RETURN_WINDOW_MS,
    apply(order, { type, reason, detail }) {
      const options = RETURN_REQUEST_SCHEMA[0].fields;
      if (!options[0].options.includes(type) || !options[1].options.includes(reason)) throw new ApiError(422, 'Choose a request and a reason.');
      return [
        { return: { type, reason, detail: checkNote(detail, 'description', 500), status: 'pending', at: now() } },
        type === 'Refund Only' ? 'Buyer requested a refund' : 'Buyer requested a return and refund',
      ];
    },
    after: (order) => notifySeller(order.seller, 'Return requested', `${order.customer} asked to return ${order.id}.`, `/seller/orders/${order.id}`),
  },
};

// Applies one action to several orders, all or nothing. Orders are only looked up within
// their owner's, so another account's order number simply isn't found.
function applyAction(actions, ownerColumn, owner, ids, action, data = {}) {
  const handler = Object.hasOwn(actions, action) ? actions[action] : null;
  if (!handler) throw new ApiError(400, 'Unknown action.');
  if (!Array.isArray(ids) || !ids.length || typeof data !== 'object' || data === null) throw new ApiError(400, 'That request could not be read.');

  const db = getDb();
  const find = db.prepare(`SELECT * FROM orders WHERE id = ? AND ${ownerColumn} = ?`);
  const save = db.prepare('UPDATE orders SET data = ?, updated_at = ? WHERE id = ?');
  return transaction(() => ids.map((id) => {
    const row = find.get(String(id), owner);
    if (!row) throw new ApiError(404, 'We could not find that order.');
    const order = toOrder(row);
    if (!handler.allowed(order)) throw new ApiError(409, `${order.id} has changed. Check its latest status and try again.`);
    const [{ restocked, ...patch }, event] = handler.apply(order, data);
    const next = { ...order, ...patch, events: [...order.events, { label: event, at: now() }] };
    if (handler.restock || restocked) {
      order.items.forEach((item) => changeStock(item.product, item.variation, item.qty));
      voidCodRecord(order.id);
    }
    save.run(JSON.stringify(next), Date.now(), order.id);
    handler.after?.(next);
    audit({ username: owner, adminRole: ownerColumn }, `order.${action}`, 'order', order.id);
    return withRiders(toOrder(find.get(order.id, owner)), ownerColumn);
  }));
}

function ownOrder(seller, id) {
  const row = getDb().prepare('SELECT * FROM orders WHERE id = ? AND seller = ?').get(String(id), seller);
  if (!row) throw new ApiError(404, 'We could not find that order.');
  return toOrder(row);
}

const stale = (order) => new ApiError(409, `${order.id} has changed. Check its latest status and try again.`);

// Courier steps that must succeed before the order itself changes.
const COURIER_STEPS = {
  reattempt: (order) => instructCourier(order, 'reattempt'),
  returnToSeller: (order) => instructCourier(order, 'return'),
  approveCancel: (order) => cancelShipment(order.id),
  cancel: (order) => cancelShipment(order.id),
};

// Saves the seller's schedule for each order, then sends it to a courier if it's ready to go.
async function requestPickups(seller, ids, data) {
  const request = checkPickupRequest(data);
  const failed = [];
  const orders = [];
  for (const id of ids) {
    const order = ownOrder(seller, id);
    try {
      await releasePickup(submitPickupRequest(order, request));
      orders.push(ownOrder(seller, id));
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      failed.push({ id: order.id, error: err.message });
    }
  }
  return { orders, failed };
}

export async function runSellerAction(seller, ids, action, data = {}) {
  if (!Array.isArray(ids) || !ids.length || typeof data !== 'object' || data === null) throw new ApiError(400, 'That request could not be read.');
  if (action === 'requestPickup') return requestPickups(seller, ids, data);
  if (Object.hasOwn(COURIER_STEPS, action)) {
    const order = ownOrder(seller, ids[0]);
    if (!SELLER_ACTIONS[action].allowed(order)) throw stale(order);
    await COURIER_STEPS[action](order);
  }
  return { orders: applyAction(SELLER_ACTIONS, 'seller', seller, ids, action, data), failed: [] };
}

export async function applyCustomerAction(customer, ids, action, data) {
  const orders = applyAction(CUSTOMER_ACTIONS, 'customer', customer, ids, action, data);
  if (action !== 'pay') return orders;
  // Payment was the last thing a scheduled pickup needed.
  for (const order of orders) {
    if (order.pickup?.status === 'pending') await releasePickup(order.pickup.id);
  }
  return ids.map((id) => withRiders(toOrder(getDb().prepare('SELECT * FROM orders WHERE id = ? AND customer = ?').get(String(id), customer)), 'customer'));
}
