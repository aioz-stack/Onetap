import { saveProofPhoto } from '@/lib/server/proofs';
import { riderRoute } from '@/lib/server/riders';

// Delivery photos only, which are private.
export const POST = riderRoute(async (request, account) => {
  const form = await request.formData();
  return Response.json({ url: await saveProofPhoto(form.get('file'), { partnerId: account.partnerId, riderId: account.riderId, uploadedBy: account.username }) }, { status: 201 });
});
