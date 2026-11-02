'use client';

// Help Centre: FAQ search, support modal (live chat and tickets), order tracking, policy.

import { useEffect, useRef, useState } from 'react';
import { Form, Sections } from './Forms';
import Icon from './Icon';
import { openCustomerLogin } from './Auth';
import { CONFIG, FAQS, RETURN_POLICY } from '@/lib/data';
import { formatDate } from '@/lib/orders';
import { Purchases } from '@/lib/purchases';
import { TICKET_SCHEMA, TRACK_SCHEMA } from '@/lib/schemas';
import { Auth, Store } from '@/lib/store';
import { Modal, toast } from '@/lib/ui';

function searchFaqs(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return FAQS.filter((f) => {
    const haystack = `${f.topic} ${f.q} ${f.a}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

function FaqList({ items, openFirst }) {
  if (!items.length) {
    return (
      <div className="empty">
        <p>No answers match that search.</p>
        <button className="btn btn--primary" type="button" onClick={() => openSupport('ticket')}>Submit a Ticket</button>
      </div>
    );
  }
  return items.map((f, i) => (
    <details className="faq" key={f.q} open={openFirst && i === 0 ? true : undefined}>
      <summary><span className="faq__topic">{f.topic}</span>{f.q}<Icon name="chevron" className="icon faq__chevron" /></summary>
      <p>{f.a}</p>
    </details>
  ));
}

export function HelpCentre() {
  const [query, setQuery] = useState('');
  const matches = searchFaqs(query);

  return (
    <>
      <section className="help-hero">
        <div className="container">
          <h1 tabIndex={-1}>How can we help?</h1>
          <div className="help-search">
            <Icon name="search" />
            <label className="sr-only" htmlFor="faq-search">Search the Help Centre</label>
            <input id="faq-search" type="search" placeholder="Search for answers" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </section>
      <section className="container help-body">
        <div className="quick-links" aria-label="Quick links">
          <button className="quick-link" type="button" onClick={openTracking}><Icon name="truck" /><span><strong>Order Tracking</strong><small>See where your parcel is</small></span></button>
          <button className="quick-link" type="button" onClick={openPolicy}><Icon name="refund" /><span><strong>Return/Refund Policy</strong><small>7-day free returns</small></span></button>
          <button className="quick-link" type="button" onClick={openContact}><Icon name="mail" /><span><strong>Contact Us</strong><small>Email and support hours</small></span></button>
        </div>
        <div className="help-columns">
          <div>
            <h2>Frequently asked questions</h2>
            <p className="sr-only" role="status">{query && `${matches.length} ${matches.length === 1 ? 'answer' : 'answers'} found`}</p>
            <div><FaqList items={matches} openFirst={Boolean(query.trim())} /></div>
          </div>
          <aside className="card help-cta">
            <h2>Still need help?</h2>
            <p className="muted">Chat with our support team or send us a ticket.</p>
            <button className="btn btn--primary btn--block" type="button" onClick={() => openSupport('chat')}><Icon name="chat" /> Live Chat</button>
            <button className="btn btn--ghost btn--block" type="button" onClick={() => openSupport('ticket')}>Submit a Ticket</button>
          </aside>
        </div>
      </section>
    </>
  );
}

function supportReply(text) {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = FAQS
    .map((f) => ({ f, score: words.filter((w) => `${f.q} ${f.a}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].f.a;
  return "I couldn't find an answer to that. Please submit a ticket and our team will follow up by email.";
}

function LiveChat() {
  const [messages, setMessages] = useState([{ from: 'them', text: 'Hi! This is Onetap Support. What can we help you with today?' }]);
  const log = useRef(null);

  useEffect(() => {
    log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);

  function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const text = form.elements.message.value.trim();
    if (!text) return;
    form.reset();
    setMessages((list) => [...list, { from: 'me', text }]);
    setTimeout(() => setMessages((list) => [...list, { from: 'them', text: supportReply(text) }]), 600);
  }

  return (
    <>
      <div className="support-log" role="log" aria-live="polite" ref={log}>
        {messages.map((m, i) => <div className={`bubble bubble--${m.from}`} key={i}>{m.text}</div>)}
      </div>
      <form className="composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="support-message">Message</label>
        <input id="support-message" name="message" autoComplete="off" maxLength={500} placeholder="Type your question" autoFocus />
        <button className="btn btn--primary" type="submit" aria-label="Send"><Icon name="send" /></button>
      </form>
    </>
  );
}

function TicketForm() {
  const [sent, setSent] = useState(null);

  if (sent) {
    return (
      <div className="empty">
        <h3>Ticket {sent.id} received</h3>
        <p className="muted">We&apos;ll reply to {sent.email} as soon as we can.</p>
      </div>
    );
  }

  const customer = Auth.session('customer');
  const prefill = customer ? { name: `${customer.firstName} ${customer.lastName}`, email: customer.email } : {};
  const schema = TICKET_SCHEMA.map((section) => ({
    ...section,
    fields: section.fields.map((f) => ({ ...f, value: prefill[f.name] })),
  }));

  return (
    <Form
      id="ticket-form"
      onSubmit={async (data) => {
        const id = `TK-${String(Date.now()).slice(-6)}`;
        Store.set('tickets', [...Store.get('tickets', []), { id, ...data, createdAt: Date.now() }]);
        setSent({ id, email: data.email });
      }}
    >
      <Sections schema={schema} prefix="ticket" />
      <p className="form-error" role="alert" />
      <button className="btn btn--primary btn--block" type="submit">Submit Ticket</button>
    </Form>
  );
}

function SupportPanel({ initialTab }) {
  const [tab, setTab] = useState(initialTab);
  return (
    <>
      <div className="tabs" role="group" aria-label="Support options">
        <button className="tabs__tab" type="button" aria-current={tab === 'chat' ? 'true' : undefined} onClick={() => setTab('chat')}>Live Chat</button>
        <button className="tabs__tab" type="button" aria-current={tab === 'ticket' ? 'true' : undefined} onClick={() => setTab('ticket')}>Submit a Ticket</button>
      </div>
      <div>{tab === 'chat' ? <LiveChat /> : <TicketForm />}</div>
    </>
  );
}

function openSupport(tab = 'chat') {
  Modal.open({ title: 'Contact Support', content: <SupportPanel initialTab={tab} /> });
}

function TrackForm() {
  const [result, setResult] = useState(null);

  return (
    <>
      <Form
        id="track-form"
        onSubmit={async ({ order }) => {
          const id = order.trim().toUpperCase();
          const orders = await Purchases.list();
          setResult({ id, found: orders.find((o) => o.id === id) });
        }}
      >
        <Sections schema={TRACK_SCHEMA} prefix="track" />
        <button className="btn btn--primary btn--block" type="submit">Track Order</button>
      </Form>
      <div role="status">
        {result && !result.found && <p className="muted track-empty">We couldn&apos;t find order {result.id} in your account. Check the number and try again.</p>}
        {result?.found && (
          <>
            <h3 className="track-title">{result.found.items.map((item) => item.name).join(', ')}</h3>
            <ol className="timeline order-timeline">
              {[...result.found.events].reverse().map((event) => (
                <li className="is-done" key={`${event.label}-${event.at}`}>{event.label}<small>{formatDate(event.at)}</small></li>
              ))}
            </ol>
          </>
        )}
      </div>
    </>
  );
}

function openTracking() {
  if (Auth.session('customer')) Modal.open({ title: 'Order Tracking', content: <TrackForm /> });
  else {
    toast('Log in to track your orders.');
    openCustomerLogin();
  }
}

export function openPolicy() {
  Modal.open({
    title: 'Return & Refund Policy',
    content: RETURN_POLICY.map(([title, text]) => (
      <div key={title}>
        <h3 className="policy-title">{title}</h3>
        <p className="muted">{text}</p>
      </div>
    )),
  });
}

function openContact() {
  Modal.open({
    title: 'Contact Us',
    content: (
      <>
        <p className="muted">Email us at <a className="link" href={`mailto:${CONFIG.supportEmail}`}>{CONFIG.supportEmail}</a></p>
        <p className="muted">Support hours: {CONFIG.supportHours}</p>
        <button className="btn btn--primary btn--block" type="button" onClick={() => openSupport('chat')}><Icon name="chat" /> Start Live Chat</button>
      </>
    ),
  });
}
