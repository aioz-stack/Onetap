// Browser persistence and the mock auth backend.
// Everything here lives in localStorage. Swap Auth for real API calls before launch:
// client-side auth is for prototyping only and protects nothing.

const Store = {
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
  },
  remove(key) {
    try {
      localStorage.removeItem(`onetap.${key}`);
    } catch {
      // Same as above.
    }
  },
};

class FieldError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const Auth = {
  async _hash(password, salt) {
    if (!crypto.subtle) {
      throw new Error('Secure sign-in needs https, localhost or a local file.');
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150000 },
      key,
      256,
    );
    return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },

  _users() {
    return Store.get('users', []);
  },

  _public({ hash, salt, ...user }) {
    return user;
  },

  async register(role, data) {
    const users = this._users();
    const username = data.username.trim();
    const email = data.email.trim().toLowerCase();
    const sameRole = users.filter((u) => u.role === role);
    if (sameRole.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new FieldError('username', 'That username is already taken.');
    }
    if (sameRole.some((u) => u.email === email)) {
      throw new FieldError('email', 'An account with this email already exists.');
    }
    const { password, ...profile } = data;
    const salt = crypto.getRandomValues(new Uint32Array(4)).join('-');
    const user = { ...profile, username, email, role, salt, hash: await this._hash(password, salt), createdAt: Date.now() };
    Store.set('users', [...users, user]);
    this._startSession(user);
    return this._public(user);
  },

  async login(role, identifier, password) {
    const id = identifier.trim().toLowerCase();
    const user = this._users().find(
      (u) => u.role === role && (u.username.toLowerCase() === id || u.email === id),
    );
    // Same message for both failures so the form doesn't reveal which accounts exist.
    if (!user || (await this._hash(password, user.salt)) !== user.hash) {
      throw new FieldError('password', 'Incorrect username, email or password.');
    }
    this._startSession(user);
    return this._public(user);
  },

  logout(role) {
    Store.remove(`session.${role}`);
    document.dispatchEvent(new CustomEvent('onetap:session', { detail: { role } }));
  },

  session(role) {
    return Store.get(`session.${role}`);
  },

  sellers() {
    return this._users().filter((u) => u.role === 'seller').map((u) => this._public(u));
  },

  _startSession(user) {
    Store.set(`session.${user.role}`, this._public(user));
    document.dispatchEvent(new CustomEvent('onetap:session', { detail: { role: user.role } }));
  },
};
