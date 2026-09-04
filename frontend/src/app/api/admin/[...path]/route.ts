import { NextRequest, NextResponse } from 'next/server';
import { BUNDLE_API, getAdminSession, readUpstream, requestIsSameOrigin, safeError, sanitizePayload } from '@/lib/admin/server';
import { readShippingSettings, saveShippingSettings } from '@/lib/shippingSettings.server';
import { completeProductSetup, ProductSetupError, repairProductVariants, resumeProductSetup } from '@/lib/admin/productSetup.server';
import { getSimPrefixOptions, SimPrefixError } from '@/lib/admin/simPrefixes.server';
import { decryptSimAssignmentToken, SimRangeError, validateSimRange } from '@/lib/admin/simRange.server';
import { OrderMetadataError, readOrderMetadata, saveCourierMetadata } from '@/lib/admin/orderMetadata.server';
import { readProductHiddenOptionValues, readProductImageColors, saveProductHiddenOptionValues, saveProductImageColors } from '@/lib/productImageColors.server';
import { defaultReadyCollectionEmailStore, orchestrateReadyCollectionEmail, ReadyCollectionEmailError } from '@/lib/admin/readyCollectionEmail.server';
import { deriveSimUnits } from '@/lib/admin/simAssignments';
import { assertOrderSimAssignmentsComplete, readOrderSimAssignments, saveOrderSimAssignments, SimAssignmentValidationError } from '@/lib/admin/simAssignments.server';
import { readCatalogueSimFulfilmentProducts } from '@/lib/cataloguePublicProjection.server';
import { isKualaLumpurWorkingDay, malaysiaDate } from '@/lib/pickup';
import { orderDeliveryOption, orderPickupDate } from '@/lib/admin/types';

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
  { pattern: /^products\/\d+\/image-colors$/, methods: ['GET', 'PUT'] },
  { pattern: /^products\/\d+\/hidden-option-values$/, methods: ['GET', 'PUT'] },
  { pattern: /^orders$/, methods: ['GET'] },
  { pattern: /^couriers$/, methods: ['GET'] },
  { pattern: /^orders\/\d+$/, methods: ['GET', 'PATCH'] },
  { pattern: /^orders\/\d+\/status$/, methods: ['PUT'] },
  { pattern: /^orders\/[1-9]\d*\/collection-date$/, methods: ['PUT'] },
  { pattern: /^orders\/[1-9]\d*\/ready-for-collection-email$/, methods: ['POST'] },
  { pattern: /^orders\/\d+\/sim-assignments$/, methods: ['GET', 'PUT'] },
  { pattern: /^orders\/\d+\/sim-range-validation$/, methods: ['POST'] },
  { pattern: /^orders\/\d+\/sim-range-assignments$/, methods: ['PUT'] },
  { pattern: /^orders\/\d+\/fulfilment-metadata$/, methods: ['GET', 'PUT'] },
  { pattern: /^shipping-settings$/, methods: ['GET', 'PUT'] },
  { pattern: /^vouchers$/, methods: ['GET', 'POST'] },
  { pattern: /^vouchers\/\d+$/, methods: ['GET', 'PATCH', 'DELETE'] },
  { pattern: /^vouchers\/\d+\/status$/, methods: ['PATCH'] },
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

const unwrapOrder = (payload: Record<string, any> | null) => (
  payload?.data && typeof payload.data === 'object' ? payload.data : payload
);

async function readBundleOrder(orderId: number, headers: Headers) {
  const response = await fetch(`${BUNDLE_API}/orders/${orderId}`, { headers, cache: 'no-store' });
  const payload = await readUpstream(response) as Record<string, any> | null;
  if (!response.ok) throw new SimRangeError('Order could not be verified.', response.status);
  return unwrapOrder(payload) as Record<string, any>;
}

async function catalogueSimUnits(order: Record<string, any>) {
  return deriveSimUnits(order, {}, await readCatalogueSimFulfilmentProducts());
}

function nativeAssignmentTotal(payload: Record<string, any> | null) {
  return Math.max(0, Number(payload?.totalUnits) || 0);
}

function supplementalAssignmentPayload(orderId: number, stored: Awaited<ReturnType<typeof readOrderSimAssignments>>, prefixOptions: unknown[]) {
  return {
    orderId,
    status: stored.complete === stored.total ? 'COMPLETE' : 'PENDING',
    totalUnits: stored.total,
    assignedUnits: stored.complete,
    complete: stored.complete === stored.total,
    assignments: stored.units.map((unit) => ({
      orderItemId: Number(unit.orderItemId),
      unitNumber: unit.unitNumber,
      productTitle: unit.productName,
      assigned: unit.locked,
      simPrefix: unit.prefix,
      simSerial: unit.serial,
    })),
    prefixOptions,
    source: 'supplemental',
  };
}

async function proxy(request: NextRequest, context: { params: { path: string[] } }) {
  const path = context.params.path.join('/');
  const rule = rules.find((candidate) => candidate.pattern.test(path));
  if (!rule || !rule.methods.includes(request.method)) return safeError(404);
  const session = await getAdminSession(request);
  if (!session) return safeError(401);
  if (request.method !== 'GET' && !requestIsSameOrigin(request)) return safeError(403);
  if (path === 'shipping-settings') {
    try {
      if (request.method === 'GET') return NextResponse.json(await readShippingSettings(), { headers: { 'cache-control': 'no-store' } });
      return NextResponse.json(await saveShippingSettings(await request.json()), { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      return NextResponse.json({ message: reason instanceof Error ? reason.message : 'Shipping settings are invalid.' }, { status: 400 });
    }
  }

  const imageColorsMatch = /^products\/(\d+)\/image-colors$/.exec(path);
  if (imageColorsMatch) {
    try {
      const productId = Number(imageColorsMatch[1]);
      const assignments = request.method === 'GET'
        ? await readProductImageColors(productId)
        : await saveProductImageColors(productId, await request.json());
      return NextResponse.json({ assignments }, { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      return NextResponse.json({ message: reason instanceof Error ? reason.message : 'Image color assignments are invalid.' }, { status: 400 });
    }
  }

  const hiddenValuesMatch = /^products\/(\d+)\/hidden-option-values$/.exec(path);
  if (hiddenValuesMatch) {
    try {
      const productId = Number(hiddenValuesMatch[1]);
      const valueIds = request.method === 'GET'
        ? await readProductHiddenOptionValues(productId)
        : await saveProductHiddenOptionValues(productId, await request.json());
      return NextResponse.json({ valueIds }, { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      return NextResponse.json({ message: reason instanceof Error ? reason.message : 'Hidden option values are invalid.' }, { status: 400 });
    }
  }

  const headers = new Headers({ authorization: `Bearer ${session.token}`, accept: 'application/json' });

  const collectionDateMatch = request.method === 'PUT' ? /^orders\/([1-9]\d*)\/collection-date$/.exec(path) : null;
  if (collectionDateMatch) {
    if (process.env.BUNDLE_COLLECTION_DATE_ENABLED === 'false') {
      return NextResponse.json({ message: 'Collection date editing is disabled by configuration.' }, { status: 503 });
    }
    try {
      const orderId = Number(collectionDateMatch[1]);
      const body = await request.json() as { collectionDate?: unknown; expectedCollectionDate?: unknown };
      const collectionDate = String(body.collectionDate || '');
      const expectedCollectionDate = body.expectedCollectionDate === null ? null : String(body.expectedCollectionDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(collectionDate) || collectionDate < malaysiaDate() || !isKualaLumpurWorkingDay(collectionDate)) {
        return NextResponse.json({ message: 'Choose today or a future Kuala Lumpur working day.' }, { status: 400 });
      }
      if (expectedCollectionDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expectedCollectionDate)) {
        return NextResponse.json({ message: 'The expected collection date is invalid.' }, { status: 400 });
      }
      const orderResponse = await fetch(`${BUNDLE_API}/orders/${orderId}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const orderPayload = await readUpstream(orderResponse) as Record<string, any> | null;
      if (!orderResponse.ok) return safeError(orderResponse.status, orderPayload);
      const order = orderPayload?.data && typeof orderPayload.data === 'object' ? orderPayload.data : orderPayload;
      if (!order || orderDeliveryOption(order as any) !== 'PICKUP') {
        return NextResponse.json({ message: 'Collection date can be changed only for a pickup order.' }, { status: 400 });
      }
      const currentCollectionDate = orderPickupDate(order as any) || null;
      if (currentCollectionDate !== expectedCollectionDate) {
        return NextResponse.json({
          message: 'The collection date changed after this order was opened. Review the latest date and try again.',
          currentCollectionDate,
        }, { status: 409 });
      }
      const updateHeaders = new Headers(headers);
      updateHeaders.set('content-type', 'application/json');
      const updateResponse = await fetch(`${BUNDLE_API}/orders/${orderId}`, {
        method: 'PATCH',
        headers: updateHeaders,
        body: JSON.stringify({ collectionDate, expectedCollectionDate: currentCollectionDate }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const updatePayload = await readUpstream(updateResponse) as Record<string, any> | null;
      if (!updateResponse.ok) return safeError(updateResponse.status, updatePayload);
      const updated = updatePayload?.data && typeof updatePayload.data === 'object' ? updatePayload.data : updatePayload;
      if (!updated || orderPickupDate(updated as any) !== collectionDate) {
        return NextResponse.json({ message: 'Bundle API did not confirm the new collection date.' }, { status: 502 });
      }
      return NextResponse.json(sanitizePayload(updated), { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      const status = reason instanceof Error && ['AbortError', 'TimeoutError'].includes(reason.name) ? 504 : 500;
      return NextResponse.json({ message: status === 504 ? 'Bundle API timed out while updating the collection date.' : 'The collection date could not be updated.' }, { status, headers: { 'cache-control': 'no-store' } });
    }
  }

  const readyEmailMatch = request.method === 'POST' ? /^orders\/([1-9]\d*)\/ready-for-collection-email$/.exec(path) : null;
  if (readyEmailMatch) {
    try {
      const orderId = Number(readyEmailMatch[1]);
      const body = await request.json() as { status?: unknown };
      const result = await orchestrateReadyCollectionEmail(orderId, String(body.status || ''), {
        store: defaultReadyCollectionEmailStore,
        async readOrder(id) {
          const response = await fetch(`${BUNDLE_API}/orders/${id}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
          const payload = await readUpstream(response) as Record<string, any> | null;
          if (!response.ok) throw new ReadyCollectionEmailError('Order could not be verified.', response.status);
          return (payload?.data && typeof payload.data === 'object' ? payload.data : payload) as any;
        },
        async updateStatus(id) {
          const response = await fetch(`${BUNDLE_API}/orders/${id}/status`, {
            method: 'PUT', headers: new Headers({ ...Object.fromEntries(headers), 'content-type': 'application/json' }),
            body: JSON.stringify({ status: 'PROCESSING' }), cache: 'no-store', signal: AbortSignal.timeout(15_000),
          });
          const payload = await readUpstream(response);
          if (!response.ok) throw new ReadyCollectionEmailError('Pickup status could not be updated.', response.status);
          void payload;
        },
        sendEmail: (id) => fetch(`${BUNDLE_API}/orders/${id}/resend-ready-email`, {
          method: 'POST', headers, cache: 'no-store', signal: AbortSignal.timeout(15_000),
        }),
      });
      return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      const status = reason instanceof ReadyCollectionEmailError ? reason.status : 500;
      return NextResponse.json({ message: reason instanceof Error ? reason.message : 'Ready for Collection operation failed.' }, { status, headers: { 'cache-control': 'no-store' } });
    }
  }

  const rangeValidationMatch = /^orders\/(\d+)\/sim-range-validation$/.exec(path);
  if (rangeValidationMatch) {
    try {
      const orderId = Number(rangeValidationMatch[1]);
      const body = await request.json() as Record<string, unknown>;
      const productCode = body.productCode === 'TWP' ? 'TWP' : body.productCode === 'TWE' ? 'TWE' : null;
      if (!productCode) throw new SimRangeError('Select Tone Excel or Tone Plus.');
      const orderResponse = await fetch(`${BUNDLE_API}/orders/${orderId}`, { headers, cache: 'no-store' });
      const orderPayload = await readUpstream(orderResponse) as Record<string, any> | null;
      if (!orderResponse.ok) throw new SimRangeError('Order could not be verified.', orderResponse.status);
      const orderValue = orderPayload?.data && typeof orderPayload.data === 'object' ? orderPayload.data : orderPayload;
      const orderItems = Array.isArray(orderValue?.items) ? orderValue.items : Array.isArray(orderValue?.orderItems) ? orderValue.orderItems : [];
      const orderItem = orderItems.find((item: any) => Number(item.id || item.orderItemId) === Number(body.orderItemId));
      if (!orderItem) throw new SimRangeError('SIM order line was not found.', 404);
      const searchableNetwork = JSON.stringify({ sku: orderItem?.variant?.sku || orderItem?.productVariant?.sku || orderItem?.sku, selectedOptions: orderItem?.variant?.selectedOptions || orderItem?.productVariant?.selectedOptions || orderItem?.selectedOptions });
      const recordedCode = /tone\s*plus|\bTWP\b/i.test(searchableNetwork) ? 'TWP' : /tone\s*excel|\bTWE\b/i.test(searchableNetwork) ? 'TWE' : null;
      if (recordedCode && recordedCode !== productCode) throw new SimRangeError(`This order line was purchased as ${recordedCode}.`);
      const rangeStart = String(body.startSerial || '').replace(/\D/g, '');
      const rangeEnd = String(body.endSerial || '').replace(/\D/g, '');
      if (/^\d{10,11}$/.test(rangeStart) && /^\d{10,11}$/.test(rangeEnd)) {
        const requestedQuantity = Number(rangeEnd.slice(0, 10)) - Number(rangeStart.slice(0, 10)) + 1;
        if (requestedQuantity > Math.max(0, Math.floor(Number(orderItem.quantity) || 0))) throw new SimRangeError('SIM range exceeds the quantity purchased for this order line.');
      }
      const options = await getSimPrefixOptions(productCode);
      const selectedPrefix = options.find((option) => option.id === String(body.prefixId));
      if (!selectedPrefix || selectedPrefix.prefix !== String(body.simPrefix || '')) throw new SimRangeError('Select a valid SIM prefix.');
      return NextResponse.json(await validateSimRange({
        orderId,
        orderItemId: Number(body.orderItemId),
        productCode,
        prefixId: selectedPrefix.id,
        fallbackPrefixIds: options.map((option) => option.id),
        simPrefix: selectedPrefix.prefix,
        startSerial: String(body.startSerial || ''),
        endSerial: String(body.endSerial || ''),
      }), { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'SIM range validation failed.';
      const status = reason instanceof SimRangeError ? reason.status : reason instanceof SimPrefixError ? 502 : 500;
      return NextResponse.json({ message }, { status, headers: { 'cache-control': 'no-store' } });
    }
  }

  const rangeAssignmentMatch = /^orders\/(\d+)\/sim-range-assignments$/.exec(path);
  if (rangeAssignmentMatch) {
    try {
      const orderId = Number(rangeAssignmentMatch[1]);
      const body = await request.json() as { tokens?: unknown };
      if (!Array.isArray(body.tokens) || !body.tokens.length || body.tokens.some((token) => typeof token !== 'string')) {
        throw new SimRangeError('Validate at least one SIM range before saving.');
      }
      const payloads = body.tokens.map((token) => decryptSimAssignmentToken(String(token)));
      if (payloads.some((payload) => payload.orderId !== orderId)) throw new SimRangeError('SIM validation does not belong to this order.');
      const allSerials = payloads.flatMap((payload) => payload.serials.map((serial) => serial.simSerial));
      if (new Set(allSerials).size !== allSerials.length) throw new SimRangeError('Duplicate or overlapping SIM ranges were found.');

      const currentResponse = await fetch(`${BUNDLE_API}/orders/${orderId}/sim-assignments`, { headers, cache: 'no-store' });
      const currentPayload = await readUpstream(currentResponse) as Record<string, any> | null;
      if (!currentResponse.ok) return safeError(currentResponse.status, currentPayload);
      if (nativeAssignmentTotal(currentPayload) === 0) {
        const order = await readBundleOrder(orderId, headers);
        const units = await catalogueSimUnits(order);
        if (!units.length) throw new SimRangeError('This order has no published SIM Card items.', 409);
        const stored = await readOrderSimAssignments(orderId, units);
        const replacements = new Map<string, { prefixId:string; prefix:string; serial:string; puk:string }>();
        for (const orderItemId of Array.from(new Set(payloads.map((payload) => payload.orderItemId)))) {
          const targets = stored.units
            .filter((unit) => Number(unit.orderItemId) === orderItemId && !unit.locked)
            .sort((left, right) => left.unitNumber - right.unitNumber);
          const ranges = payloads.filter((payload) => payload.orderItemId === orderItemId);
          const serials = ranges.flatMap((payload) => payload.serials.map((serial) => ({ ...serial, payload })));
          if (serials.length !== targets.length) throw new SimRangeError(`Validated quantity for order item ${orderItemId} must equal its ${targets.length} unassigned units.`);
          targets.forEach((target, index) => replacements.set(target.unitKey, {
            prefixId: serials[index].payload.prefixId,
            prefix: serials[index].payload.simPrefix,
            serial: serials[index].simSerial,
            puk: serials[index].puk,
          }));
        }
        const saved = await saveOrderSimAssignments(orderId, units, stored.units.map((unit) => ({
          unitKey: unit.unitKey,
          prefixId: replacements.get(unit.unitKey)?.prefixId || unit.prefixId,
          prefix: replacements.get(unit.unitKey)?.prefix || unit.prefix,
          serial: replacements.get(unit.unitKey)?.serial || unit.serial,
          ...(replacements.get(unit.unitKey)?.puk ? { puk: replacements.get(unit.unitKey)!.puk } : {}),
        })));
        return NextResponse.json(supplementalAssignmentPayload(orderId, saved, await getSimPrefixOptions()), { headers: { 'cache-control': 'no-store' } });
      }
      const currentAssignments = Array.isArray(currentPayload?.assignments) ? currentPayload.assignments : [];
      const assignments: Array<Record<string, unknown>> = [];
      for (const orderItemId of Array.from(new Set(payloads.map((payload) => payload.orderItemId)))) {
        const targets = currentAssignments
          .filter((unit: any) => Number(unit.orderItemId) === orderItemId && !unit.assigned)
          .sort((left: any, right: any) => Number(left.unitNumber) - Number(right.unitNumber));
        const ranges = payloads.filter((payload) => payload.orderItemId === orderItemId);
        const serials = ranges.flatMap((payload) => payload.serials.map((serial) => ({ ...serial, payload })));
        if (serials.length !== targets.length) {
          throw new SimRangeError(`Validated quantity for order item ${orderItemId} must equal its ${targets.length} unassigned units.`);
        }
        targets.forEach((target: any, index: number) => {
          const source = serials[index];
          assignments.push({
            orderItemId,
            unitNumber: Number(target.unitNumber),
            simPrefix: source.payload.simPrefix,
            simSerial: source.simSerial,
            puk: source.puk,
          });
        });
      }
      const saveResponse = await fetch(`${BUNDLE_API}/orders/${orderId}/sim-assignments`, {
        method: 'PUT',
        headers: new Headers({ authorization: `Bearer ${session.token}`, accept: 'application/json', 'content-type': 'application/json' }),
        body: JSON.stringify({ assignments }),
        cache: 'no-store',
      });
      const savePayload = await readUpstream(saveResponse);
      if (!saveResponse.ok) return safeError(saveResponse.status, savePayload);
      return NextResponse.json(sanitizePayload(savePayload ?? {}), { status: saveResponse.status, headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'SIM assignments could not be saved.';
      return NextResponse.json({ message }, { status: reason instanceof SimRangeError ? reason.status : 500, headers: { 'cache-control': 'no-store' } });
    }
  }

  const metadataMatch = /^orders\/(\d+)\/fulfilment-metadata$/.exec(path);
  if (metadataMatch) {
    const orderId = Number(metadataMatch[1]);
    try {
      if (request.method === 'GET') return NextResponse.json(await readOrderMetadata(orderId), { headers: { 'cache-control': 'no-store' } });
      return NextResponse.json(await saveCourierMetadata(orderId, await request.json()), { headers: { 'cache-control': 'no-store' } });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Order metadata is temporarily unavailable.';
      return NextResponse.json({ message }, { status: reason instanceof OrderMetadataError ? 400 : 500, headers: { 'cache-control': 'no-store' } });
    }
  }
  const assignmentMatch = /^orders\/(\d+)\/sim-assignments$/.exec(path);
  if (assignmentMatch) {
    let prefixOptions;
    try { prefixOptions = await getSimPrefixOptions(); }
    catch (reason) { return NextResponse.json({ message: reason instanceof SimPrefixError ? reason.message : 'SIM prefix service is unavailable.' }, { status: 502, headers: { 'cache-control': 'no-store' } }); }
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const init: RequestInit = { method: request.method, headers, cache: 'no-store' };
    if (request.method === 'PUT') init.body = await request.arrayBuffer();
    let upstream: Response;
    try { upstream = await fetch(`${BUNDLE_API}/${path}${request.nextUrl.search}`, init); } catch { return safeError(502); }
    const payload = await readUpstream(upstream) as Record<string, any> | null;
    if (!upstream.ok) return safeError(upstream.status, payload);
    if (request.method === 'GET' && nativeAssignmentTotal(payload) === 0) {
      try {
        const orderId = Number(assignmentMatch[1]);
        const units = await catalogueSimUnits(await readBundleOrder(orderId, headers));
        const stored = await readOrderSimAssignments(orderId, units);
        return NextResponse.json(supplementalAssignmentPayload(orderId, stored, prefixOptions), { headers: { 'cache-control': 'no-store' } });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'SIM assignments could not be loaded.';
        return NextResponse.json({ message }, { status: reason instanceof SimRangeError ? reason.status : 503, headers: { 'cache-control': 'no-store' } });
      }
    }
    const value = sanitizePayload(payload ?? {});
    return NextResponse.json(value && typeof value === 'object' && !Array.isArray(value) ? { ...value, prefixOptions } : { assignments: value, prefixOptions }, { status: upstream.status, headers: { 'cache-control': 'no-store' } });
  }

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

  const orderStatusMatch = request.method === 'PUT' ? /^orders\/(\d+)\/status$/.exec(path) : null;
  if (orderStatusMatch) {
    const body = await request.arrayBuffer();
    let requestedStatus = '';
    try { requestedStatus = String(JSON.parse(Buffer.from(body).toString('utf8'))?.status || '').toUpperCase(); } catch {}
    if (requestedStatus === 'SHIPPED') {
      try {
        const orderId = Number(orderStatusMatch[1]);
        const units = await catalogueSimUnits(await readBundleOrder(orderId, headers));
        if (units.length) {
          const nativeResponse = await fetch(`${BUNDLE_API}/orders/${orderId}/sim-assignments`, { headers, cache: 'no-store' });
          const nativePayload = await readUpstream(nativeResponse) as Record<string, any> | null;
          if (!nativeResponse.ok) return safeError(nativeResponse.status, nativePayload);
          if (nativeAssignmentTotal(nativePayload) > 0) {
            if (Number(nativePayload?.assignedUnits) !== Number(nativePayload?.totalUnits)) throw new SimAssignmentValidationError(`Complete SIM assignments for all ${nativePayload?.totalUnits} SIM units before shipping.`);
          } else await assertOrderSimAssignmentsComplete(orderId, units);
        }
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'SIM assignment status could not be verified.';
        return NextResponse.json({ message }, { status: reason instanceof SimAssignmentValidationError ? 409 : reason instanceof SimRangeError ? reason.status : 503, headers: { 'cache-control': 'no-store' } });
      }
    }
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    let upstream: Response;
    try { upstream = await fetch(`${BUNDLE_API}/${path}${request.nextUrl.search}`, { method:'PUT', headers, body, cache:'no-store' }); } catch { return safeError(502); }
    const payload = await readUpstream(upstream);
    if (!upstream.ok) return safeError(upstream.status, payload);
    return NextResponse.json(sanitizePayload(payload ?? {}), { status: upstream.status, headers: { 'cache-control': 'no-store' } });
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
