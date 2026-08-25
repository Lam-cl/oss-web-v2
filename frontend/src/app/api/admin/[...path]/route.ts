import { NextRequest, NextResponse } from 'next/server';
import { BUNDLE_API, getAdminSession, readUpstream, requestIsSameOrigin, safeError, sanitizePayload } from '@/lib/admin/server';
import { completeProductSetup, ProductSetupError, repairProductVariants, resumeProductSetup } from '@/lib/admin/productSetup.server';

export const dynamic = 'force-dynamic';

const rules: Array<{ pattern: RegExp; methods: string[] }> = [
  { pattern: /^products$/, methods: ['GET'] },
  { pattern: /^products\/complete-setup$/, methods: ['POST'] },
  { pattern: /^products\/\d+\/complete-setup$/, methods: ['PUT'] },
  { pattern: /^products\/\d+\/repair-variants$/, methods: ['POST'] },
  { pattern: /^products\/upload$/, methods: ['POST'] },
  { pattern: /^products\/\d+$/, methods: ['GET', 'PUT'] },
  { pattern: /^products\/\d+\/soft-delete$/, methods: ['DELETE'] },
  { pattern: /^products\/\d+\/images\/order$/, methods: ['PATCH'] },
  { pattern: /^products\/\d+\/images\/\d+$/, methods: ['DELETE'] },
  { pattern: /^products\/\d+\/variants$/, methods: ['POST'] },
  { pattern: /^products\/\d+\/variants\/\d+$/, methods: ['PUT', 'DELETE'] },
  { pattern: /^products\/\d+\/options$/, methods: ['POST'] },
  { pattern: /^products\/\d+\/options\/\d+$/, methods: ['PUT', 'DELETE'] },
  { pattern: /^products\/\d+\/options\/\d+\/values\/\d+$/, methods: ['DELETE'] },
  { pattern: /^products\/\d+\/option-pricing$/, methods: ['POST'] },
  { pattern: /^products\/\d+\/option-pricing\/\d+$/, methods: ['DELETE'] },
  { pattern: /^products\/\d+\/option-values\/\d+\/image$/, methods: ['POST', 'DELETE'] },
  { pattern: /^products\/\d+\/batch-update$/, methods: ['POST'] },
  { pattern: /^orders$/, methods: ['GET'] },
  { pattern: /^orders\/\d+$/, methods: ['GET', 'PATCH'] },
  { pattern: /^orders\/\d+\/status$/, methods: ['PUT'] },
];

async function deleteProductOption(path: string, headers: Headers) {
  const match = /^products\/(\d+)\/options\/(\d+)$/.exec(path);
  if (!match) return safeError(404);
  const [, productId, optionId] = match;

  const productResponse = await fetch(`${BUNDLE_API}/products/${productId}`, {
    headers,
    cache: 'no-store',
  });
  const productPayload = await readUpstream(productResponse);
  if (!productResponse.ok) return safeError(productResponse.status, productPayload);

  const product = productPayload && typeof productPayload === 'object' && 'data' in productPayload
    ? (productPayload as { data?: unknown }).data
    : productPayload;
  const options = product && typeof product === 'object' && Array.isArray((product as { options?: unknown }).options)
    ? (product as { options: Array<{ id?: number; values?: Array<{ id?: number }> }> }).options
    : [];
  const option = options.find((item) => Number(item.id) === Number(optionId));
  if (!option) return safeError(404);

  // Bundle API cannot reliably remove an option while child values still
  // reference it. Remove those values through its supported endpoint first.
  for (const value of option.values || []) {
    if (!value.id) continue;
    const valueResponse = await fetch(
      `${BUNDLE_API}/products/${productId}/options/${optionId}/values/${value.id}`,
      { method: 'DELETE', headers, cache: 'no-store' },
    );
    const valuePayload = await readUpstream(valueResponse);
    if (!valueResponse.ok) return safeError(valueResponse.status, valuePayload);
  }

  const optionResponse = await fetch(`${BUNDLE_API}/${path}`, {
    method: 'DELETE',
    headers,
    cache: 'no-store',
  });
  const optionPayload = await readUpstream(optionResponse);
  if (!optionResponse.ok) {
    // Some Bundle API versions remove the now-empty option together with its
    // final value. Treat that as success only after verifying current state.
    const verificationResponse = await fetch(`${BUNDLE_API}/products/${productId}`, {
      headers,
      cache: 'no-store',
    });
    const verificationPayload = await readUpstream(verificationResponse);
    if (verificationResponse.ok) {
      const verifiedProduct = verificationPayload && typeof verificationPayload === 'object' && 'data' in verificationPayload
        ? (verificationPayload as { data?: unknown }).data
        : verificationPayload;
      const remainingOptions = verifiedProduct && typeof verifiedProduct === 'object'
        && Array.isArray((verifiedProduct as { options?: unknown }).options)
        ? (verifiedProduct as { options: Array<{ id?: number }> }).options
        : [];
      if (!remainingOptions.some((item) => Number(item.id) === Number(optionId))) {
        return NextResponse.json(
          { success: true },
          { status: 200, headers: { 'cache-control': 'no-store' } },
        );
      }
    }
    return safeError(optionResponse.status, optionPayload);
  }

  return NextResponse.json(
    sanitizePayload(optionPayload ?? { success: true }),
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

async function proxy(request: NextRequest, context: { params: { path: string[] } }) {
  const path = context.params.path.join('/');
  const rule = rules.find((candidate) => candidate.pattern.test(path));
  if (!rule || !rule.methods.includes(request.method)) return safeError(404);
  const session = await getAdminSession(request);
  if (!session) return safeError(401);
  if (request.method !== 'GET' && !requestIsSameOrigin(request)) return safeError(403);

  const headers = new Headers({ authorization: `Bearer ${session.token}`, accept: 'application/json' });
  if (request.method === 'POST' && path === 'products/complete-setup') {
    try {
      const result = await completeProductSetup(await request.formData(), session.token);
      return NextResponse.json(result, { status: 201, headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      if (reason instanceof ProductSetupError) {
        return NextResponse.json(
          { message: reason.message, productId: reason.productId, setupState: reason.productId ? 'draft' : undefined },
          { status: reason.status, headers: { 'cache-control': 'no-store' } },
        );
      }
      return safeError(502);
    }
  }
  const resumeMatch = request.method === 'PUT' ? /^products\/(\d+)\/complete-setup$/.exec(path) : null;
  if (resumeMatch) {
    try {
      const result = await resumeProductSetup(Number(resumeMatch[1]), await request.formData(), session.token);
      return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      if (reason instanceof ProductSetupError) {
        return NextResponse.json(
          { message: reason.message, productId: reason.productId, setupState: 'draft' },
          { status: reason.status, headers: { 'cache-control': 'no-store' } },
        );
      }
      return safeError(502);
    }
  }
  const repairMatch = request.method === 'POST' ? /^products\/(\d+)\/repair-variants$/.exec(path) : null;
  if (repairMatch) {
    try {
      const result = await repairProductVariants(Number(repairMatch[1]), session.token);
      return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      if (reason instanceof ProductSetupError) {
        return NextResponse.json(
          { message: reason.message, productId: reason.productId },
          { status: reason.status, headers: { 'cache-control': 'no-store' } },
        );
      }
      return safeError(502);
    }
  }
  if (request.method === 'DELETE' && /^products\/\d+\/options\/\d+$/.test(path)) {
    try {
      return await deleteProductOption(path, headers);
    } catch {
      return safeError(502);
    }
  }

  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const init: RequestInit = { method: request.method, headers, cache: 'no-store' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.arrayBuffer();

  let upstream: Response;
  try { upstream = await fetch(`${BUNDLE_API}/${path}${request.nextUrl.search}`, init); } catch { return safeError(502); }
  const payload = await readUpstream(upstream);
  if (!upstream.ok) return safeError(upstream.status, payload);
  return NextResponse.json(sanitizePayload(payload ?? {}), { status: upstream.status, headers: { 'cache-control': 'no-store' } });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
