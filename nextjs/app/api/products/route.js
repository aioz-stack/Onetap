import { route } from '@/lib/server/route';
import { listLiveProducts } from '@/lib/server/products';

export const dynamic = 'force-dynamic';

export const GET = route(async () => Response.json({ products: listLiveProducts() }));
