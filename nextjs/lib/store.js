'use client';

// Browser persistence and the auth client.
// Accounts are on the server, and session.seller and session.customer are only local copies
// of the profile for display. The httpOnly cookies are what prove who someone is.


import { useState, useSyncExternalStore } from 'react';

const listeners = new Set();
const snapshots = new Map();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export const Store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`onetap.${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`onetap.${key}`, JSON.stringify(value));
    } catch {
      // Blocked or full storage: the page keeps working for this visit.
    }
    notify();
  },
  remove(key) {
    try {
      localStorage.removeItem(`onetap.${key}`);
    } catch {
      // Same as above.
    }
    notify();
  },
  // Stable between calls until the stored text changes, as useSyncExternalStore requires.
  snapshot(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(`onetap.${key}`);
    } catch {
      return fallback;
    }
    const cached = snapshots.get(key);
    if (cached && cached.raw === raw) return cached.value;
    let value = fallback;
    try {
      if (raw !== null) value = JSON.parse(raw);
    } catch {
      // Unreadable value: use the fallback.
    }
    snapshots.set(key, { raw, value });
    return value;
  },
};

// Reads a stored value and re-renders when it changes, in this tab or another.
// The server and the first client render both see the fallback, so hydration matches.
export function useStored(key, fallback = null) {
  const [initial] = useState(fallback);
  return useSyncExternalStore(subscribe, () => Store.snapshot(key, initial), () => initial);
}

const noSubscribe = () => () => {};

// False until stored values are readable. Guards use it so they never act on the fallback.
export function useHydrated() {
  return useSyncExternalStore(noSubscribe, () => true, () => false);
}

export class FieldError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

async function accountRequest(role, path, data) {
  let response;
  try {
    const options = data instanceof FormData
      ? { body: data }
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
    response = await fetch(`/api/${role}/auth/${path}`, { method: 'POST', ...options });
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const [field] = Object.keys(body.fields || {});
    throw field ? new FieldError(field, body.fields[field]) : new Error(body.error || 'Something went wrong. Please try again.');
  }
  return body.account;
}

export const Auth = {
  async register(role, data) {
    // Seller registration carries document files.
    const body = role === 'seller' ? new FormData() : data;
    if (role === 'seller') Object.entries(data).forEach(([key, value]) => body.append(key, value));
    return this.setAccount(await accountRequest(role, 'register', body));
  },

  async login(role, identifier, password) {
    return this.setAccount(await accountRequest(role, 'login', { identifier, password }));
  },

  async logout(role) {
    // The cookie must be gone first, or the server would still treat them as signed in.
    await accountRequest(role, 'logout', {}).catch(() => {});
    this.clearAccount(role);
  },

  session(role) {
    return Store.get(`session.${role}`);
  },

  // Keeps this browser's copy of the account.
  setAccount(account) {
    if (JSON.stringify(this.session(account.role)) !== JSON.stringify(account)) {
      Store.set(`session.${account.role}`, account);
      document.dispatchEvent(new CustomEvent('onetap:session', { detail: { role: account.role } }));
    }
    return account;
  },

  clearAccount(role) {
    Store.remove(`session.${role}`);
    document.dispatchEvent(new CustomEvent('onetap:session', { detail: { role } }));
  },
};
