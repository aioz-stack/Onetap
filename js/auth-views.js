// Customer auth modals and the Seller Centre portal.

function loginFormHtml(prefix) {
  return `
    <form id="${prefix}-form">
      ${renderSections(LOGIN_SCHEMA, prefix)}
      <p class="form-link"><button class="link" type="button" data-forgot>Forgot Password?</button></p>
      <p class="form-error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">Log In</button>
    </form>`;
}

function openForgotPassword(role) {
  Modal.open({
    title: 'Reset your password',
    html: `
      <form id="forgot-form">
        <p class="muted">Enter your account email and we'll send you a reset link.</p>
        ${renderSections([{ fields: [{ name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email', wide: true }] }], 'forgot')}
        <button class="btn btn--primary btn--block" type="submit">Send Reset Link</button>
        <p class="form-switch"><button class="link" type="button" id="forgot-back">Back to Log In</button></p>
      </form>`,
    render(body) {
      bindForm(body.querySelector('form'), async () => {
        // Needs a mail backend. The reply is the same either way so accounts can't be probed.
        Modal.open({
          title: 'Check your email',
          html: '<p class="muted">If an account matches that email, a reset link is on its way.</p>',
        });
      });
      body.querySelector('#forgot-back').addEventListener('click', () => {
        if (role === 'customer') openCustomerLogin();
        else Modal.close();
      });
    },
  });
}

function openCustomerLogin() {
  Modal.open({
    title: 'Log in to Onetap',
    html: `${loginFormHtml('login')}
      <p class="form-switch">Don't have an account? <button class="link" type="button" id="to-signup">Sign Up</button></p>`,
    render(body) {
      bindForm(body.querySelector('form'), async ({ identifier, password }) => {
        const user = await Auth.login('customer', identifier, password);
        Modal.close();
        toast(`Welcome back, ${user.firstName}!`, 'success');
      });
      body.querySelector('[data-forgot]').addEventListener('click', () => openForgotPassword('customer'));
      body.querySelector('#to-signup').addEventListener('click', openCustomerSignup);
    },
  });
}

function openCustomerSignup() {
  Modal.open({
    title: 'Create your Onetap account',
    variant: 'wide',
    html: `
      <form id="signup-form">
        ${renderSections(CUSTOMER_SCHEMA, 'signup')}
        <p class="form-error" role="alert"></p>
        <button class="btn btn--primary btn--block" type="submit">Sign Up</button>
      </form>
      <p class="form-switch">Already have an account? <button class="link" type="button" id="to-login">Log In</button></p>`,
    render(body) {
      bindForm(body.querySelector('form'), async (data) => {
        const user = await Auth.register('customer', data);
        Modal.close();
        toast(`Welcome to Onetap, ${user.firstName}!`, 'success');
      });
      body.querySelector('#to-login').addEventListener('click', openCustomerLogin);
    },
  });
}

function renderSellerPortal(mode) {
  const view = document.getElementById('view-seller');
  const isLogin = mode === 'login';
  view.innerHTML = `
    <section class="container portal">
      <aside class="portal__intro">
        <span class="pill">${icon('store')} Seller Centre</span>
        <h1 tabindex="-1">Grow your shop with Onetap</h1>
        <p>Reach shoppers nationwide and manage your store from one place.</p>
        <ul class="portal__points">
          <li>${icon('truck')} Nationwide delivery partners</li>
          <li>${icon('chat')} Built-in customer chat</li>
          <li>${icon('shield')} Protected seller payouts</li>
        </ul>
      </aside>
      <div class="portal__panel">
        <nav class="tabs" aria-label="Seller Centre access">
          <a class="tabs__tab" href="#/seller/login" ${isLogin ? 'aria-current="page"' : ''}>Log In</a>
          <a class="tabs__tab" href="#/seller/register" ${isLogin ? '' : 'aria-current="page"'}>Register as Seller</a>
        </nav>
        ${isLogin ? sellerLoginHtml() : sellerRegisterHtml()}
      </div>
    </section>`;

  const form = view.querySelector('form');
  if (isLogin) {
    bindForm(form, async ({ identifier, password }) => {
      await Auth.login('seller', identifier, password);
      location.hash = '#/seller/dashboard';
    });
    view.querySelector('[data-forgot]').addEventListener('click', () => openForgotPassword('seller'));
  } else {
    bindForm(form, async (data) => {
      const user = await Auth.register('seller', data);
      toast(`${user.shopName} is open for business!`, 'success');
      location.hash = '#/seller/dashboard';
    });
  }
}

function sellerLoginHtml() {
  return `
    <h2>Log in to your shop</h2>
    ${loginFormHtml('seller-login')}
    <p class="form-switch">New to Onetap? <a class="link" href="#/seller/register">Register as a seller</a></p>`;
}

function sellerRegisterHtml() {
  return `
    <h2>Register your shop</h2>
    <form id="seller-register-form">
      ${renderSections(SELLER_SCHEMA, 'seller')}
      <p class="form-error" role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">Create Seller Account</button>
    </form>
    <p class="form-switch">Already selling on Onetap? <a class="link" href="#/seller/login">Log in</a></p>`;
}

function renderSellerDashboard(seller) {
  const location_ = [seller.street, seller.barangay, seller.city, seller.province, seller.zip, seller.country].join(', ');
  document.getElementById('view-seller').innerHTML = `
    <section class="container dashboard">
      <div class="dashboard__head">
        <div>
          <p class="eyebrow">Seller Centre</p>
          <h1 tabindex="-1">${esc(seller.shopName)}</h1>
          <p class="muted">Signed in as ${esc(seller.username)}</p>
        </div>
        <div class="dashboard__actions">
          <button class="btn btn--primary" type="button" data-action="seller-inbox">${icon('chat')} Open Inbox</button>
          <button class="btn btn--ghost" type="button" data-action="seller-logout">Log Out</button>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><span class="stat__value">0</span><span class="muted">Listed products</span></div>
        <div class="stat"><span class="stat__value">0</span><span class="muted">Open orders</span></div>
        <div class="stat"><span class="stat__value">${peso(0)}</span><span class="muted">Sales this month</span></div>
      </div>
      <div class="card">
        <h2>Shop address</h2>
        <p class="muted">${esc(location_)}</p>
      </div>
    </section>`;
}
