// Shared UI primitives: escaping, icons, toasts, modal, popovers, theme.

function esc(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

function icon(name, cls = 'icon') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function peso(amount) {
  return `₱${amount.toLocaleString('en-PH')}`;
}

function toast(message, type = 'info') {
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.textContent = message;
  document.getElementById('toasts').append(node);
  setTimeout(() => node.remove(), 3800);
}

const Modal = {
  el: document.getElementById('modal'),

  // `render` receives the body element so callers can bind events after inserting html.
  open({ title, html = '', variant = '', render }) {
    this.el.className = `modal ${variant ? `modal--${variant}` : ''}`;
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.innerHTML = html;
    if (render) render(body);
    if (!this.el.open) this.el.showModal();
    body.scrollTop = 0;
  },

  close() {
    if (this.el.open) this.el.close();
  },

  init() {
    document.getElementById('modal-close').addEventListener('click', () => this.close());
    // A click on the dialog itself is a click on the backdrop.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  },
};

const Popovers = {
  closeAll(exceptId) {
    document.querySelectorAll('[data-popover-toggle]').forEach((btn) => {
      if (btn.dataset.popoverToggle === exceptId) return;
      btn.setAttribute('aria-expanded', 'false');
      document.getElementById(btn.dataset.popoverToggle).hidden = true;
    });
  },

  init() {
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-popover-toggle]');
      if (toggle) {
        const panel = document.getElementById(toggle.dataset.popoverToggle);
        this.closeAll(panel.id);
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
      } else if (!e.target.closest('.popover')) {
        this.closeAll();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelector('[data-popover-toggle][aria-expanded="true"]');
      if (open) {
        this.closeAll();
        open.focus();
      }
    });
  },
};

const Theme = {
  apply(theme) {
    document.documentElement.dataset.theme = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    document.getElementById('theme-icon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    document.getElementById('theme-label').textContent = next === 'dark' ? 'Dark' : 'Light';
    document.getElementById('theme-toggle').setAttribute('aria-label', `Switch to ${next} mode`);
  },

  init() {
    this.apply(document.documentElement.dataset.theme);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      Store.set('theme', next);
      this.apply(next);
    });
    // Follow the OS only until the visitor makes an explicit choice.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!Store.get('theme')) this.apply(e.matches ? 'dark' : 'light');
    });
  },
};
