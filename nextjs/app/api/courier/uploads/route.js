import { courierRoute } from '@/lib/server/courierPanel';
import { saveProofPhoto } from '@/lib/server/proofs';

// Delivery photos only, which are private.
export const POST = courierRoute(async (request, account) => {
  const form = await request.formData();
  return Response.json({ url: await saveProofPhoto(form.get('file'), { partnerId: account.partnerId, uploadedBy: account.username }) }, { status: 201 });
});
