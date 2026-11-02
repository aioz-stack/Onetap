import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { UPLOAD_DIR } from '@/lib/server/db';
import { ApiError } from '@/lib/server/errors';
import { route } from '@/lib/server/route';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' };

export const GET = route(async (request, { params }) => {
  const { name } = await params;
  const match = /^[a-f0-9-]+\.(jpg|png|webp|mp4)$/.exec(name);
  if (!match) throw new ApiError(404, 'File not found.');

  const file = path.join(UPLOAD_DIR, name);
  const info = await stat(file).catch(() => null);
  if (!info) throw new ApiError(404, 'File not found.');

  const headers = {
    'Content-Type': TYPES[match[1]],
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  };

  // Browsers ask for video in ranges so it can seek.
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)), { headers: { ...headers, 'Content-Length': String(info.size) } });
});
