// Sending text messages. No SMS provider is connected yet, so every message goes through the
// Sandbox: nothing is sent, and the caller shows the code on screen, labelled as a sample.
// To go live, write an adapter for the chosen provider (for example Semaphore or Twilio) from
// its API documentation, return it from `smsAdapter` when its credentials are set, and keep
// the Sandbox for local development.

const sandbox = {
  sandbox: true,
  async send() {
    return { sandbox: true };
  },
};

export function smsAdapter() {
  return sandbox;
}

// Never log the message itself: it carries a one-time code.
export async function sendSms(phone, message) {
  return smsAdapter().send(phone, message);
}
