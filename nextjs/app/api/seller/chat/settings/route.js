import { sellerFrom } from '@/lib/server/auth';
import { getChatSettings, saveChatSettings } from '@/lib/server/chat';
import { route } from '@/lib/server/route';

export const GET = route(async (request) => Response.json({ settings: getChatSettings(sellerFrom(request)) }));

export const PUT = route(async (request) => {
  const seller = sellerFrom(request);
  return Response.json({ settings: saveChatSettings(seller, await request.json()) });
});
