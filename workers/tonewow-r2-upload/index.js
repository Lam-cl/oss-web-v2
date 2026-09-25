const PATH = /^\/v1\/catalogue\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([a-f0-9]{64})\/(card|gallery)\.webp$/;
const HASH = /^[a-f0-9]{64}$/;
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const digest = value => crypto.subtle.digest('SHA-256', value);

async function authorized(request, secret) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!secret || supplied.length > 256) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([digest(encoder.encode(supplied)), digest(encoder.encode(secret))]);
  return crypto.subtle.timingSafeEqual(left, right);
}

export default {
  async fetch(request, env) {
    const match = PATH.exec(new URL(request.url).pathname);
    if (!match) return new Response(null, { status: 404 });
    if (request.method !== 'PUT' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'PUT, HEAD' } });
    if (!await authorized(request, env.UPLOAD_TOKEN)) return new Response(null, { status: 401 });
    const key = `catalogue/v1/${match[1]}/${match[2]}/${match[3]}.webp`;
    if (request.method === 'HEAD') {
      const object = await env.CATALOGUE_ASSETS.head(key);
      return object ? new Response(null, { status: 200, headers: {
        'content-length': String(object.size), 'content-type': object.httpMetadata?.contentType || '',
        'cache-control': 'no-store',
      } }) : new Response(null, { status: 404 });
    }
    const declared = Number(request.headers.get('content-length'));
    if (!Number.isSafeInteger(declared) || declared < 12 || declared >= 1_000_000
      || request.headers.get('content-type') !== 'image/webp') return new Response(null, { status: 413 });
    const claimedSha = request.headers.get('x-content-sha256') || '';
    if (!HASH.test(claimedSha)) return new Response(null, { status: 400 });
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length !== declared || body.length >= 1_000_000
      || String.fromCharCode(...body.subarray(0, 4)) !== 'RIFF'
      || String.fromCharCode(...body.subarray(8, 12)) !== 'WEBP') return new Response(null, { status: 422 });
    const actualSha = hex(await digest(body));
    if (actualSha !== claimedSha) return new Response(null, { status: 422 });
    const existing = await env.CATALOGUE_ASSETS.get(key);
    if (existing) {
      const current = new Uint8Array(await existing.arrayBuffer());
      if (hex(await digest(current)) !== actualSha) return new Response(null, { status: 409 });
      return Response.json({ key, bytes: body.length, sha256: actualSha, existing: true }, { headers: { 'cache-control': 'no-store' } });
    }
    await env.CATALOGUE_ASSETS.put(key, body, {
      httpMetadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
      customMetadata: { sha256: actualSha },
    });
    return Response.json({ key, bytes: body.length, sha256: actualSha, existing: false },
      { status: 201, headers: { 'cache-control': 'no-store' } });
  },
};
