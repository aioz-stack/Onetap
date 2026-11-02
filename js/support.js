// Help Centre: FAQ search, support modal (live chat and tickets), order tracking, policy.

const TICKET_SCHEMA = [{
  fields: [
    { name: 'name', label: 'Your Name', autocomplete: 'name' },
    { name: 'email', label: 'Email Address', type: 'email', autocomplete: 'email' },
    { name: 'topic', label: 'Topic', type: 'select', options: ['Order issue', 'Return or refund', 'Payment', 'Account', 'Selling on Onetap', 'Something else'] },
    { name: 'order', label: 'Order Number', optional: true, placeholder: 'OT-100245' },
    { name: 'message', label: 'How can we help?', type: 'textarea', minlength: 10, maxlength: 1000, wide: true },
  ],
}];

function faqHtml(items) {
  if (!items.length) {
    return `<div class="empty"><p>No answers match that search.</p>
      <button class="btn btn--primary" type="button" data-action="support-ticket">Submit a Ticket</button></div>`;
  }
  return items.map((f) => `
    <details class="faq">
      <summary><span class="faq__topic">${esc(f.topic)}</span>${esc(f.q)}${icon('chevron', 'icon faq__chevron')}</summary>
      <p>${esc(f.a)}</p>
    </details>`).join('');
}

function searchFaqs(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return FAQS.filter((f) => {
    const haystack = `${f.topic} ${f.q} ${f.a}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function renderHelp() {
  const view = document.getElementById('view-help');
  view.innerHTML = `
    <section class="help-hero">
      <div class="container">
        <h1 tabindex="-1">How can we help?</h1>
        <div class="help-search">
          ${icon('search')}
          <label class="sr-only" for="faq-search">Search the Help Centre</label>
          <input id="faq-search" type="search" placeholder="Search for answers" autocomplete="off">
        </div>
      </div>
    </section>
    <section class="container help-body">
      <div class="quick-links" aria-label="Quick links">
        <button class="quick-link" type="button" data-action="track">${icon('truck')}<span><strong>Order Tracking</strong><small>See where your parcel is</small></span></button>
        <button class="quick-link" type="button" data-action="policy">${icon('refund')}<span><strong>Return/Refund Policy</strong><small>7-day free returns</small></span></button>
        <button class="quick-link" type="button" data-action="contact">${icon('mail')}<span><strong>Contact Us</strong><small>Email and support hours</small></span></button>
      </div>
      <div class="help-columns">
        <div>
          <h2>Frequently asked questions</h2>
          <p class="sr-only" id="faq-status" role="status"></p>
          <div id="faq-list">${faqHtml(FAQS)}</div>
        </div>
        <aside class="card help-cta">
          <h2>Still need help?</h2>
          <p class="muted">Chat with our support team or send us a ticket.</p>
          <button class="btn btn--primary btn--block" type="button" data-action="support-chat">${icon('chat')} Live Chat</button>
          <button class="btn btn--ghost btn--block" type="button" data-action="support-ticket">Submit a Ticket</button>
        </aside>
      </div>
    </section>`;

  const list = view.querySelector('#faq-list');
  view.querySelector('#faq-search').addEventListener('input', (e) => {
    const matches = searchFaqs(e.target.value);
    list.innerHTML = faqHtml(matches);
    view.querySelector('#faq-status').textContent = `${matches.length} ${matches.length === 1 ? 'answer' : 'answers'} found`;
    if (e.target.value.trim() && matches.length) list.querySelector('details').open = true;
  });
}

function supportReply(text) {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = FAQS
    .map((f) => ({ f, score: words.filter((w) => `${f.q} ${f.a}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].f.a;
  return "I couldn't find an answer to that. Please submit a ticket and our team will follow up by email.";
}

function bubble(from, text) {
  const node = document.createElement('div');
  node.className = `bubble bubble--${from}`;
  node.textContent = text;
  return node;
}

function bindLiveChat(body) {
  const log = body.querySelector('.support-log');
  const form = body.querySelector('#support-chat-form');
  log.append(bubble('them', 'Hi! This is Onetap Support. What can we help you with today?'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = form.elements.message.value.trim();
    if (!text) return;
    form.reset();
    log.append(bubble('me', text));
    log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      log.append(bubble('them', supportReply(text)));
      log.scrollTop = log.scrollHeight;
    }, 600);
  });
  form.elements.message.focus();
}

function bindTicketForm(body) {
  const form = body.querySelector('#ticket-form');
  const customer = Auth.session('customer');
  if (customer) {
    form.elements.name.value = `${customer.firstName} ${customer.lastName}`;
    form.elements.email.value = customer.email;
  }
  bindForm(form, async (data) => {
    const id = `TK-${String(Date.now()).slice(-6)}`;
    Store.set('tickets', [...Store.get('tickets', []), { id, ...data, createdAt: Date.now() }]);
    body.innerHTML = `
      <div class="empty">
        <h3>Ticket ${esc(id)} received</h3>
        <p class="muted">We'll reply to ${esc(data.email)} as soon as we can.</p>
      </div>`;
  });
}

function openSupport(tab = 'chat') {
  const isChat = tab === 'chat';
  Modal.open({
    title: 'Contact Support',
    html: `
      <div class="tabs" role="group" aria-label="Support options">
        <button class="tabs__tab" type="button" data-support-tab="chat" ${isChat ? 'aria-current="true"' : ''}>Live Chat</button>
        <button class="tabs__tab" type="button" data-support-tab="ticket" ${isChat ? '' : 'aria-current="true"'}>Submit a Ticket</button>
      </div>
      <div id="support-pane">
        ${isChat ? `
          <div class="support-log" role="log" aria-live="polite"></div>
          <form class="composer" id="support-chat-form">
            <label class="sr-only" for="support-message">Message</label>
            <input id="support-message" name="message" autocomplete="off" maxlength="500" placeholder="Type your question">
            <button class="btn btn--primary" type="submit" aria-label="Send">${icon('send')}</button>
          </form>` : `
          <form id="ticket-form">
            ${renderSections(TICKET_SCHEMA, 'ticket')}
            <p class="form-error" role="alert"></p>
            <button class="btn btn--primary btn--block" type="submit">Submit Ticket</button>
          </form>`}
      </div>`,
    render(body) {
      body.querySelectorAll('[data-support-tab]').forEach((btn) => {
        btn.addEventListener('click', () => openSupport(btn.dataset.supportTab));
      });
      if (isChat) bindLiveChat(body);
      else bindTicketForm(body.querySelector('#support-pane'));
    },
  });
}

function openTracking() {
  Modal.open({
    title: 'Order Tracking',
    html: `
      <form id="track-form">
        ${renderSections([{ fields: [{ name: 'order', label: 'Order Number', placeholder: 'OT-100245', hint: 'Sample orders: OT-100245, OT-100311', wide: true }] }], 'track')}
        <button class="btn btn--primary btn--block" type="submit">Track Order</button>
      </form>
      <div id="track-result" role="status"></div>`,
    render(body) {
      const result = body.querySelector('#track-result');
      bindForm(body.querySelector('form'), async ({ order }) => {
        const key = order.trim().toUpperCase();
        const found = SAMPLE_ORDERS[key];
        if (!found) {
          result.innerHTML = `<p class="muted track-empty">We couldn't find order ${esc(key)}. Check the number and try again.</p>`;
          return;
        }
        result.innerHTML = `
          <h3 class="track-title">${esc(found.item)}</h3>
          <ol class="timeline">
            ${found.steps.map(([label, done]) => `<li class="${done ? 'is-done' : ''}">${esc(label)}</li>`).join('')}
          </ol>`;
      });
    },
  });
}

function openPolicy() {
  Modal.open({
    title: 'Return & Refund Policy',
    html: RETURN_POLICY.map(([title, text]) => `<h3 class="policy-title">${esc(title)}</h3><p class="muted">${esc(text)}</p>`).join(''),
  });
}

function openContact() {
  Modal.open({
    title: 'Contact Us',
    html: `
      <p class="muted">Email us at <a class="link" href="mailto:${esc(CONFIG.supportEmail)}">${esc(CONFIG.supportEmail)}</a></p>
      <p class="muted">Support hours: ${esc(CONFIG.supportHours)}</p>
      <button class="btn btn--primary btn--block" type="button" data-action="support-chat">${icon('chat')} Start Live Chat</button>`,
  });
}
