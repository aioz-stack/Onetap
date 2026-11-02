import { adminRoute } from '@/lib/server/admin';
import { decidePayout } from '@/lib/server/sellerIncome';

export const POST = adminRoute('cod', async (request, admin, { params }) => {
  const { id } = await params;
  return Response.json({ payout: decidePayout(admin, id, await request.json()) });
});
