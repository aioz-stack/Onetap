// Starts the background retry for courier bookings that failed on a temporary error.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startBookingRetries } = await import('./lib/server/bookingRetries');
    startBookingRetries();
  }
}
