import { adminRoute } from '@/lib/server/admin';
import { accountFeeDetail, setAccountFee } from '@/lib/server/fees';

// One seller's admin fee or one logistics partner's logistics fee (kind is seller or partner).
export const GET = adminRoute('fees', async (request, admin, { params }) => {
  const { kind, account } = await params;
  return Response.json(accountFeeDetail(kind, decodeURIComponent(account)));
});

export const POST = adminRoute('fees', async (request, admin, { params }) => {
  const { kind, account } = await params;
  return Response.json(setAccountFee(admin, kind, decodeURIComponent(account), await request.json()));
});
