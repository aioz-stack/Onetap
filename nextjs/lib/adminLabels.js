// Status labels for the Admin Console.

export const SHIPMENT_STATUS = {
  pending: { label: 'Pending', tone: 'warn' },
  booking_confirmed: { label: 'Booking Confirmed', tone: 'info' },
  ready_for_pickup: { label: 'Ready for Pickup', tone: 'info' },
  picked_up: { label: 'Picked Up', tone: 'info' },
  in_transit: { label: 'In Transit', tone: 'info' },
  at_sorting_facility: { label: 'Arrived at Sorting Facility', tone: 'info' },
  sorting_completed: { label: 'Sorting Completed', tone: 'info' },
  departed_sorting_facility: { label: 'Departed Sorting Facility', tone: 'info' },
  arrived_delivery_hub: { label: 'Arrived at Delivery Hub', tone: 'info' },
  ready_for_delivery: { label: 'Ready for Delivery', tone: 'info' },
  out_for_delivery: { label: 'Out for Delivery', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'ok' },
  failed_delivery: { label: 'Failed Delivery', tone: 'danger' },
  return_to_sender: { label: 'Return to Sender', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  pickup_confirmed: { label: 'Pickup Approved', tone: 'info' },
  pickup_failed: { label: 'Pickup Failed', tone: 'danger' },
  pickup_rejected: { label: 'Pickup Rejected by Courier', tone: 'danger' },
};

export const PICKUP_STATUS = {
  awaiting_payment: { label: 'Awaiting Payment', tone: 'warn' },
  pending: { label: 'Pending Approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  confirmed: { label: 'Courier Approved', tone: 'info' },
  picked_up: { label: 'Picked Up', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

// The same pickups as a courier sees them: new work first, then what it has accepted.
export const COURIER_PICKUP_STATUS = {
  scheduled: { label: 'Pending', tone: 'warn' },
  confirmed: { label: 'Scheduled', tone: 'info' },
  picked_up: { label: 'Picked Up', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const COD_STATUS = {
  awaiting_delivery: { label: 'Awaiting Delivery', tone: 'neutral' },
  collected: { label: 'Pending Remittance', tone: 'warn' },
  remitted: { label: 'Remitted', tone: 'ok' },
  void: { label: 'Void', tone: 'neutral' },
};

export const LISTING_STATUS = {
  live: { label: 'Live', tone: 'ok' },
  violation: { label: 'Disapproved', tone: 'neutral' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export const CUSTOMER_APPROVAL_STATUS = {
  pending: { label: 'Pending Approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const APPLICATION_STATUS = {
  pending: { label: 'Pending Approval', tone: 'warn' },
  needs_info: { label: 'Information Requested', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  disapproved: { label: 'Disapproved', tone: 'danger' },
  suspended: { label: 'Suspended', tone: 'danger' },
};

export const API_STATUS = {
  connected: { label: 'Connected', tone: 'ok' },
  not_tested: { label: 'Not Tested', tone: 'warn' },
  failed: { label: 'Failed', tone: 'danger' },
  not_configured: { label: 'Not Configured', tone: 'neutral' },
};

// A rider's availability, worked out from their open task. Completed riders are free for another.
export const RIDER_STATUS = {
  available: { label: 'Available', tone: 'ok' },
  assigned: { label: 'Assigned', tone: 'warn' },
  picking_up: { label: 'Picking Up', tone: 'info' },
  in_transit: { label: 'In Transit', tone: 'info' },
  delivering: { label: 'Delivering', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  inactive: { label: 'Inactive', tone: 'neutral' },
};

export const TASK_STATUS = {
  assigned: { label: 'Waiting for Rider', tone: 'warn' },
  accepted: { label: 'In Progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  declined: { label: 'Declined by Rider', tone: 'danger' },
  reassigned: { label: 'Reassigned', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const TASK_KIND = { pickup: 'Pickup', delivery: 'Delivery' };

// Where a delivered order's money is. Prepaid is checked against its payment record, and COD
// follows the cash from the rider to the courier to Onetap.
export const COLLECTION_STATUS = {
  paid_online: { label: 'Paid Online', tone: 'ok' },
  payment_unverified: { label: 'No Payment Record', tone: 'danger' },
  with_rider: { label: 'With Rider', tone: 'warn' },
  handed_over: { label: 'Handed to Courier', tone: 'info' },
  with_courier: { label: 'Held by Courier', tone: 'info' },
  remitted: { label: 'Remitted to Onetap', tone: 'ok' },
};

// A rider handing their COD cash to their courier.
export const RIDER_REMITTANCE_STATUS = {
  submitted: { label: 'Awaiting Confirmation', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

// Where one COD parcel's cash is between the rider and their courier.
export const HANDOVER_STATUS = {
  held: { label: 'With Rider', tone: 'warn' },
  submitted: { label: 'Handed Over', tone: 'info' },
  confirmed: { label: 'Received by Courier', tone: 'ok' },
};

export const options = (statuses) => Object.entries(statuses).map(([value, { label }]) => [value, label]);
