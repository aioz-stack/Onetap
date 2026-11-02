// Checks for bookings due another try. Importing pickups.js loads the database code, so this
// stays out of the instrumentation file, which is also compiled for the edge runtime.

import { retryDueBookings } from './pickups';

const CHECK_MS = 15 * 1000;

export function startBookingRetries() {
  setInterval(() => retryDueBookings().catch((err) => console.error('Booking retry failed', err)), CHECK_MS).unref();
}
