import { adminRoute } from '@/lib/server/admin';
import { ApiError } from '@/lib/server/errors';
import { addShipmentNote, resolveInvestigation, shipmentDetail, simulateCourierEvent, syncShipment } from '@/lib/server/shipments';

export const GET = adminRoute('shipments', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ shipment: shipmentDetail(id) });
});

export const POST = adminRoute('shipments', async (request, admin, { params }) => {
  const { id } = await params;
  const { action, ...data } = await request.json();
  if (action === 'note') addShipmentNote(admin, id, data.note);
  else if (action === 'resolve') resolveInvestigation(admin, id);
  else if (action === 'sync') return Response.json(await syncShipment(admin, id));
  else if (action === 'simulate') return Response.json(simulateCourierEvent(admin, id, data));
  else throw new ApiError(400, 'Unknown action.');
  return new Response(null, { status: 204 });
});
