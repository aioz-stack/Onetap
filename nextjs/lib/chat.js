'use client';

// Chat between customers and sellers. Conversations with real shops are on the server and
// refresh by polling. Sample shops have nobody behind them, so those stay in this browser
// and answer automatically.

import { send } from './productsApi';
import { SHOPS, SHOP_AUTO_REPLIES } from './data';
import { Auth, Store } from './store';
import { createState, toast } from './ui';

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const threadPath = (role, id = '') => `/api/${role === 'seller' ? 'seller/chat' : 'chat'}/threads${id && `/${id}`}`;

export const ChatApi = {
  list: (role) => send(threadPath(role), undefined, role).then((body) => body.threads),
  open: (seller) => send('/api/chat/threads', json('POST', { seller }), 'customer').then((body) => body.thread),
  get: (role, id) => send(`${threadPath(role, id)}${document.visibilityState === 'visible' ? '?read' : ''}`, undefined, role),
  post: (role, id, message) => send(threadPath(role, id), json('POST', message), role),
  update: (id, changes) => send(threadPath('seller', id), json('PATCH', changes)).then((body) => body.thread),
  settings: () => send('/api/seller/chat/settings').then((body) => body.settings),
  saveSettings: (settings) => send('/api/seller/chat/settings', json('PUT', settings)).then((body) => body.settings),
  performance: () => send('/api/seller/chat/performance'),
};

// Conversations stored in this browser, only ever with sample shops.
export const Threads = {
  all() {
    return Store.get('chats', []);
  },

  save(threads) {
    Store.set('chats', threads);
  },

  find(id) {
    return this.all().find((t) => t.id === id);
  },

  upsert(thread) {
    this.save([...this.all().filter((t) => t.id !== thread.id), thread]);
  },

  post(id, from, text) {
    const thread = this.find(id);
    if (!thread) return;
    thread.messages.push({ from, text, ts: Date.now() });
    if (from === 'seller') thread.unread.customer += 1;
    this.upsert(thread);
  },

  markRead(id) {
    const thread = this.find(id);
    if (!thread || !thread.unread.customer) return;
    thread.unread.customer = 0;
    this.upsert(thread);
  },
};

// activeId is a sample thread when server is false.
export const chatState = createState({ open: false, role: 'customer', activeId: null, server: false, needsLogin: false, draft: '', focusRequest: 0 });
export const serverThreads = createState({ customer: [], seller: [] });
let replyIndex = 0;

// A seller only has conversations once approved.
const hasSession = (role) => {
  const account = Auth.session(role);
  return Boolean(account) && (role === 'customer' || account.applicationStatus === 'approved');
};

export const Chat = {
  guestId() {
    let id = Store.get('guestId');
    if (!id) {
      id = `guest-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
      Store.set('guestId', id);
    }
    return id;
  },

  customerIdentity() {
    const user = Auth.session('customer');
    return user
      ? { id: `customer:${user.username}`, name: `${user.firstName} ${user.lastName}` }
      : { id: this.guestId(), name: 'Guest shopper' };
  },

  shops() {
    return SHOPS;
  },

  async refreshThreads() {
    const [customer, seller] = await Promise.all(['customer', 'seller'].map((role) => (hasSession(role) ? ChatApi.list(role).catch(() => null) : [])));
    serverThreads.set((state) => ({ customer: customer ?? state.customer, seller: seller ?? state.seller }));
  },

  ensureThread(shop) {
    const customer = this.customerIdentity();
    const id = `${customer.id}::${shop.id}`;
    if (!Threads.find(id)) {
      Threads.upsert({
        id,
        customerId: customer.id,
        customerName: customer.name,
        shopId: shop.id,
        shopName: shop.name,
        messages: [],
        unread: { customer: 0, seller: 0 },
      });
    }
    return id;
  },

  // Guests keep their sample conversations when they log in or sign up.
  adoptGuestThreads() {
    const user = Auth.session('customer');
    if (!user) return;
    const guest = this.guestId();
    const { id, name } = this.customerIdentity();
    const threads = Threads.all();
    const existing = new Set(threads.map((t) => t.id));
    threads.forEach((t) => {
      const nextId = `${id}::${t.shopId}`;
      if (t.customerId === guest && !existing.has(nextId)) {
        t.id = nextId;
        t.customerId = id;
        t.customerName = name;
      }
    });
    Threads.save(threads);
  },

  open(role) {
    chatState.set((state) => (role && role !== state.role
      ? { ...state, open: true, role, activeId: null, server: false, needsLogin: false }
      : { ...state, open: true, needsLogin: false }));
  },

  // shopId is a sample shop's id, or `seller:username` for a real shop.
  async openShop(shopId, draft = '') {
    const sample = SHOPS.find((s) => s.id === shopId);
    if (sample) {
      const activeId = this.ensureThread(sample);
      chatState.set((state) => ({ ...state, open: true, role: 'customer', activeId, server: false, needsLogin: false, draft, focusRequest: state.focusRequest + 1 }));
      return;
    }
    if (!hasSession('customer')) {
      chatState.set((state) => ({ ...state, open: true, role: 'customer', activeId: null, needsLogin: true }));
      return;
    }
    let thread;
    try {
      thread = await ChatApi.open(shopId.replace(/^seller:/, ''));
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    chatState.set((state) => ({ ...state, open: true, role: 'customer', activeId: thread.id, server: true, needsLogin: false, draft, focusRequest: state.focusRequest + 1 }));
    this.refreshThreads();
  },

  openThread(id, role) {
    chatState.set((state) => ({ ...state, activeId: id, role, server: true }));
  },

  sendToSample(text) {
    const id = chatState.get().activeId;
    Threads.post(id, 'customer', text);
    setTimeout(() => {
      Threads.post(id, 'seller', SHOP_AUTO_REPLIES[replyIndex % SHOP_AUTO_REPLIES.length]);
      replyIndex += 1;
    }, 900);
  },
};
