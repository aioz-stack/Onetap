// Saves uploaded files. The type comes from the file's own bytes, because the browser's can be anything.

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LIMITS } from '../products';
import { getDb, UPLOAD_DIR } from './db';
import { ApiError } from './errors';

function signature(bytes) {
  const text = (start, end) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (text(1, 4) === 'PNG') return 'image/png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp';
  if (text(4, 8) === 'ftyp') return 'video/mp4';
  return null;
}

// JPG, PNG or WebP, judged by the bytes, or null.
export function imageType(bytes) {
  const type = signature(bytes);
  return type?.startsWith('image/') ? type : null;
}

export async function saveUpload(file, { imagesOnly = false } = {}) {
  getDb();
  if (!(file instanceof File)) throw new ApiError(400, 'Choose a file to upload.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = signature(bytes);
  const extension = type === 'video/mp4' ? !imagesOnly && 'mp4' : LIMITS.imageTypes[type];
  if (!extension) throw new ApiError(415, imagesOnly ? 'Use a JPG, PNG or WebP image.' : 'Use a JPG, PNG or WebP image, or an MP4 video.');
  const limit = type === 'video/mp4' ? LIMITS.videoBytes : LIMITS.imageBytes;
  if (bytes.length > limit) throw new ApiError(413, `That file is over the ${limit / 1024 / 1024} MB limit.`);
  const name = `${randomUUID()}.${extension}`;
  await writeFile(path.join(UPLOAD_DIR, name), bytes);
  return `/api/uploads/${name}`;
}
