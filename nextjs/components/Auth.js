'use client';

// Customer auth modals and the Seller Centre portal.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Form, Sections } from './Forms';
import Icon from './Icon';
import { CUSTOMER_SCHEMA, FORGOT_SCHEMA, LOGIN_SCHEMA, SELLER_SCHEMA } from '@/lib/schemas';
import { Auth, Store, useStored } from '@/lib/store';
import { Modal, toast } from '@/lib/ui';

function LoginForm({ prefix, onSubmit, onForgot }) {
  return (
    <Form id={`${prefix}-form`} onSubmit={onSubmit}>
      <Sections schema={LOGIN_SCHEMA} prefix={prefix} />
      <p className="form-link"><button className="link" type="button" onClick={onForgot}>Forgot Password?</button></p>
      <p className="form-error" role="alert" />
      <button className="btn btn--primary btn--block" type="submit">Log In</button>
    </Form>
  );
}

export function openForgotPassword(role) {
  Modal.open({
    title: 'Reset your password',
    content: (
      <Form
        id="forgot-form"
        onSubmit={async () => {
          // Needs a mail backend. The reply is the same either way so accounts can't be probed.
          Modal.open({
            title: 'Check your email',
            content: <p className="muted">If an account matches that email, a reset link is on its way.</p>,
          });
        }}
      >
        <p className="muted">Enter your account email and we&apos;ll send you a reset link.</p>
        <Sections schema={FORGOT_SCHEMA} prefix="forgot" />
        <button className="btn btn--primary btn--block" type="submit">Send Reset Link</button>
        <p className="form-switch">
          <button className="link" type="button" onClick={() => (role === 'customer' ? openCustomerLogin() : Modal.close())}>Back to Log In</button>
        </p>
      </Form>
    ),
  });
}

export function openCustomerLogin() {
  Modal.open({
    title: 'Log in to Onetap',
    content: (
      <>
        <LoginForm
          prefix="login"
          onForgot={() => openForgotPassword('customer')}
          onSubmit={async ({ identifier, password }) => {
            const user = await Auth.login('customer', identifier, password);
            Modal.close();
            if (user.approvalStatus === 'approved') toast(`Welcome back, ${user.firstName}!`, 'success');
            else toast(user.approvalStatus === 'rejected' ? 'Your registration was not approved. See the reason at the top of the page.' : 'Welcome back! Your account is still waiting for approval.');
          }}
        />
        <p className="form-switch">Don&apos;t have an account? <button className="link" type="button" onClick={openCustomerSignup}>Sign Up</button></p>
      </>
    ),
  });
}

export function openCustomerSignup() {
  Modal.open({
    title: 'Create your Onetap account',
    variant: 'wide',
    content: (
      <>
        <Form
          id="signup-form"
          onSubmit={async (data) => {
            const user = await Auth.register('customer', data);
            Modal.open({
              title: 'Registration received',
              content: (
                <div className="assistant-form">
                  <p>Thanks, {user.firstName}. Your account is <strong>waiting for approval</strong>.</p>
                  <p className="muted">An administrator checks your details and valid ID first. You can browse and fill your cart meanwhile, and you&apos;ll get a notification as soon as you can check out.</p>
                  <button className="btn btn--primary btn--block" type="button" onClick={() => Modal.close()}>Start Browsing</button>
                </div>
              ),
            });
          }}
        >
          <p className="muted">New accounts are checked by our team before they can buy. Have a valid government ID ready.</p>
          <Sections schema={CUSTOMER_SCHEMA} prefix="signup" />
          <p className="form-error" role="alert" />
          <button className="btn btn--primary btn--block" type="submit">Sign Up</button>
        </Form>
        <p className="form-switch">Already have an account? <button className="link" type="button" onClick={openCustomerLogin}>Log In</button></p>
      </>
    ),
  });
}

function SellerLogin() {
  return (
    <>
      <h2>Log in to your shop</h2>
      <LoginForm
        prefix="seller-login"
        onForgot={() => openForgotPassword('seller')}
        onSubmit={({ identifier, password }) => Auth.login('seller', identifier, password)}
      />
      <p className="form-switch">New to Onetap? <Link className="link" href="/seller/register">Register as a seller</Link></p>
    </>
  );
}

function SellerRegister() {
  return (
    <>
      <h2>Register your shop</h2>
      <Form
        id="seller-register-form"
        onSubmit={async (data) => {
          await Auth.register('seller', data);
          toast('Application submitted. We will review it soon.', 'success');
        }}
      >
        <Sections schema={SELLER_SCHEMA} prefix="seller" />
        <p className="form-error" role="alert" />
        <button className="btn btn--primary btn--block" type="submit">Submit Application</button>
      </Form>
      <p className="form-switch">Already selling on Onetap? <Link className="link" href="/seller/login">Log in</Link></p>
    </>
  );
}

// The server only renders this without a valid session, so any local copy on arrival is stale.
// Signing in or registering lands here too: the session appears and this redirects.
export function SellerPortal({ mode }) {
  const router = useRouter();
  const seller = useStored('session.seller');
  const [cleared, setCleared] = useState(false);
  const isLogin = mode === 'login';

  useEffect(() => {
    Store.remove('session.seller');
    setCleared(true);
  }, []);

  useEffect(() => {
    if (cleared && seller) router.replace('/seller/dashboard');
  }, [cleared, seller, router]);

  if (cleared && seller) return null;

  return (
    <section className="container portal">
      <aside className="portal__intro">
        <span className="pill"><Icon name="store" /> Seller Centre</span>
        <h1 tabIndex={-1}>Grow your shop with Onetap</h1>
        <p>Reach shoppers nationwide and manage your store from one place.</p>
        <ul className="portal__points">
          <li><Icon name="truck" /> Nationwide delivery partners</li>
          <li><Icon name="chat" /> Built-in customer chat</li>
          <li><Icon name="shield" /> Protected seller payouts</li>
        </ul>
      </aside>
      <div className="portal__panel">
        <nav className="tabs" aria-label="Seller Centre access">
          <Link className="tabs__tab" href="/seller/login" aria-current={isLogin ? 'page' : undefined}>Log In</Link>
          <Link className="tabs__tab" href="/seller/register" aria-current={isLogin ? undefined : 'page'}>Register as Seller</Link>
        </nav>
        {isLogin ? <SellerLogin /> : <SellerRegister />}
      </div>
    </section>
  );
}
