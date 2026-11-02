'use client';

// Seller orders from the server, shared by every order page, plus status labels and helpers.
// lib/server/orders.js owns the data and decides which actions are allowed.

import { useCallback, useEffect } from 'react';
import { send } from './productsApi';
import { useStored } from './store';
import { createState } from './ui';
export const ORDER_STATUS = {
  unpaid: { label: 'Unpaid', tone: 'warn' },
  to_ship: { label: 'To Ship', tone: 'info' },
  ready: { label: 'Ready to Hand Over', tone: 'info' },
  shipping: { label: 'Shipping', tone: 'info' },
  failed: { label: 'Failed Delivery', tone: 'danger' },
  completed: { label: 'Completed', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

// Where an order stands before it ships, as a seller sees it.
export const ORDER_STAGE = {
  new: { label: 'New Order', tone: 'warn' },
  schedule: { label: 'To Schedule', tone: 'warn' },
  awaiting_payment: { label: 'Awaiting Payment', tone: 'warn' },
};

export const RETURN_STATUS = {
  pending: { label: 'Needs Response', tone: 'warn' },
  awaiting: { label: 'Awaiting Return', tone: 'info' },
  refunded: { label: 'Refunded', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const CANCEL_STATUS = {
  pending: { label: 'Needs Response', tone: 'warn' },
  approved: { label: 'Cancelled', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

export const FAILED_STATUS = {
  pending: { label: 'Needs Response', tone: 'warn' },
  returning: { label: 'Returning to Seller', tone: 'info' },
  returned: { label: 'Returned to Seller', tone: 'danger' },
  reattempted: { label: 'Redelivery Requested', tone: 'neutral' },
};

const orderState = createState({ owner: null, orders: [], loading: true, error: '' });
let latestLoad = 0;

async function loadOrders(owner) {
  latestLoad += 1;
  const load = latestLoad;
  try {
    const { orders } = await send('/api/seller/orders');
    if (load === latestLoad) orderState.set({ owner, orders, loading: false, error: '' });
  } catch (err) {
    if (load === latestLoad) orderState.set((state) => ({ ...state, owner, loading: false, error: err.message }));
  }
}

const REFRESH_MS = 15000;

export function useOrders() {
  const username = useStored('session.seller')?.username;
  const state = orderState.use();

  useEffect(() => {
    if (!username) return undefined;
    const refresh = () => loadOrders(username);
    refresh();
    // Picks up changes made by couriers, riders, buyers or another tab.
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [username]);

  const reload = useCallback(() => loadOrders(username), [username]);
  const current = state.owner === username;
  return {
    orders: current ? state.orders : [],
    loading: !current || state.loading,
    error: current ? state.error : '',
    reload,
  };
}

export function paymentLabel(order) {
  if (order.refunded) return 'Refunded';
  if (order.paid) return 'Paid';
  if (order.status === 'cancelled' || order.failed?.status === 'returned') return 'Not paid';
  return order.payment === 'Cash on Delivery' ? 'Collect on delivery' : 'Awaiting payment';
}

// A schedule that hasn't reached a confirmed booking yet.
export function awaitingPickup(order) {
  return ['awaiting_payment', 'pending', 'approved'].includes(order.pickup?.status);
}

export function needsApproval(order) {
  return ['unpaid', 'to_ship'].includes(order.status) && !order.approvedAt && order.cancel?.status !== 'pending';
}

export function needsArranging(order) {
  return ['unpaid', 'to_ship'].includes(order.status) && Boolean(order.approvedAt) && order.cancel?.status !== 'pending' && !awaitingPickup(order);
}

export const awaitingPayment = (order) => order.status === 'unpaid' && order.pickup?.status === 'awaiting_payment';

const hasOpenReturn = (order) => order.return && order.return.status !== 'rejected';

// My Orders tab for an order. Each order sits in exactly one, so the tabs add up to All.
// A rejected request or a redelivery drops the order back to its normal status.
export function orderGroup(order) {
  if (hasOpenReturn(order) || ['cancelled', 'failed'].includes(order.status) || order.cancel?.status === 'pending') return 'requests';
  return order.status === 'ready' ? 'to_ship' : order.status;
}

// My Orders tab for an order, in the order the seller works through them.
export function sellerGroup(order) {
  if (hasOpenReturn(order) || ['cancelled', 'failed'].includes(order.status) || order.cancel?.status === 'pending') return 'requests';
  if (needsApproval(order)) return 'new';
  if (awaitingPayment(order)) return 'unpaid';
  return ['shipping', 'completed'].includes(order.status) ? order.status : 'to_ship';
}

export function sellerStatus(order) {
  if (needsApproval(order)) return ORDER_STAGE.new;
  if (needsArranging(order)) return ORDER_STAGE.schedule;
  if (awaitingPayment(order)) return ORDER_STAGE.awaiting_payment;
  return currentStatus(order);
}

// The badge for an order follows its open request, if it has one.
export function currentStatus(order) {
  if (hasOpenReturn(order)) return RETURN_STATUS[order.return.status];
  if (order.cancel?.status === 'pending') return CANCEL_STATUS.pending;
  if (order.status === 'failed') return FAILED_STATUS[order.failed.status];
  return ORDER_STATUS[order.status];
}

// The status shown on the Return / Refunds / Cancel page, including closed requests.
export function requestStatus(order) {
  if (order.return) return RETURN_STATUS[order.return.status];
  if (order.failed) return order.status === 'failed' ? FAILED_STATUS[order.failed.status] : ORDER_STATUS[order.status];
  return CANCEL_STATUS[order.cancel.status];
}

export function needsResponse(order) {
  return order.return?.status === 'pending' || order.cancel?.status === 'pending' || order.failed?.status === 'pending';
}

export function hasOpenAction(order) {
  return needsResponse(order) || order.return?.status === 'awaiting' || order.failed?.status === 'returning';
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
}

async function act(orders, action, data) {
  // Any load already running may predate this change, so it must not overwrite the result.
  latestLoad += 1;
  try {
    const { orders: updated, failed } = await send('/api/seller/orders/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: orders.map((order) => order.id), action, data }),
    });
    orderState.set((state) => ({
      ...state,
      orders: state.orders.map((order) => updated.find((other) => other.id === order.id) || order),
    }));
    return failed || [];
  } catch (err) {
    loadOrders(orderState.get().owner);
    throw err;
  }
}

export const Orders = {
  approve: (order) => act([order], 'approve'),
  requestPickup: (orders, data) => act(orders, 'requestPickup', data),
  reattempt: (order) => act([order], 'reattempt'),
  returnToSeller: (order) => act([order], 'returnToSeller'),
  receiveFailed: (order) => act([order], 'receiveFailed'),
  cancel: (order, reason) => act([order], 'cancel', { reason }),
  approveCancel: (order) => act([order], 'approveCancel'),
  rejectCancel: (order, note) => act([order], 'rejectCancel', { note }),
  approveReturn: (order) => act([order], 'approveReturn'),
  rejectReturn: (order, note) => act([order], 'rejectReturn', { note }),
  receiveReturn: (order) => act([order], 'receiveReturn'),
};
