'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UnifiedProductEditorSaveIntent } from '@/components/admin/UnifiedProductEditor';
import type { ProductEditorSpec } from '@/lib/admin/productEditor';

export type CatalogueProduct = {
  catalogueId: string;
  revision: number;
  model: ProductEditorSpec;
  slug: string;
  status: 'draft' | 'published';
};

export type CatalogueMedia = {
  mediaId: string;
  catalogueId: string;
  originalName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  order: number;
  assignment: 'all' | string;
  createdAt: string;
  url?: string;
};

type ProductResponse = { product: CatalogueProduct };
type MediaResponse = { media: CatalogueMedia[] };
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class CatalogueEditorApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CatalogueEditorApiError';
  }
}

async function readJson<T>(fetcher: Fetcher, path: string, init: RequestInit): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: init.body instanceof FormData
      ? init.headers
      : { 'content-type': 'application/json', ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : 'The catalogue product could not be saved.';
    throw new CatalogueEditorApiError(message, response.status);
  }
  return payload as T;
}

export function createCatalogueProductEditorClient(fetcher: Fetcher = fetch) {
  const paths = (catalogueId: string) => {
    const product = `/admin-api/catalogue-products/${encodeURIComponent(catalogueId)}`;
    return { product, media: `${product}/media`, removal: (operationId: string) => `${product}/media-removals/${encodeURIComponent(operationId)}` };
  };

  const loadMedia = (catalogueId: string) => readJson<MediaResponse>(fetcher, paths(catalogueId).media, { method: 'GET' });

  const load = async (catalogueId: string) => {
    const path = paths(catalogueId);
    const [product, media] = await Promise.all([
      readJson<ProductResponse>(fetcher, path.product, { method: 'GET' }),
      loadMedia(catalogueId),
    ]);
    return { product: product.product, media: media.media };
  };

  return {
    load,

    async save(product: CatalogueProduct, intent: UnifiedProductEditorSaveIntent) {
      const path = paths(product.catalogueId);
      const snapshot = await load(product.catalogueId);
      if (snapshot.product.revision !== product.revision) {
        throw new CatalogueEditorApiError('Catalogue product revision conflict. Reload before saving.', 409);
      }

      const originalIds = snapshot.media.map((item) => item.mediaId);
      const originalById = new Map(snapshot.media.map((item) => [item.mediaId, item]));
      const intendedIds = intent.existingMedia.map((item) => item.mediaId);
      if (originalIds.some((mediaId) => typeof mediaId !== 'string' || !mediaId)
        || new Set(originalIds).size !== originalIds.length
        || intendedIds.some((mediaId) => typeof mediaId !== 'string' || !mediaId)
        || new Set(intendedIds).size !== intendedIds.length
        || intendedIds.length !== snapshot.media.length
        || intendedIds.some((mediaId) => !originalById.has(mediaId))) {
        throw new Error('Catalogue media changed. Reload before saving.');
      }
      const survivors = intent.existingMedia.filter((photo) => !photo.remove);
      const removed = intent.existingMedia.filter((photo) => photo.remove);
      const finalOrders = [...survivors, ...intent.pendingPhotos].map((photo) => photo.order).sort((left, right) => left - right);
      if (finalOrders.some((order, index) => order !== index)) {
        throw new Error('Catalogue media orders must be contiguous from zero.');
      }
      const sameMedia = (actual: CatalogueMedia[], expected: Array<{ mediaId: string; order: number; assignment: string }>) => {
        const normalized = actual.map(({ mediaId, order, assignment }) => ({ mediaId, order, assignment }))
          .sort((left, right) => left.mediaId.localeCompare(right.mediaId));
        const wanted = expected.map(({ mediaId, order, assignment }) => ({ mediaId, order, assignment }))
          .sort((left, right) => left.mediaId.localeCompare(right.mediaId));
        return JSON.stringify(normalized) === JSON.stringify(wanted);
      };
      const originalExpected = snapshot.media.map(({ mediaId, order, assignment }) => ({ mediaId, order, assignment }));
      const mediaUnchanged = intent.pendingPhotos.length === 0 && removed.length === 0
        && survivors.every((photo) => {
          const original = originalById.get(photo.mediaId)!;
          return photo.order === original.order && photo.assignment === original.assignment;
        });
      if (mediaUnchanged) {
        const updated = await readJson<ProductResponse>(fetcher, path.product, {
          method: 'PATCH',
          body: JSON.stringify({
            revision: snapshot.product.revision,
            slug: snapshot.product.slug,
            model: { ...intent.spec, existingImages: snapshot.product.model.existingImages },
          }),
        });
        const media = await loadMedia(product.catalogueId);
        if (!sameMedia(media.media, originalExpected)) {
          throw new Error('Catalogue media changed while saving. Reload before editing again.');
        }
        return { product: updated.product, media: media.media.sort((left, right) => left.order - right.order) };
      }

      const highestOriginalOrder = Math.max(-1, ...snapshot.media.map((item) => item.order));
      const uploadStart = highestOriginalOrder + 1;
      const stageStart = uploadStart + intent.pendingPhotos.length;
      const recoveryStart = stageStart + snapshot.media.length + intent.pendingPhotos.length + 1;
      if (![uploadStart, stageStart, recoveryStart + snapshot.media.length + intent.pendingPhotos.length].every(Number.isSafeInteger)) {
        throw new Error('Catalogue media orders cannot be moved to a safe temporary range.');
      }
      const uploaded: CatalogueMedia[] = [];
      let metadataUpdate: CatalogueProduct | null = null;
      let stagedMedia: CatalogueMedia[] | null = null;

      const patchMedia = (mediaId: string, body: { order: number; assignment?: string }) => readJson<{ media: CatalogueMedia }>(
        fetcher,
        `${path.media}/${encodeURIComponent(mediaId)}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      const deleteMedia = (mediaId: string) => readJson<{ media: CatalogueMedia }>(
        fetcher,
        `${path.media}/${encodeURIComponent(mediaId)}`,
        { method: 'DELETE' },
      );
      const compensate = async (reason: unknown) => {
        const compensationErrors: string[] = [];
        for (let index = 0; index < uploaded.length; index += 1) {
          const item = uploaded[index];
          try { await deleteMedia(item.mediaId); }
          catch (cleanupReason) {
            compensationErrors.push(`cleanup ${item.mediaId}: ${cleanupReason instanceof Error ? cleanupReason.message : String(cleanupReason)}`);
            try { await patchMedia(item.mediaId, { order: recoveryStart + snapshot.media.length + index }); }
            catch (moveReason) { compensationErrors.push(`isolate ${item.mediaId}: ${moveReason instanceof Error ? moveReason.message : String(moveReason)}`); }
          }
        }
        for (let index = 0; index < snapshot.media.length; index += 1) {
          try { await patchMedia(snapshot.media[index].mediaId, { order: recoveryStart + index }); }
          catch (restoreReason) { compensationErrors.push(`stage restore ${snapshot.media[index].mediaId}: ${restoreReason instanceof Error ? restoreReason.message : String(restoreReason)}`); }
        }
        for (const item of snapshot.media) {
          try { await patchMedia(item.mediaId, { order: item.order, assignment: item.assignment }); }
          catch (restoreReason) { compensationErrors.push(`restore ${item.mediaId}: ${restoreReason instanceof Error ? restoreReason.message : String(restoreReason)}`); }
        }
        try {
          const currentProduct = await readJson<ProductResponse>(fetcher, path.product, { method: 'GET' });
          if (currentProduct.product.revision !== snapshot.product.revision
            || currentProduct.product.slug !== snapshot.product.slug
            || JSON.stringify(currentProduct.product.model) !== JSON.stringify(snapshot.product.model)) {
            await readJson<ProductResponse>(fetcher, path.product, {
              method: 'PATCH',
              body: JSON.stringify({ revision: currentProduct.product.revision, slug: snapshot.product.slug, model: snapshot.product.model }),
            });
          }
        } catch (restoreReason) {
          compensationErrors.push(`restore product: ${restoreReason instanceof Error ? restoreReason.message : String(restoreReason)}`);
        }
        try {
          const restoredMedia = await loadMedia(product.catalogueId);
          const restoredExpected = snapshot.media.map(({ mediaId, order, assignment }) => ({ mediaId, order, assignment }));
          const remainingUploaded = new Set(uploaded.map((item) => item.mediaId));
          if (restoredMedia.media.some((item) => remainingUploaded.has(item.mediaId))
            || !sameMedia(restoredMedia.media, restoredExpected)) {
            compensationErrors.push('media compensation readback did not match the preimage');
          }
        } catch (restoreReason) {
          compensationErrors.push(`verify compensation: ${restoreReason instanceof Error ? restoreReason.message : String(restoreReason)}`);
        }
        const message = reason instanceof Error ? reason.message : 'The catalogue product could not be saved.';
        if (compensationErrors.length) throw new Error(`${message} Compensation was incomplete: ${compensationErrors.join('; ')}`);
        throw reason;
      };

      try {
        for (let index = 0; index < intent.pendingPhotos.length; index += 1) {
          const photo = intent.pendingPhotos[index];
          const form = new FormData();
          form.append('file', photo.file);
          form.append('order', String(uploadStart + index));
          form.append('assignment', photo.assignment);
          const created = await readJson<{ media: CatalogueMedia }>(fetcher, path.media, { method: 'POST', body: form });
          if (!created.media?.mediaId || originalById.has(created.media.mediaId)
            || uploaded.some((item) => item.mediaId === created.media.mediaId)) {
            throw new Error('Catalogue media upload returned an invalid media identity.');
          }
          uploaded.push(created.media);
        }

        const afterUploads = await loadMedia(product.catalogueId);
        const uploadedExpected = uploaded.map((item, index) => ({
          mediaId: item.mediaId, order: uploadStart + index, assignment: intent.pendingPhotos[index].assignment,
        }));
        if (!sameMedia(afterUploads.media, [...originalExpected, ...uploadedExpected])) {
          throw new Error('Catalogue media upload readback did not match the requested files.');
        }

        for (let index = 0; index < snapshot.media.length; index += 1) {
          await patchMedia(snapshot.media[index].mediaId, { order: stageStart + index });
        }
        const finalMedia = [
          ...survivors.map((photo) => ({ mediaId: photo.mediaId, order: photo.order, assignment: photo.assignment })),
          ...intent.pendingPhotos.map((photo, index) => ({ mediaId: uploaded[index].mediaId, order: photo.order, assignment: photo.assignment })),
        ].sort((left, right) => left.order - right.order);
        for (const item of finalMedia) await patchMedia(item.mediaId, { order: item.order, assignment: item.assignment });

        const updated = await readJson<ProductResponse>(fetcher, path.product, {
          method: 'PATCH',
          body: JSON.stringify({
            revision: snapshot.product.revision,
            slug: snapshot.product.slug,
            model: { ...intent.spec, existingImages: snapshot.product.model.existingImages },
          }),
        });
        metadataUpdate = updated.product;

        const beforeDelete = await loadMedia(product.catalogueId);
        const stagedRemoved = removed.map((photo) => {
          const index = snapshot.media.findIndex((item) => item.mediaId === photo.mediaId);
          return { mediaId: photo.mediaId, order: stageStart + index, assignment: originalById.get(photo.mediaId)!.assignment };
        });
        if (!sameMedia(beforeDelete.media, [...finalMedia, ...stagedRemoved])) {
          throw new Error('Catalogue media final readback did not match before removal.');
        }
        stagedMedia = beforeDelete.media;
      } catch (reason) {
        return compensate(reason);
      }

      const removedIds = new Set(removed.map((photo) => photo.mediaId));
      const committedMedia = stagedMedia!.filter((item) => !removedIds.has(item.mediaId)).sort((left, right) => left.order - right.order);
      if (removed.length === 0) return { product: metadataUpdate!, media: committedMedia };

      const operationId = globalThis.crypto.randomUUID();
      const operationPath = path.removal(operationId);
      type RemovalResponse = { operation: { operationId: string; status: 'prepared' | 'committed' | 'rolled_back' } };
      const finalize = () => readJson<RemovalResponse>(fetcher, operationPath, {
        method: 'POST', body: JSON.stringify({ mediaIds: removed.map((photo) => photo.mediaId) }),
      });
      const reconcile = () => readJson<RemovalResponse>(fetcher, operationPath, { method: 'GET' });
      let failure: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let result: RemovalResponse;
        try { result = await finalize(); }
        catch (reason) {
          failure = reason;
          try { result = await reconcile(); }
          catch { throw new Error(`Catalogue media removal outcome is uncertain. Reconcile operation ${operationId} before editing again.`); }
        }
        if (result.operation?.operationId !== operationId) {
          throw new Error(`Catalogue media removal outcome is uncertain. Reconcile operation ${operationId} before editing again.`);
        }
        if (result.operation.status === 'committed') return { product: metadataUpdate!, media: committedMedia };
        if (result.operation.status === 'rolled_back') return compensate(failure || new Error('Catalogue media removal was rolled back.'));
      }
      throw new Error(`Catalogue media removal outcome is uncertain. Reconcile operation ${operationId} before editing again.`);
    },
  };
}

export function useCatalogueProductEditor(catalogueId: string) {
  const client = useMemo(() => createCatalogueProductEditorClient(), []);
  const [product, setProduct] = useState<CatalogueProduct | null>(null);
  const [media, setMedia] = useState<CatalogueMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await client.load(catalogueId);
      setProduct(next.product);
      setMedia(next.media);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The catalogue product could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [catalogueId, client]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (intent: UnifiedProductEditorSaveIntent) => {
    if (!product) throw new Error('The catalogue product is still loading.');
    setSaving(true);
    setError(null);
    try {
      const next = await client.save(product, intent);
      setProduct(next.product);
      setMedia(next.media);
      return next;
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'The catalogue product could not be saved.';
      setError(message);
      throw problem;
    } finally {
      setSaving(false);
    }
  }, [catalogueId, client, product]);

  return { product, media, loading, saving, error, reload: load, save };
}
