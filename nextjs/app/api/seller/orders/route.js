import { sellerFrom } from '@/lib/server/auth';
import { listOrders } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ orders: listOrders(sellerFrom(request)) }));
