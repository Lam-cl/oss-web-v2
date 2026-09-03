'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminShell from '@/components/admin/AdminShell';
import UnifiedProductEditor from '@/components/admin/UnifiedProductEditor';
import type {
  UnifiedProductEditorExistingPhoto,
  UnifiedProductEditorPendingPhoto,
  UnifiedProductEditorSaveIntent,
} from '@/components/admin/UnifiedProductEditor';
import { Icon } from '@/components/admin/Icons';
import { Empty, ErrorState, Skeleton, StatusBadge, Toast } from '@/components/admin/UI';
import { adminFetch } from '@/lib/admin/client';
import { money, Paged, Product } from '@/lib/admin/types';
import type { ProductEditorSpec } from '@/lib/admin/productEditor';
import { productInventory } from '@/lib/admin/productStock';
import {
  catalogueVariantBindingMap,
  reconcileCatalogueInventoryChanges,
  rebindCatalogueModelVariantIds,
  type CatalogueVariantBindingRow,
} from '@/lib/admin/catalogueVariantBindings';

import { useCatalogueProductEditor } from '@/hooks/useCatalogueProductEditor';
import {
  catalogueHazardReason,
  catalogueChoiceSummary,
  genericCatalogueLifecycleAllowed,
  hasValidCatalogueVariants,
  isSystemCatalogueProduct,
  productSearchText,
  publicationActionPresentation,
  sanitizeProviderDescription,
  sanitizeProviderTitle,
  unresolvedPublication,
} from './productPresentation';

type CatalogueProductRecord = {
  catalogueId: string;
  revision: number;
  model: ProductEditorSpec;
  slug: string;
  status: 'draft' | 'published';
  currentBundleProductId: number | null;
  bundleVersions: Array<{ bundleProductId: number; retiredAt: string | null }>;
  updatedAt: string;
  minimumOrderQuantity?: number;
  publicationChangeState: 'clean' | 'dirty' | 'unknown';
  publicationChangeReason?: string;
};


type EditorTarget = { kind: 'new' } | { kind: 'existing'; product: CatalogueProductRecord };
type ProductRow =
  | { kind: 'catalogue'; catalogue: CatalogueProductRecord; product?: Product }
  | { kind: 'legacy'; product: Product };
type CatalogueMediaSummary = { order: number; assignment: 'all' | string };
type CataloguePublicationSummary = { phase: string };

const emptyProduct: ProductEditorSpec = {
  details: { title: '', description: '', price: 0, minimumOrderQuantity: 1 },
  choices: [],
  combinations: [{ valueKeys: [], price: 0, inventory: 0 }],
  existingImages: [],
};

async function catalogueRequest<T>(path = '', init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/admin-api/catalogue-products${path}`, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error('Your session has ended.');
  }
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : 'The product could not be saved.');
  return payload as T;
}

function canPublishCatalogueProduct(product: CatalogueProductRecord, media: CatalogueMediaSummary[] | undefined) {
  const newDraft = product.status === 'draft' && product.currentBundleProductId === null;
  if ((!newDraft && product.publicationChangeState !== 'dirty') || !media?.length) return false;
  const { model } = product;
  if (!model.details.title.trim() || !hasValidCatalogueVariants(model)) return false;
  const activeChoices = model.choices.map((choice) => choice.values.filter((value) => !value.retired));
  const activeValueKeys = new Set(activeChoices.flatMap((values) => values.map((value) => value.key)));
  const orderedMedia = [...media].sort((left, right) => left.order - right.order);
  return orderedMedia.every((item, index) => item.order === index && (item.assignment === 'all' || activeValueKeys.has(item.assignment)));
}

function productSlug(title: string) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128);
}

type CatalogueInventoryResponse = {
  bundleProductId: number;
  inventory: Array<{ valueKeys: string[]; variantId: number; inventory: number }>;
};

function catalogueContentIntent(
  intent: UnifiedProductEditorSaveIntent,
  persisted: ProductEditorSpec,
  bindings: readonly CatalogueVariantBindingRow[],
): UnifiedProductEditorSaveIntent {
  const previous = new Map(persisted.combinations.map((combination) => [JSON.stringify(combination.valueKeys), combination]));
  const rebound = rebindCatalogueModelVariantIds(intent.spec, bindings);
  return {
    ...intent,
    spec: {
      ...rebound,
      combinations: rebound.combinations.map((combination) => {
        const stored = previous.get(JSON.stringify(combination.valueKeys));
        return stored
          ? { ...combination, inventory: stored.inventory }
          : combination;
      }),
    },
  };
}

function ExistingCatalogueEditor({ catalogueProduct, availableCategories, onClose, onSaved }: {
  catalogueProduct: CatalogueProductRecord;
  availableCategories: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const catalogueId = catalogueProduct.catalogueId;
  const { product, media, loading, saving, error, save } = useCatalogueProductEditor(catalogueId);
  const [model, setModel] = useState<ProductEditorSpec | null>(null);
  const [existingPhotos, setExistingPhotos] = useState<UnifiedProductEditorExistingPhoto[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<UnifiedProductEditorPendingPhoto[]>([]);
  const [inventory, setInventory] = useState<CatalogueInventoryResponse | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(catalogueProduct.status === 'published');
  const [inventoryError, setInventoryError] = useState<string | null>(null);

  useEffect(() => {
    if (product) setModel(product.model);
  }, [product]);
  useEffect(() => {
    setExistingPhotos(media.flatMap((photo) => photo.url ? [{
      mediaId: photo.mediaId,
      url: photo.url,
      alt: photo.originalName,
      assignment: photo.assignment,
      order: photo.order,
    }] : []));
  }, [media]);
  useEffect(() => {
    if (catalogueProduct.status !== 'published' || catalogueProduct.currentBundleProductId === null) {
      setInventoryLoading(false);
      return;
    }
    let active = true;
    setInventoryLoading(true);
    setInventoryError(null);
    void catalogueRequest<CatalogueInventoryResponse>(`/${encodeURIComponent(catalogueId)}/inventory`).then((result) => {
      if (active) setInventory(result);
    }).catch((problem) => {
      if (active) setInventoryError(problem instanceof Error ? problem.message : 'Live stock could not be loaded.');
    }).finally(() => {
      if (active) setInventoryLoading(false);
    });
    return () => { active = false; };
  }, [catalogueId, catalogueProduct.currentBundleProductId, catalogueProduct.status]);

  if (loading || inventoryLoading || !model) return <Skeleton rows={8} />;
  if (inventoryError) return <ErrorState message={inventoryError} retry={() => window.location.reload()} />;
  const liveInventory = inventory ? catalogueVariantBindingMap(inventory.inventory) : undefined;
  return <UnifiedProductEditor
    editorKey={catalogueId}
    availableCategories={availableCategories}
    minimumOrderQuantity={catalogueProduct.minimumOrderQuantity}
    saveMode="product"
    model={model}
    liveInventory={liveInventory}
    existingPhotos={existingPhotos}
    pendingPhotos={pendingPhotos}
    onModelChange={setModel}
    onPhotosChange={(nextExisting, nextPending) => {
      setExistingPhotos(nextExisting);
      setPendingPhotos(nextPending);
    }}
    onSave={async (intent) => {
      let latestInventory = inventory;
      let inventoryChanges = intent.inventoryChanges;
      if (inventoryChanges.length) {
        latestInventory = await catalogueRequest<CatalogueInventoryResponse>(`/${encodeURIComponent(catalogueId)}/inventory`);
        if (!inventory || latestInventory.bundleProductId !== inventory.bundleProductId) {
          throw new Error('The active product changed after this editor was opened. Reload before saving.');
        }
        inventoryChanges = reconcileCatalogueInventoryChanges(inventoryChanges, latestInventory.inventory);
      }
      const saved = await save(catalogueContentIntent(intent, product!.model, latestInventory?.inventory ?? []));
      if (inventoryChanges.length) {
        try {
          const updatedInventory = await catalogueRequest<CatalogueInventoryResponse>(`/${encodeURIComponent(catalogueId)}/inventory`, {
            method: 'PATCH',
            body: JSON.stringify({
              bundleProductId: latestInventory!.bundleProductId,
              changes: inventoryChanges,
            }),
          });
          setInventory(updatedInventory);
        } catch (problem) {
          const prefix = saved.product.revision !== product!.revision ? 'Product details were saved, but ' : '';
          const message = problem instanceof Error ? problem.message : 'live stock could not be updated.';
          throw new Error(`${prefix}${message.charAt(0).toLowerCase()}${message.slice(1)}`);
        }
      }
      setPendingPhotos([]);
      const contentChanged = saved.product.revision !== product!.revision;
      onSaved(contentChanged && inventoryChanges.length
        ? 'Product details saved and stock updated live. Publish changes to update the storefront details.'
        : inventoryChanges.length
          ? 'Stock updated live. No publication is required for stock-only changes.'
          : 'Product saved. Publish changes if the product now shows a pending change.');
    }}
    onCancel={onClose}
    saving={saving}
    error={error}
  />;
}

function CreateCatalogueEditor({ availableCategories, onClose, onCreated }: {
  availableCategories: string[];
  onClose: () => void;
  onCreated: (product: CatalogueProductRecord) => void;
}) {
  const [model, setModel] = useState<ProductEditorSpec>(emptyProduct);
  const [existingPhotos, setExistingPhotos] = useState<UnifiedProductEditorExistingPhoto[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<UnifiedProductEditorPendingPhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (intent: UnifiedProductEditorSaveIntent) => {
    setSaving(true);
    setError(null);
    try {
      const slug = productSlug(intent.spec.details.title);
      const { product } = await catalogueRequest<{ product: CatalogueProductRecord }>('', {
        method: 'POST',
        body: JSON.stringify({ model: intent.spec, slug }),
      });
      for (const photo of intent.pendingPhotos) {
        const form = new FormData();
        form.append('file', photo.file);
        form.append('order', String(photo.order));
        form.append('assignment', photo.assignment);
        const response = await fetch(`/admin-api/catalogue-products/${encodeURIComponent(product.catalogueId)}/media`, {
          method: 'POST',
          body: form,
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('The product was created, but a photo could not be added. Reopen the product to finish it.');
      }
      onCreated(product);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'The product could not be saved.';
      setError(message);
      throw problem;
    } finally {
      setSaving(false);
    }
  };

  return <UnifiedProductEditor
    editorKey="new-product"
    availableCategories={availableCategories}
    model={model}
    existingPhotos={existingPhotos}
    pendingPhotos={pendingPhotos}
    onModelChange={setModel}
    onPhotosChange={(nextExisting, nextPending) => {
      setExistingPhotos(nextExisting);
      setPendingPhotos(nextPending);
    }}
    onSave={create}
    onCancel={onClose}
    saving={saving}
    error={error}
  />;
}

function LegacyProductView({ product, onClose }: { product: Product; onClose: () => void }) {
  const stock = (product.productVariants || []).reduce((sum, variant) => sum + Number(variant.inventory || 0), 0);
  const title = sanitizeProviderTitle(product.title);
  const description = sanitizeProviderDescription(product.description || '');
  return <div className="adm-drawer-wrap">
    <button className="adm-modal-backdrop" aria-label="Close legacy product" onClick={onClose} />
    <section className="adm-drawer" role="dialog" aria-modal="true" aria-labelledby="legacy-product-title">
      <header className="adm-drawer-head"><div><span className="adm-eyebrow">Existing catalogue item</span><h2 id="legacy-product-title">View legacy product</h2></div><button className="adm-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
      <div className="adm-drawer-body">
        <section className="adm-section"><h3 className="adm-section-title">{title}</h3><p>{description || 'No description.'}</p></section>
        <section className="adm-section"><div className="adm-form-grid"><div className="adm-field"><span>Price</span><strong>{money(product.price)}</strong></div><div className="adm-field"><span>Variants</span><strong>{product.productVariants?.length || 0}</strong></div><div className="adm-field"><span>Inventory</span><strong>{stock}</strong></div><div className="adm-field"><span>Reference</span><strong>#{product.id}</strong></div></div></section>
        <div className="adm-warning">This older product is view-only here. It can be edited after it is moved to the new catalogue.</div>
      </div>
      <footer className="adm-drawer-foot"><button className="adm-button secondary" onClick={onClose}>Close</button></footer>
    </section>
  </div>;
}

function ProductsContent() {
  const params = useSearchParams();
  const [type, setType] = useState<'MOBILE' | 'MERCHANDISE'>('MERCHANDISE');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'out'>('all');
  const [data, setData] = useState<Paged<Product> | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueProductRecord[] | null>(null);
  const [catalogueMedia, setCatalogueMedia] = useState<Record<string, CatalogueMediaSummary[] | undefined>>({});
  const [cataloguePublications, setCataloguePublications] = useState<Record<string, CataloguePublicationSummary | null | undefined>>({});
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorTarget | undefined>(params.get('create') === '1' ? { kind: 'new' } : undefined);
  const [legacyViewer, setLegacyViewer] = useState<Product | null>(null);
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [publishingCatalogueId, setPublishingCatalogueId] = useState<string | null>(null);
  const publishingCatalogueIdRef = useRef<string | null>(null);
  const [archivingCatalogueId, setArchivingCatalogueId] = useState<string | null>(null);
  const archivingCatalogueIdRef = useRef<string | null>(null);
  const [unpublishingCatalogueId, setUnpublishingCatalogueId] = useState<string | null>(null);
  const unpublishingCatalogueIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [products, catalogueResponse] = await Promise.all([
        adminFetch<Paged<Product>>(`products?type=${type}&page=${page}&limit=20`),
        catalogueRequest<{ products: CatalogueProductRecord[] }>(),
      ]);
      const localDrafts = catalogueResponse.products.filter((product) => product.status === 'draft' && product.currentBundleProductId === null);
      const [mediaEntries, publicationEntries] = await Promise.all([
        Promise.all(catalogueResponse.products
          .filter((product) => product.status === 'draft' && product.currentBundleProductId === null || product.publicationChangeState === 'dirty')
          .map(async (product) => {
          try {
            const response = await catalogueRequest<{ media: CatalogueMediaSummary[] }>(`/${encodeURIComponent(product.catalogueId)}/media`);
            return [product.catalogueId, response.media] as const;
          } catch {
            return [product.catalogueId, undefined] as const;
          }
          })),
        Promise.all(localDrafts.map(async (product) => {
          try {
            const response = await catalogueRequest<{ publication: CataloguePublicationSummary | null }>(`/${encodeURIComponent(product.catalogueId)}/publication`);
            return [product.catalogueId, response.publication] as const;
          } catch {
            return [product.catalogueId, undefined] as const;
          }
        })),
      ]);
      setData(products);
      setCatalogue(catalogueResponse.products);
      setCatalogueMedia(Object.fromEntries(mediaEntries));
      setCataloguePublications(Object.fromEntries(publicationEntries));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Unable to load products.');
    }
  }, [type, page]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<ProductRow[]>(() => {
    if (!data || !catalogue) return [];
    const byPublishedId = new Map(catalogue.flatMap((product) => product.currentBundleProductId === null ? [] : [[product.currentBundleProductId, product] as const]));
    const listed = data.data.filter((product) => !isSystemCatalogueProduct(product)).map<ProductRow>((product) => {
      const migrated = byPublishedId.get(product.id);
      return migrated ? { kind: 'catalogue', catalogue: migrated, product } : { kind: 'legacy', product };
    });
    const drafts = page === 1 && type === 'MERCHANDISE'
      ? catalogue.filter((product) => product.currentBundleProductId === null).map<ProductRow>((product) => ({ kind: 'catalogue', catalogue: product }))
      : [];
    const search = query.trim().toLowerCase();
    return [...drafts, ...listed].filter((row) => {
      const product = row.product;
      const stock = productInventory(row.kind === 'catalogue' ? row.catalogue : null, product);
      return (stockFilter === 'all' || stock === 0) && (!search || productSearchText(row).toLowerCase().includes(search));
    });
  }, [catalogue, data, page, query, stockFilter, type]);
  const availableCategories = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const product of catalogue || []) {
      const category = product.model.details.category?.trim();
      if (category && !byKey.has(category.toLowerCase())) byKey.set(category.toLowerCase(), category);
    }
    return Array.from(byKey.values()).sort((left, right) => left.localeCompare(right));
  }, [catalogue]);

  const openCreate = () => {
    setType('MERCHANDISE');
    setPage(1);
    setEditor({ kind: 'new' });
  };
  const flash = (message: string, kind: 'success' | 'error' = 'success') => setToast({ message, kind });
  const publish = async (product: CatalogueProductRecord) => {
    if (publishingCatalogueIdRef.current) return;
    publishingCatalogueIdRef.current = product.catalogueId;
    setPublishingCatalogueId(product.catalogueId);
    try {
      await catalogueRequest(`/${encodeURIComponent(product.catalogueId)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ revision: product.revision }),
      });
      await load();
      flash('Product published successfully. It is now visible in OSS.');
    } catch {
      flash('The product could not be published. Please review it and try again.', 'error');
    } finally {
      publishingCatalogueIdRef.current = null;
      setPublishingCatalogueId(null);
    }
  };
  const unpublish = async (product: CatalogueProductRecord) => {
    if (unpublishingCatalogueIdRef.current || !window.confirm(`Unpublish ${product.model.details.title} from OSS?`)) return;
    unpublishingCatalogueIdRef.current = product.catalogueId;
    setUnpublishingCatalogueId(product.catalogueId);
    try {
      await catalogueRequest(`/${encodeURIComponent(product.catalogueId)}/unpublish`, {
        method: 'POST',
        body: JSON.stringify({ revision: product.revision }),
      });
      await load();
      flash('Product unpublished. You can now archive it.');
    } catch {
      flash('The product could not be unpublished. Please try again.', 'error');
    } finally {
      unpublishingCatalogueIdRef.current = null;
      setUnpublishingCatalogueId(null);
    }
  };
  const archive = async (product: CatalogueProductRecord) => {
    if (archivingCatalogueIdRef.current || !window.confirm(`Archive ${product.model.details.title}? It will be removed from the active catalogue.`)) return;
    archivingCatalogueIdRef.current = product.catalogueId;
    setArchivingCatalogueId(product.catalogueId);
    try {
      await catalogueRequest(`/${encodeURIComponent(product.catalogueId)}/archive`, {
        method: 'POST',
        body: JSON.stringify({ revision: product.revision }),
      });
      await load();
      flash('Product archived successfully.');
    } catch {
      flash('The product could not be archived. Unpublish it first, then try again.', 'error');
    } finally {
      archivingCatalogueIdRef.current = null;
      setArchivingCatalogueId(null);
    }
  };

  if (editor) return <AdminShell title="Products" eyebrow="Catalogue">
    {editor.kind === 'new'
      ? <CreateCatalogueEditor availableCategories={availableCategories} onClose={() => setEditor(undefined)} onCreated={() => {
          window.history.replaceState(null, '', '/admin/products');
          setEditor(undefined);
          flash('Product added successfully.');
          void load();
        }} />
      : <ExistingCatalogueEditor catalogueProduct={editor.product} availableCategories={availableCategories} onClose={() => setEditor(undefined)} onSaved={(message) => {
          window.history.replaceState(null, '', '/admin/products');
          setEditor(undefined);
          flash(message);
          void load();
        }} />}
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </AdminShell>;

  return <AdminShell title="Products" eyebrow="Catalogue">
    <div className="adm-page-head"><div><h1>Product catalogue</h1><p>Manage details, photos, choices, prices and inventory.</p></div><button className="adm-button" onClick={openCreate}><Icon name="plus" /><span>Add product</span></button></div>
    <div className="adm-toolbar"><div className="adm-tabs"><button className={type === 'MOBILE' ? 'active' : ''} onClick={() => { setType('MOBILE'); setPage(1); }}>Mobile</button><button className={type === 'MERCHANDISE' ? 'active' : ''} onClick={() => { setType('MERCHANDISE'); setPage(1); }}>Merchandise</button></div><label className="adm-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, SKU, catalogue UUID or provider ID…" /></label><select aria-label="Stock filter" value={stockFilter} onChange={(event) => setStockFilter(event.target.value as 'all' | 'out')}><option value="all">All stock</option><option value="out">Out of stock</option></select></div>
    <section className="adm-panel">{error ? <ErrorState message={error} retry={load} /> : !data || !catalogue ? <Skeleton /> : !rows.length ? <Empty title="No products found" message="Try another search or add a new product." action={<button className="adm-button" onClick={openCreate}>Add product</button>} /> : <><div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Product</th><th>Price</th><th>Choices</th><th>Inventory</th><th>Status</th><th></th></tr></thead><tbody>{rows.map((row) => {
      const model = row.kind === 'catalogue' ? row.catalogue.model : null;
      const product = row.product;
      const title = model?.details.title || sanitizeProviderTitle(product?.title || '') || 'Untitled product';
      const slug = row.kind === 'catalogue' ? row.catalogue.slug : product!.slug;
      const price = model?.details.price ?? product!.price;
      const variants = model?.combinations.length ?? product?.productVariants?.length ?? 0;
      const choices = model ? catalogueChoiceSummary(model) : { primary: 'Legacy', secondary: `${variants} ${variants === 1 ? 'combination' : 'combinations'}`, incomplete: false };
      const stock = productInventory(row.kind === 'catalogue' ? row.catalogue : null, product);
      const key = row.kind === 'catalogue' ? row.catalogue.catalogueId : `legacy-${product!.id}`;
      const localDraft = row.kind === 'catalogue' && row.catalogue.status === 'draft' && row.catalogue.currentBundleProductId === null;
      const providerOperationUnresolved = localDraft && unresolvedPublication(cataloguePublications[row.catalogue.catalogueId]);
      const simManagedCatalogue = false;
      const genericLifecycleAllowed = genericCatalogueLifecycleAllowed(false);
      const publicationAction = row.kind === 'catalogue' ? publicationActionPresentation({
        state: row.catalogue.publicationChangeState,
        localDraft,
        simManaged: simManagedCatalogue,
        unknownReason: row.catalogue.publicationChangeReason,
      }) : { visible: false } as const;
      const hazardousActionReason = row.kind === 'catalogue'
        ? publicationAction.visible && publicationAction.disabledReason
          ? publicationAction.disabledReason
          : catalogueHazardReason(row.catalogue.model, providerOperationUnresolved)
        : null;
      const hazardousActionReasonId = row.kind === 'catalogue' ? `catalogue-action-reason-${row.catalogue.catalogueId}` : undefined;
      const canPublish = row.kind === 'catalogue' && canPublishCatalogueProduct(row.catalogue, catalogueMedia[row.catalogue.catalogueId]);
      const publishAvailable = publicationAction.visible;
      const publishLabel = publicationAction.visible ? publicationAction.label : 'Publish';
      const hazardousActionDisabled = hazardousActionReason !== null;
      return <tr key={key}>
        <td><div className="adm-product-cell">{product?.images?.[0] ? <img className="adm-thumb" src={product.images[0].url} alt="" /> : <span className="adm-thumb" />}<div><strong>{title}</strong><small>{slug}{row.kind === 'legacy' ? ' · Legacy' : ''}</small></div></div></td>
        <td data-label="Price">{money(price)}</td>
        <td data-label="Choices"><span className={`adm-choice-summary${choices.incomplete ? ' is-incomplete' : ''}`}><strong>{choices.primary}</strong><small>{choices.secondary}</small></span></td>
        <td data-label="Inventory">{stock}</td>
        <td data-label="Status"><StatusBadge status={row.kind === 'catalogue' && row.catalogue.status === 'draft' ? 'DRAFT' : stock === 0 ? 'OUT' : 'ACTIVE'} /></td>
        <td><div className="adm-actions">{row.kind === 'catalogue' ? <>
          <button className="adm-icon-btn" title="Edit product" aria-label={`Edit ${title}`} onClick={() => setEditor({ kind: 'existing', product: row.catalogue })}><Icon name="edit" /></button>
          {genericLifecycleAllowed && publishAvailable && <button
            className="adm-button secondary"
            title={hazardousActionReason || `${publishLabel} for ${title} to OSS`}
            aria-label={`${publishLabel} for ${title} to OSS`}
            aria-describedby={hazardousActionReason ? hazardousActionReasonId : undefined}
            disabled={!canPublish || hazardousActionDisabled || publishingCatalogueId !== null || archivingCatalogueId !== null}
            onClick={() => void publish(row.catalogue)}
          >{publishingCatalogueId === row.catalogue.catalogueId ? 'Publishing…' : publishLabel}</button>}
          {genericLifecycleAllowed && row.catalogue.status === 'published' && row.catalogue.currentBundleProductId !== null && <button className="adm-button secondary" aria-label={`Unpublish ${title}`} disabled={unpublishingCatalogueId !== null} onClick={() => void unpublish(row.catalogue)}>{unpublishingCatalogueId === row.catalogue.catalogueId ? 'Unpublishing…' : 'Unpublish'}</button>}
          {genericLifecycleAllowed && localDraft && <button
            className="adm-button secondary"
            title={hazardousActionReason || `Archive ${title}`}
            aria-label={`Archive ${title}`}
            aria-describedby={hazardousActionReason ? hazardousActionReasonId : undefined}
            disabled={hazardousActionDisabled || archivingCatalogueId !== null || publishingCatalogueId !== null}
            onClick={() => void archive(row.catalogue)}
          >{archivingCatalogueId === row.catalogue.catalogueId ? 'Archiving…' : 'Archive'}</button>}
          {genericLifecycleAllowed && hazardousActionReason && publishAvailable && <small id={hazardousActionReasonId} className="adm-action-disabled-reason">{hazardousActionReason}</small>}
        </> : <button className="adm-icon-btn" title="View legacy product" onClick={() => setLegacyViewer(product!)}><Icon name="arrow" /></button>}</div></td>
      </tr>;
    })}</tbody></table></div><div className="adm-pagination"><span>{(data.meta?.total || data.data.length) + (page === 1 && type === 'MERCHANDISE' ? catalogue.filter((product) => product.currentBundleProductId === null).length : 0)} products · page {page}</span><div><button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>←</button><button disabled={page >= (data.meta?.totalPages || 1)} onClick={() => setPage((current) => current + 1)}>→</button></div></div></>}</section>
    {legacyViewer && <LegacyProductView product={legacyViewer} onClose={() => setLegacyViewer(null)} />}
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
  </AdminShell>;
}

export default function ProductsPage() {
  return <Suspense fallback={<div className="adm-app"><Skeleton rows={8} /></div>}><ProductsContent /></Suspense>;
}
