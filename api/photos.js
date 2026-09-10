// /api/photos — photo upload and retrieval.
//
//   POST { image: <base64 JPEG> }  → { ok, key, size }
//     The client compresses with Canvas before upload (max 1024px, q0.7), so
//     anything over ~5 MB base64 is rejected as a bug/abuse.
//   GET  ?key=<photoKey>           → image/jpeg bytes
//     Production keys are full Vercel Blob URLs → we redirect.
//     Local dev keys are filenames → we stream from data/photos/.

import { putPhoto, getPhotoBuffer } from './_lib/blob.js';

const MAX_BASE64_LENGTH = 7_000_000; // ~5 MB of binary

export default async function handler(req, res) {
  // ---- GET: serve a photo ---------------------------------------------------
  if (req.method === 'GET') {
    const key = req.query?.key || new URL(req.url, 'http://x').searchParams.get('key');
    if (!key) return res.status(400).json({ error: 'invalid_input' });

    if (key.startsWith('https://')) {
      // Production: the key is the public blob URL.
      res.setHeader('Location', key);
      return res.status(302).end();
    }

    const buffer = await getPhotoBuffer(key);
    if (!buffer) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).end(buffer);
  }

  // ---- POST: upload -----------------------------------------------------------
  if (req.method === 'POST') {
    const { image } = req.body || {};
    if (typeof image !== 'string' || image.length === 0) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    if (image.length > MAX_BASE64_LENGTH) {
      return res.status(413).json({ error: 'photo_too_large' });
    }
    const buffer = Buffer.from(image, 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'invalid_input' });

    const key = await putPhoto(buffer);
    return res.status(201).json({ ok: true, key, size: buffer.length });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method_not_allowed' });
}
