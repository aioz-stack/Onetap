import { courierReport, courierRoute, courierShipment } from '@/lib/server/courierPanel';
import { ApiError } from '@/lib/server/errors';
import { assignmentOptions, assignRider, removeRider } from '@/lib/server/riders';
import { syncShipment } from '@/lib/server/shipments';

export const GET = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  const shipment = courierShipment(id, account.partnerId);
  return Response.json({ shipment: { ...shipment, assign: assignmentOptions(shipment, account.partnerId) } });
});

export const POST = courierRoute(async (request, account, { params }) => {
  const { id } = await params;
  const { action, ...input } = await request.json();
  courierShipment(id, account.partnerId);
  if (action === 'report') return Response.json(courierReport(account, id, input));
  if (action === 'sync') return Response.json(await syncShipment({ username: account.username, adminRole: `courier:${account.partnerId}` }, id));
  if (action === 'assignRider') return Response.json(assignRider(account, id, input) ?? { ok: true });
  if (action === 'removeRider') return Response.json(removeRider(account, id, input) ?? { ok: true });
  throw new ApiError(400, 'Unknown action.');
});
