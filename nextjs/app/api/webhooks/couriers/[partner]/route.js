import { route } from '@/lib/server/route';
import { handleWebhook } from '@/lib/server/shipments';

// The raw body is what was signed, so it must be read before any parsing.
export const POST = route(async (request, { params }) => {
  const { partner } = await params;
  const body = await request.text();
  const result = handleWebhook(partner, body, request.headers.get('x-onetap-signature'), request.headers.get('x-onetap-timestamp'));
  return Response.json(result);
});
