// Bottom-left chat between customers and sellers.
// Threads live in localStorage, so a seller logged in on another tab sees a customer's
// message immediately through the storage event. Replace Threads with a realtime
// backend (WebSocket) to connect different devices.

const Threads = {
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
    const other = from === 'customer' ? 'seller' : 'customer';
    thread.messages.push({ from, text, ts: Date.now() });
    thread.unread[other] += 1;
    this.upsert(thread);
  },

  markRead(id, role) {
    const thread = this.find(id);
    if (!thread || !thread.unread[role]) return;
    thread.unread[role] = 0;
    this.upsert(thread);
  },
};

const Chat = {
  panel: document.getElementById('chat-panel'),
  launcher: document.getElementById('chat-launcher'),
  role: 'customer',
  activeId: null,
  replyIndex: 0,

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
    const registered = Auth.sellers().map((s) => ({ id: `seller:${s.username}`, name: s.shopName }));
    return [...SHOPS, ...registered];
  },

  sellerShop() {
    const seller = Auth.session('seller');
    return seller ? { id: `seller:${seller.username}`, name: seller.shopName } : null;
  },

  threadsForRole() {
    const key = this.role === 'customer' ? ['customerId', this.customerIdentity().id] : ['shopId', this.sellerShop()?.id];
    return Threads.all()
      .filter((t) => t[key[0]] === key[1])
      .sort((a, b) => (b.messages.at(-1)?.ts || 0) - (a.messages.at(-1)?.ts || 0));
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

  // A new shop would otherwise open to an empty inbox, with nothing to try replying to.
  seedSellerInbox(shop) {
    const id = `sample-buyer::${shop.id}`;
    if (Threads.find(id)) return;
    Threads.upsert({
      id,
      customerId: 'sample-buyer',
      customerName: 'Sample Buyer',
      shopId: shop.id,
      shopName: shop.name,
      messages: [{ from: 'customer', text: 'Hi! Is this item still available?', ts: Date.now() }],
      unread: { customer: 0, seller: 1 },
    });
  },

  // Guests keep their conversations when they log in or sign up.
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
    if (role && role !== this.role) {
      this.role = role;
      this.activeId = null;
    }
    this.panel.hidden = false;
    this.launcher.setAttribute('aria-expanded', 'true');
    this.render();
  },

  close() {
    this.panel.hidden = true;
    this.launcher.setAttribute('aria-expanded', 'false');
    this.launcher.focus();
  },

  openShop(shopId, draft = '') {
    const shop = this.shops().find((s) => s.id === shopId);
    this.role = 'customer';
    this.activeId = this.ensureThread(shop);
    this.open();
    const input = this.panel.querySelector('#chat-input');
    input.value = draft;
    input.focus();
  },

  render() {
    this.updateBadge();
    if (this.panel.hidden) return;
    const thread = this.activeId && Threads.find(this.activeId);
    if (thread) this.renderThread(thread);
    else this.renderList();
  },

  headerHtml(title, back) {
    return `
      <header class="chat__head">
        ${back ? `<button class="icon-btn" type="button" data-chat="back" aria-label="Back to conversations">${icon('arrow-left')}</button>` : ''}
        <h2>${esc(title)}</h2>
        <button class="icon-btn" type="button" data-chat="close" aria-label="Close chat">${icon('close')}</button>
      </header>`;
  },

  tabsHtml() {
    const counts = { customer: 0, seller: 0 };
    const shop = this.sellerShop();
    const customerId = this.customerIdentity().id;
    Threads.all().forEach((t) => {
      if (t.customerId === customerId) counts.customer += t.unread.customer;
      if (shop && t.shopId === shop.id) counts.seller += t.unread.seller;
    });
    const tab = (role, label) => `
      <button class="chat__tab" type="button" role="tab" data-chat-role="${role}" aria-selected="${this.role === role}">
        ${label}${counts[role] ? `<span class="count">${counts[role]}</span>` : ''}
      </button>`;
    return `<div class="chat__tabs" role="tablist" aria-label="Chat as">${tab('customer', 'Customer')}${tab('seller', 'Seller')}</div>`;
  },

  renderList() {
    this.panel.innerHTML = `${this.headerHtml('Chat', false)}${this.tabsHtml()}<div class="chat__body" id="chat-body"></div>`;
    const body = this.panel.querySelector('#chat-body');

    if (this.role === 'seller' && !this.sellerShop()) {
      body.innerHTML = `
        <div class="empty">
          <p>Log in to Seller Centre to read and answer your customers.</p>
          <a class="btn btn--primary" href="#/seller/login">Go to Seller Centre</a>
        </div>`;
      return;
    }

    const threads = this.threadsForRole();
    threads.forEach((t) => body.append(this.threadRow(t)));

    if (this.role === 'customer') {
      const started = new Set(threads.map((t) => t.shopId));
      const fresh = this.shops().filter((s) => !started.has(s.id));
      if (fresh.length) {
        const heading = document.createElement('h3');
        heading.className = 'chat__section';
        heading.textContent = 'Message a shop';
        body.append(heading);
        fresh.forEach((shop) => body.append(this.row(shop.name, 'Start a conversation', 0, () => {
          this.activeId = this.ensureThread(shop);
          this.render();
        })));
      }
    }
  },

  threadRow(thread) {
    const name = this.role === 'customer' ? thread.shopName : thread.customerName;
    const last = thread.messages.at(-1)?.text || 'No messages yet';
    return this.row(name, last, thread.unread[this.role], () => {
      this.activeId = thread.id;
      this.render();
    });
  },

  row(name, preview, unread, onClick) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chat__row';
    row.innerHTML = `
      <span class="chat__avatar"></span>
      <span class="chat__row-text"><strong></strong><small></small></span>
      ${unread ? `<span class="count">${unread}</span>` : ''}`;
    row.querySelector('.chat__avatar').textContent = name[0].toUpperCase();
    row.querySelector('strong').textContent = name;
    row.querySelector('small').textContent = preview;
    row.addEventListener('click', onClick);
    return row;
  },

  renderThread(thread) {
    Threads.markRead(thread.id, this.role);
    const title = this.role === 'customer' ? thread.shopName : thread.customerName;
    const existing = this.panel.querySelector(`[data-thread="${CSS.escape(thread.id)}"]`);
    if (!existing) {
      const draft = this.panel.querySelector('#chat-input')?.value || '';
      this.panel.innerHTML = `
        ${this.headerHtml(title, true)}
        <div class="chat__messages" role="log" aria-live="polite" tabindex="0"></div>
        <form class="composer" id="chat-form">
          <label class="sr-only" for="chat-input">Message ${esc(title)}</label>
          <input id="chat-input" autocomplete="off" maxlength="500" placeholder="Write a message">
          <button class="btn btn--primary" type="submit" aria-label="Send message">${icon('send')}</button>
        </form>`;
      this.panel.firstElementChild.dataset.thread = thread.id;
      this.panel.querySelector('#chat-input').value = draft;
      this.panel.querySelector('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this.send();
      });
    }
    const log = this.panel.querySelector('.chat__messages');
    log.replaceChildren(...thread.messages.map((m) => this.messageNode(m)));
    if (!thread.messages.length) {
      const hint = document.createElement('p');
      hint.className = 'chat__hint';
      hint.textContent = 'Say hello to start the conversation.';
      log.append(hint);
    }
    log.scrollTop = log.scrollHeight;
    this.updateBadge();
  },

  messageNode(message) {
    const node = bubble(message.from === this.role ? 'me' : 'them', message.text);
    const time = document.createElement('time');
    time.textContent = new Date(message.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    node.append(time);
    return node;
  },

  send() {
    const input = this.panel.querySelector('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const { id } = Threads.find(this.activeId);
    Threads.post(id, this.role, text);
    this.render();
    this.scheduleDemoReply(id);
  },

  // Sample shops and the sample buyer have nobody behind them, so they answer automatically.
  scheduleDemoReply(id) {
    const thread = Threads.find(id);
    let from;
    let text;
    if (this.role === 'customer' && SHOPS.some((s) => s.id === thread.shopId)) {
      from = 'seller';
      text = SHOP_AUTO_REPLIES[this.replyIndex % SHOP_AUTO_REPLIES.length];
      this.replyIndex += 1;
    } else if (this.role === 'seller' && thread.customerId === 'sample-buyer') {
      from = 'customer';
      text = 'Great, thanks for the quick reply!';
    } else {
      return;
    }
    setTimeout(() => {
      Threads.post(id, from, text);
      this.render();
    }, 900);
  },

  updateBadge() {
    const customerId = this.customerIdentity().id;
    const shop = this.sellerShop();
    const total = Threads.all().reduce((sum, t) => sum
      + (t.customerId === customerId ? t.unread.customer : 0)
      + (shop && t.shopId === shop.id ? t.unread.seller : 0), 0);
    const badge = document.getElementById('chat-unread');
    badge.hidden = !total;
    badge.textContent = total;
    badge.setAttribute('aria-label', `${total} unread`);
  },

  init() {
    this.launcher.addEventListener('click', () => {
      if (this.panel.hidden) this.open();
      else this.close();
    });

    this.panel.addEventListener('click', (e) => {
      const roleTab = e.target.closest('[data-chat-role]');
      const control = e.target.closest('[data-chat]');
      if (roleTab) {
        this.role = roleTab.dataset.chatRole;
        this.render();
      } else if (control?.dataset.chat === 'close') {
        this.close();
      } else if (control?.dataset.chat === 'back') {
        this.activeId = null;
        this.render();
      }
    });

    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'onetap.chats') this.render();
    });

    document.addEventListener('onetap:session', () => {
      this.adoptGuestThreads();
      this.activeId = null;
      if (this.sellerShop()) this.seedSellerInbox(this.sellerShop());
      this.render();
    });

    if (this.sellerShop()) this.seedSellerInbox(this.sellerShop());
    this.render();
  },
};
