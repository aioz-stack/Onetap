import { sellerFrom } from '@/lib/server/auth';
import { chatPerformance } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json(chatPerformance(sellerFrom(request))));
