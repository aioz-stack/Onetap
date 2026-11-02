export class CourierError extends Error {}

// Worth retrying: timeouts, network failures and 5xx responses.
export class TemporaryCourierError extends CourierError {}
