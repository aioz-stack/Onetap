// Page wiring: router, storefront, cart, top-bar controls and global actions.

const view = (id) => document.getElementById(`view-${id}`);

const Router = {
  firstRun: true,

  path() {
    return location.hash.startsWith('#/') ? location.hash.slice(1) : '/';
  },

  show(id) {
    ['home', 'seller', 'help'].forEach((name) => {
      view(name).hidden = name !== id;
    });
  },

  resolve() {
    const path = this.path();
    const seller = Auth.session('seller');
    Modal.close();
    closeMobileNav();

    if (path === '/help') {
      renderHelp();
      this.show('help');
      document.title = 'Help Centre | Onetap';
    } else if (path.startsWith('/seller')) {
      if (seller && path !== '/seller/dashboard') {
        location.replace('#/seller/dashboard');
        return;
      }
      if (!seller && path === '/seller/dashboard') {
        location.replace('#/seller/login');
        return;
      }
      if (seller) renderSellerDashboard(seller);
      else renderSellerPortal(path === '/seller/register' ? 'register' : 'login');
      this.show('seller');
      document.title = 'Seller Centre | Onetap';
    } else {
      this.show('home');
      document.title = 'Onetap | Mall & Marketplace';
    }

    if (location.hash === '#products') {
      scrollToDeals();
    } else {
      window.scrollTo(0, 0);
      // Move focus with the view so screen readers announce the new page.
      if (!this.firstRun) document.querySelector('.view:not([hidden]) h1')?.focus({ preventScroll: true });
    }
    this.firstRun = false;
  },
};

function scrollToDeals() {
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

const Storefront = {
  category: 'All',
  query: '',

  matches(product) {
    const inCategory = this.category === 'All' || product.category === this.category;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const text = `${product.name} ${product.category}`.toLowerCase();
    return inCategory && words.every((w) => text.includes(w));
  },

  card(p) {
    const off = Math.round((1 - p.price / p.was) * 100);
    return `
      <article class="product">
        <div class="product__image" style="--tint:${p.tint}"><span aria-hidden="true">${p.emoji}</span><span class="product__off">-${off}%</span></div>
        <div class="product__body">
          <h3>${esc(p.name)}</h3>
          <p class="product__price">${peso(p.price)} <s>${peso(p.was)}</s></p>
          <p class="product__meta">${icon('star', 'icon icon--sm')} ${p.rating} · ${p.sold} sold</p>
          <div class="product__actions">
            <button class="btn btn--primary btn--sm" type="button" data-action="add-to-cart" data-id="${p.id}">Add to Cart</button>
            <button class="icon-btn icon-btn--bordered" type="button" data-action="chat-shop" data-id="${p.id}" aria-label="Chat with seller about ${esc(p.name)}">${icon('chat')}</button>
          </div>
        </div>
      </article>`;
  },

  render() {
    const list = PRODUCTS.filter((p) => this.matches(p));
    document.getElementById('product-grid').innerHTML = list.map((p) => this.card(p)).join('');
    const status = document.getElementById('deals-status');
    if (this.query) status.textContent = `${list.length} ${list.length === 1 ? 'result' : 'results'} for "${this.query}"`;
    else status.textContent = list.length ? '' : 'No products in this category.';
    document.querySelectorAll('#category-chips .chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.category === this.category));
    });
  },

  search(query) {
    this.query = query.trim();
    this.category = 'All';
    this.render();
    if (Router.path() === '/') scrollToDeals();
    else location.hash = '#products';
  },

  init() {
    document.getElementById('category-chips').innerHTML = CATEGORIES
      .map((c) => `<button class="chip" type="button" data-category="${esc(c)}">${esc(c)}</button>`).join('');
    document.getElementById('category-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      this.category = chip.dataset.category;
      this.render();
    });

    const hotDeals = document.getElementById('hot-deals');
    HOT_DEALS.forEach((term) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = term;
      btn.addEventListener('click', () => {
        document.getElementById('search-input').value = term;
        this.search(term);
      });
      hotDeals.append(btn);
    });

    document.getElementById('search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.search(document.getElementById('search-input').value);
    });
    document.getElementById('search-input').addEventListener('search', (e) => {
      if (!e.target.value) this.search('');
    });

    this.render();
  },
};

const Cart = {
  items: Store.get('cart', {}),

  count() {
    return Object.values(this.items).reduce((sum, qty) => sum + qty, 0);
  },

  change(id, delta) {
    const qty = (this.items[id] || 0) + delta;
    if (qty > 0) this.items[id] = qty;
    else delete this.items[id];
    Store.set('cart', this.items);
    this.updateBadge();
  },

  updateBadge() {
    document.getElementById('cart-count').textContent = this.count();
    document.querySelector('.cart-btn').setAttribute('aria-label', `Open cart, ${this.count()} items`);
  },

  html() {
    const rows = Object.entries(this.items).map(([id, qty]) => {
      const p = PRODUCTS.find((item) => item.id === id);
      return { p, qty };
    }).filter((row) => row.p);
    if (!rows.length) {
      return `<div class="empty"><p>Your cart is empty.</p>
        <button class="btn btn--primary" type="button" data-action="close-modal-deals">Browse Deals</button></div>`;
    }
    const total = rows.reduce((sum, { p, qty }) => sum + p.price * qty, 0);
    return `
      <ul class="cart-list">
        ${rows.map(({ p, qty }) => `
          <li class="cart-row">
            <span class="cart-row__image" style="--tint:${p.tint}" aria-hidden="true">${p.emoji}</span>
            <div class="cart-row__text">
              <strong>${esc(p.name)}</strong>
              <span>${peso(p.price * qty)}</span>
              <div class="stepper">
                <button type="button" data-cart="-1" data-id="${p.id}" aria-label="Remove one ${esc(p.name)}">−</button>
                <span aria-label="Quantity">${qty}</span>
                <button type="button" data-cart="1" data-id="${p.id}" aria-label="Add one ${esc(p.name)}">+</button>
              </div>
            </div>
            <button class="icon-btn" type="button" data-cart="${-qty}" data-id="${p.id}" aria-label="Delete ${esc(p.name)} from cart">${icon('trash')}</button>
          </li>`).join('')}
      </ul>
      <div class="cart-total"><span>Subtotal</span><strong>${peso(total)}</strong></div>
      <button class="btn btn--primary btn--block" type="button" data-action="checkout">Checkout</button>`;
  },

  open() {
    Modal.open({ title: 'Your Cart', variant: 'drawer', html: this.html() });
  },

  init() {
    this.updateBadge();
    document.getElementById('modal-body').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cart]');
      if (!btn) return;
      this.change(btn.dataset.id, Number(btn.dataset.cart));
      this.open();
    });
  },
};

const Carousel = {
  index: 0,
  timer: null,

  go(index) {
    const slides = [...document.querySelectorAll('#carousel .slide')];
    this.index = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.hidden = i !== this.index;
    });
    document.querySelectorAll('#carousel-dots button').forEach((dot, i) => {
      dot.setAttribute('aria-current', String(i === this.index));
    });
  },

  start() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.timer = setInterval(() => this.go(this.index + 1), 6000);
  },

  stop() {
    clearInterval(this.timer);
  },

  init() {
    const dots = document.getElementById('carousel-dots');
    document.querySelectorAll('#carousel .slide').forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show slide ${i + 1}`);
      dot.addEventListener('click', () => this.go(i));
      dots.append(dot);
    });
    const root = document.getElementById('carousel');
    root.addEventListener('mouseenter', () => this.stop());
    root.addEventListener('mouseleave', () => this.start());
    root.addEventListener('focusin', () => this.stop());
    this.go(0);
    this.start();
  },
};

const Notifications = {
  render() {
    const read = Store.get('notifRead', []);
    const unread = NOTIFICATIONS.filter((n) => !read.includes(n.id)).length;
    const count = document.getElementById('notif-count');
    count.hidden = !unread;
    count.textContent = unread;
    count.setAttribute('aria-label', `${unread} unread`);
    document.getElementById('notif-panel').innerHTML = `
      <div class="popover__head">
        <strong>Notifications</strong>
        <button class="link" type="button" id="notif-read-all" ${unread ? '' : 'disabled'}>Mark all as read</button>
      </div>
      ${NOTIFICATIONS.map((n) => `
        <div class="notif ${read.includes(n.id) ? '' : 'notif--unread'}">
          <strong>${esc(n.title)}</strong>
          <span>${esc(n.body)}</span>
          <small>${esc(n.time)}</small>
        </div>`).join('')}`;
    document.getElementById('notif-read-all').addEventListener('click', () => {
      Store.set('notifRead', NOTIFICATIONS.map((n) => n.id));
      this.render();
    });
  },
};

const Language = {
  current: Store.get('lang', 'en'),

  apply(lang) {
    this.current = lang;
    Store.set('lang', lang);
    const strings = I18N[lang];
    document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      node.textContent = strings[node.dataset.i18n];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      node.placeholder = strings[node.dataset.i18nPlaceholder];
    });
    document.getElementById('lang-label').textContent = lang === 'fil' ? 'Filipino' : 'English';
    renderAuthSlot();
  },

  init() {
    document.getElementById('lang-panel').addEventListener('click', (e) => {
      const option = e.target.closest('[data-lang]');
      if (!option) return;
      this.apply(option.dataset.lang);
      Popovers.closeAll();
    });
    this.apply(this.current);
  },
};

function renderAuthSlot() {
  const slot = document.getElementById('auth-slot');
  const strings = I18N[Language.current];
  const user = Auth.session('customer');
  if (user) {
    slot.innerHTML = `
      <span class="topnav__item topnav__user"></span>
      <button class="topnav__item" type="button" data-action="logout">${esc(strings.logout)}</button>`;
    slot.querySelector('.topnav__user').textContent = `Hi, ${user.firstName}`;
  } else {
    slot.innerHTML = `
      <button class="topnav__item" type="button" data-action="signup">${esc(strings.signUp)}</button>
      <button class="topnav__item" type="button" data-action="login">${esc(strings.login)}</button>`;
  }
}

function qrSvg(text, label) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const quiet = 4;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  const box = size + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="${box}" height="${box}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

function renderDownload() {
  const panel = document.getElementById('download-panel');
  panel.innerHTML = `
    <div id="download-qr"></div>
    <div class="store-links" role="group" aria-label="Choose your app store">
      ${CONFIG.appLinks.map((app, i) => `
        <button class="store-link" type="button" data-store="${i}">${icon(app.icon)}${esc(app.store)}</button>`).join('')}
    </div>
    <a class="store-open link" id="download-open" target="_blank" rel="noopener"></a>`;
  panel.addEventListener('click', (e) => {
    const option = e.target.closest('[data-store]');
    if (option) selectStore(Number(option.dataset.store));
  });
  selectStore(0);
}

function selectStore(index) {
  const app = CONFIG.appLinks[index];
  document.getElementById('download-qr').innerHTML = qrSvg(app.url, `QR code for Onetap on ${app.store}`);
  document.querySelectorAll('[data-store]').forEach((option, i) => {
    option.setAttribute('aria-pressed', String(i === index));
  });
  const open = document.getElementById('download-open');
  open.href = app.url;
  open.textContent = `Open in ${app.store}`;
}

function claimVouchers() {
  if (!Auth.session('customer')) {
    toast('Log in or sign up to claim your vouchers.');
    openCustomerLogin();
    return;
  }
  if (Store.get('vouchersClaimed')) {
    toast('You already claimed today\'s vouchers.');
    return;
  }
  Store.set('vouchersClaimed', true);
  toast('Vouchers claimed! They will apply at checkout.', 'success');
}

function checkout() {
  if (!Auth.session('customer')) {
    toast('Log in to check out.');
    openCustomerLogin();
    return;
  }
  toast('Checkout is coming soon.');
}

const ACTIONS = {
  login: openCustomerLogin,
  signup: openCustomerSignup,
  logout() {
    Auth.logout('customer');
    toast('You have been logged out.');
  },
  'seller-logout'() {
    Auth.logout('seller');
    location.hash = '#/seller/login';
  },
  'seller-inbox': () => Chat.open('seller'),
  cart: () => Cart.open(),
  claim: claimVouchers,
  checkout,
  'scroll-deals': scrollToDeals,
  'close-modal-deals'() {
    Modal.close();
    if (Router.path() === '/') scrollToDeals();
    else location.hash = '#products';
  },
  'add-to-cart'(btn) {
    const product = PRODUCTS.find((p) => p.id === btn.dataset.id);
    Cart.change(product.id, 1);
    toast(`Added ${product.name} to your cart.`, 'success');
  },
  'chat-shop'(btn) {
    const product = PRODUCTS.find((p) => p.id === btn.dataset.id);
    Chat.openShop(product.shop, `Hi! Is "${product.name}" available?`);
  },
  track: openTracking,
  policy: openPolicy,
  contact: openContact,
  'support-chat': () => openSupport('chat'),
  'support-ticket': () => openSupport('ticket'),
};

function closeMobileNav() {
  document.getElementById('topbar').classList.remove('is-open');
  const toggle = document.getElementById('menu-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
}

function init() {
  Object.entries(CONFIG.social).forEach(([name, url]) => {
    document.getElementById(`social-${name}`).href = url;
  });

  Modal.init();
  Popovers.init();
  Theme.init();
  Language.init();
  Storefront.init();
  Cart.init();
  Carousel.init();
  Notifications.render();
  renderDownload();
  Chat.init();

  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = ACTIONS[target.dataset.action];
    if (action) {
      e.preventDefault();
      action(target);
    }
  });

  document.getElementById('menu-toggle').addEventListener('click', (e) => {
    const open = document.getElementById('topbar').classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  document.addEventListener('onetap:session', renderAuthSlot);
  window.addEventListener('hashchange', () => Router.resolve());
  Router.resolve();
}

init();
