import { sellerFrom } from '@/lib/server/auth';
import { route } from '@/lib/server/route';
import { saveUpload } from '@/lib/server/uploads';

export const POST = route(async (request) => {
  sellerFrom(request);
  const form = await request.formData();
  return Response.json({ url: await saveUpload(form.get('file')) }, { status: 201 });
});
