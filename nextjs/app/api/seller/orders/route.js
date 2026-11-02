import { sellerFrom } from '@/lib/server/auth';
import { forSellerOrder, listOrders } from '@/lib/server/orders';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ orders: listOrders(sellerFrom(request)).map(forSellerOrder) }));
