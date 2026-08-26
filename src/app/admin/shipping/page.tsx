'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import AdminShell from '@/components/admin/AdminShell';
import { Icon } from '@/components/admin/Icons';
import { adminFetch } from '@/lib/admin/client';
import { Paged, Product } from '@/lib/admin/types';
import { COURIER_GROUPS, type CourierGroup, type ShippingSettings } from '@/lib/shipping';

const GROUP_LABELS: Record<CourierGroup, string> = {
  shirt: 'T-shirt',
  bulky: 'Water bottle, tumbler or bunting',
  small: 'Small items',
  flyers: 'Flyers',
  sim: 'SIM card',
};
const SYSTEM_PRODUCT_SLUGS = new Set(['flat-rate-delivery-fee', 'pen-2-0']);

function productGroup(settings: ShippingSettings | null, product: Product) {
  return settings?.productGroups[String(product.id)] || settings?.productGroups[product.slug.trim().toLowerCase()] || '';
}
function isSystemProduct(product: Product) { return SYSTEM_PRODUCT_SLUGS.has(product.slug.trim().toLowerCase()); }
function validateSettings(settings: ShippingSettings) {
  const errors: Record<string, string> = {};
  for (const group of COURIER_GROUPS) {
    const current = settings.groups[group];
    if (!current.label.trim()) errors[`${group}-label`] = 'Category name is required.';
    current.tiers.forEach((tier, index) => {
      if (!Number.isInteger(tier.minimum) || tier.minimum < 1) errors[`${group}-${index}-minimum`] = 'Enter a whole-number minimum quantity of at least 1.';
      if (index && tier.minimum <= current.tiers[index - 1].minimum) errors[`${group}-${index}-minimum`] = 'The minimum quantity must be greater than the previous tier.';
      if (!Number.isFinite(tier.peninsular) || tier.peninsular < 0) errors[`${group}-${index}-peninsular`] = 'The rate must be 0 or more.';
      if (!Number.isFinite(tier.eastMalaysia) || tier.eastMalaysia < 0) errors[`${group}-${index}-east`] = 'The rate must be 0 or more.';
    });
  }
  return errors;
}
function historyNavigationDecision(currentPosition: number, nextPosition: number | undefined, confirmed: boolean) {
  if (confirmed) return { type: 'allow' as const };
  if (typeof nextPosition === 'number' && Number.isInteger(nextPosition)) return { type: 'go' as const, delta: currentPosition - nextPosition };
  return { type: 'restore' as const };
}
function mergeChangedSettings(baseline: ShippingSettings, current: ShippingSettings, fresh: ShippingSettings) {
  const merged = structuredClone(fresh);
  const mergeScalar = <T,>(previous: T, draft: T, latest: T, conflict: string) => {
    const localChanged = previous !== draft;
    const freshChanged = previous !== latest;
    if (localChanged && freshChanged && draft !== latest) throw new Error(conflict);
    return localChanged ? draft : latest;
  };
  const productKeys = new Set([...Object.keys(baseline.productGroups), ...Object.keys(current.productGroups), ...Object.keys(fresh.productGroups)]);
  productKeys.forEach((key) => {
    const group = mergeScalar(
      baseline.productGroups[key],
      current.productGroups[key],
      fresh.productGroups[key],
      `The shipping category for Product #${key} changed elsewhere. Reload the page and try again.`,
    );
    if (group) merged.productGroups[key] = group;
    else delete merged.productGroups[key];
  });
  const previousPriority = JSON.stringify(baseline.priority);
  const draftPriority = JSON.stringify(current.priority);
  const freshPriority = JSON.stringify(fresh.priority);
  merged.priority = JSON.parse(mergeScalar(
    previousPriority,
    draftPriority,
    freshPriority,
    'The mixed-order priority changed elsewhere. Reload the page and try again.',
  ));
  COURIER_GROUPS.forEach((group) => {
    const previousGroup = baseline.groups[group];
    const draftGroup = current.groups[group];
    const freshGroup = fresh.groups[group];
    const tierIdentity = (tiers: typeof previousGroup.tiers) => tiers.map((tier) => tier.minimum);
    const localStructureChanged = JSON.stringify(tierIdentity(previousGroup.tiers)) !== JSON.stringify(tierIdentity(draftGroup.tiers));
    const freshStructureChanged = JSON.stringify(tierIdentity(previousGroup.tiers)) !== JSON.stringify(tierIdentity(freshGroup.tiers));
    const localGroupChanged = previousGroup.label !== draftGroup.label || JSON.stringify(previousGroup.tiers) !== JSON.stringify(draftGroup.tiers);
    const freshGroupChanged = previousGroup.label !== freshGroup.label || JSON.stringify(previousGroup.tiers) !== JSON.stringify(freshGroup.tiers);
    if ((localStructureChanged && freshGroupChanged) || (freshStructureChanged && localGroupChanged)) {
      throw new Error(`The rate-tier structure for ${GROUP_LABELS[group]} changed elsewhere. Reload the page and try again.`);
    }
    merged.groups[group].label = mergeScalar(
      previousGroup.label,
      draftGroup.label,
      freshGroup.label,
      `The settings for ${GROUP_LABELS[group]} changed elsewhere. Reload the page and try again.`,
    );
    if (localStructureChanged) {
      merged.groups[group].tiers = structuredClone(draftGroup.tiers);
      return;
    }
    if (freshStructureChanged) return;
    draftGroup.tiers.forEach((tier, index) => {
      (['minimum', 'peninsular', 'eastMalaysia'] as const).forEach((field) => {
        merged.groups[group].tiers[index][field] = mergeScalar(
          previousGroup.tiers[index][field],
          tier[field],
          freshGroup.tiers[index][field],
          `The settings for ${GROUP_LABELS[group]} changed elsewhere. Reload the page and try again.`,
        );
      });
    });
  });
  return merged;
}
function changeSummary(settings: ShippingSettings, saved: ShippingSettings) {
  const summary = { products: 0, rates: 0, priority: settings.priority.join() !== saved.priority.join() };
  const productKeys = new Set([...Object.keys(settings.productGroups), ...Object.keys(saved.productGroups)]);
  productKeys.forEach((key) => { if (settings.productGroups[key] !== saved.productGroups[key]) summary.products += 1; });
  COURIER_GROUPS.forEach((group) => {
    if (settings.groups[group].label !== saved.groups[group].label) summary.rates += 1;
    const current = settings.groups[group].tiers;
    const previous = saved.groups[group].tiers;
    const length = Math.max(current.length, previous.length);
    for (let index = 0; index < length; index += 1) {
      if (JSON.stringify(current[index]) !== JSON.stringify(previous[index])) summary.rates += 1;
    }
  });
  return summary;
}

export default function ShippingSettingsPage() {
  const [settings, setSettings] = useState<ShippingSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<ShippingSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const historyPositionRef = useRef(0);
  const guardedHistoryRef = useRef<{ state: unknown; url: string } | null>(null);

  const loadProducts = async () => {
    const loadedProducts = await adminFetch<Paged<Product>>('products?type=MERCHANDISE&page=1&limit=100');
    const remaining = await Promise.all(Array.from({ length: Math.max(0, (loadedProducts.meta?.totalPages || 1) - 1) }, (_, index) =>
      adminFetch<Paged<Product>>(`products?type=MERCHANDISE&page=${index + 2}&limit=100`)));
    return [loadedProducts, ...remaining].flatMap((page) => page.data);
  };

  const load = async () => {
    setError('');
    try {
      const [loadedSettings, loadedProducts] = await Promise.all([
        adminFetch<ShippingSettings>('shipping-settings'),
        loadProducts(),
      ]);
      setSettings(loadedSettings);
      setSavedSettings(structuredClone(loadedSettings));
      setProducts(loadedProducts.filter((product) => !product.deletedAt));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Shipping settings could not be loaded.');
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const state = window.history.state || {};
    const navigationIndex = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
    const position = Number.isInteger(state.shippingHistoryPosition) ? state.shippingHistoryPosition : Number.isInteger(state.idx) ? state.idx : navigationIndex ?? window.history.length - 1;
    const guardedState = { ...state, shippingHistoryPosition: position };
    historyPositionRef.current = position;
    guardedHistoryRef.current = { state: guardedState, url: window.location.href };
    window.history.replaceState(guardedState, '', window.location.href);
  }, []);

  const update = (change: (next: ShippingSettings) => void) => setSettings((current) => {
    if (!current) return current;
    const next = structuredClone(current);
    change(next);
    return next;
  });
  const summary = settings && savedSettings ? changeSummary(settings, savedSettings) : { products: 0, rates: 0, priority: false };
  const changes = summary.products + summary.rates + Number(summary.priority);
  const dirty = changes > 0;
  useEffect(() => {
    let restoringPosition: number | null = null;
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const warnNavigation = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || link.href === window.location.href) return;
      if (!window.confirm('You have unsaved changes. Leave this page?')) { event.preventDefault(); event.stopPropagation(); }
    };
    const warnHistory = (event: PopStateEvent) => {
      if (!dirty) return;
      const navigationIndex = (window as Window & { navigation?: { currentEntry?: { index: number } } }).navigation?.currentEntry?.index;
      const nextPosition = Number.isInteger(event.state?.shippingHistoryPosition) ? event.state.shippingHistoryPosition : Number.isInteger(event.state?.idx) ? event.state.idx : navigationIndex;
      if (restoringPosition !== null) { historyPositionRef.current = restoringPosition; restoringPosition = null; return; }
      const currentPosition = historyPositionRef.current;
      const decision = historyNavigationDecision(currentPosition, nextPosition, window.confirm('You have unsaved changes. Leave this page?'));
      if (decision.type === 'allow') { if (typeof nextPosition === 'number') historyPositionRef.current = nextPosition; return; }
      if (decision.type === 'go') {
        restoringPosition = currentPosition;
        window.history.go(decision.delta);
        return;
      }
      const guarded = guardedHistoryRef.current;
      if (guarded) window.history.pushState(guarded.state, '', guarded.url);
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('popstate', warnHistory);
    document.addEventListener('click', warnNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('popstate', warnHistory);
      document.removeEventListener('click', warnNavigation, true);
    };
  }, [dirty]);

  const matchingProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => !term || `${product.title} ${product.id} ${product.slug}`.toLowerCase().includes(term));
  }, [products, query]);
  const needsAction = useMemo(() => matchingProducts.filter((product) => !isSystemProduct(product) && !productGroup(settings, product)), [matchingProducts, settings]);
  const completed = useMemo(() => matchingProducts.filter((product) => isSystemProduct(product) || productGroup(settings, product)), [matchingProducts, settings]);
  const validation = settings ? validateSettings(settings) : {};
  const priorityChanged = summary.priority;

  function setProductGroup(product: Product, group: CourierGroup | '') {
    update((next) => {
      const id = String(product.id);
      const slug = product.slug.trim().toLowerCase();
      if (group) { next.productGroups[id] = group; delete next.productGroups[slug]; }
      else { delete next.productGroups[id]; delete next.productGroups[slug]; }
    });
    setNotice('');
  }
  function cancel() {
    if (!savedSettings) return;
    setSettings(structuredClone(savedSettings));
    setError('');
    setNotice('Changes discarded.');
  }
  async function save() {
    if (!settings || !savedSettings || !dirty) return;
    const errors = validateSettings(settings);
    if (Object.keys(errors).length) { setError('Correct the highlighted fields before saving.'); return; }
    const warning = priorityChanged ? '\n\nWarning: the mixed-order priority changed and may alter shipping charges.' : '';
    if (!window.confirm(`Save ${changes} shipping-setting changes?\n\nReview summary:\nProduct assignments: ${summary.products} changes\nShipping rates and labels: ${summary.rates} changes\nMixed-order priority: ${summary.priority ? 'Changed' : 'Unchanged'}${warning}`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const fresh = await adminFetch<ShippingSettings>('shipping-settings');
      const merged = mergeChangedSettings(savedSettings, settings, fresh);
      const saved = await adminFetch<ShippingSettings>('shipping-settings', { method: 'PUT', body: JSON.stringify(merged) });
      setSettings(saved);
      setSavedSettings(structuredClone(saved));
      setNotice('Shipping settings saved successfully.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Shipping settings could not be saved.');
    } finally { setSaving(false); }
  }

  if (!settings) return <AdminShell title="Shipping" eyebrow="Operations"><section className="adm-panel adm-empty"><h3>{error || 'Loading shipping settings…'}</h3>{error && <button className="adm-button" onClick={load}>Try again</button>}</section></AdminShell>;

  const productRows = (rows: Product[]) => <div className="ship-product-list">{rows.map((product) => {
    const system = isSystemProduct(product);
    const group = productGroup(settings, product);
    return <article className="ship-product-row" key={product.id}>
      <div className="ship-product-copy"><strong>{product.title}</strong><small>Product #{product.id}</small></div>
      <label><span>Shipping category</span><select value={system ? 'none' : group} disabled={saving || system} onChange={(event) => setProductGroup(product, event.target.value as CourierGroup | '')}>
        <option value="">Select a category…</option>
        {COURIER_GROUPS.map((item) => <option value={item} key={item}>{GROUP_LABELS[item]}</option>)}
        {system && <option value="none">No shipping required</option>}
      </select></label>
    </article>;
  })}{!rows.length && <div className="adm-empty ship-empty"><p>No products in this section.</p></div>}</div>;

  return <AdminShell title="Shipping" eyebrow="Operations">
    <fieldset className="ship-form" disabled={saving}>
    <div className="adm-page-head"><div><h1>Shipping settings</h1><p>Assign products to shipping categories and manage customer shipping rates.</p></div></div>
    {error && <div className="adm-alert is-error" role="alert">{error}</div>}{notice && <div className="adm-alert is-success" role="status">{notice}</div>}

    <section className="adm-panel ship-products">
      <header className="adm-panel-head"><div><h2>Products and categories</h2><p>Products without an explicit shipping category appear first.</p></div></header>
      <label className="adm-search ship-search"><Icon name="search"/><span className="adm-sr-only">Search products or IDs</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or IDs…"/></label>
      <div className="ship-list-heading"><h3>Needs assignment ({needsAction.length})</h3></div>
      {productRows(needsAction)}
      <details className="ship-disclosure ship-completed">
        <summary>Assigned products ({completed.length})</summary>
        {productRows(completed)}
      </details>
    </section>

    <section className="adm-panel ship-rates">
      <header className="adm-panel-head"><div><h2>Shipping rates</h2><p>Example tiers: 1–5 units and 21+ units. RM0 is displayed as Free.</p></div></header>
      <div className="ship-rate-list">{COURIER_GROUPS.map((group, groupIndex) => <details name="shipping-rates" className="ship-disclosure ship-rate-group" key={group} open={groupIndex === 0 ? true : undefined}>
        <summary><span>{GROUP_LABELS[group]}</span><small>{settings.groups[group].tiers.length} rate tiers</small></summary>
        <div className="ship-rate-body">
          <label className="adm-field">Category name<input id={`${group}-label`} value={settings.groups[group].label} aria-invalid={Boolean(validation[`${group}-label`])} aria-describedby={validation[`${group}-label`] ? `${group}-label-error` : undefined} onChange={(event) => update((next) => { next.groups[group].label = event.target.value; })}/>{validation[`${group}-label`] && <span id={`${group}-label-error`} className="ship-field-error" role="alert">{validation[`${group}-label`]}</span>}</label>
          <div className="ship-tiers">{settings.groups[group].tiers.map((tier, index, tiers) => {
            const nextMinimum = tiers[index + 1]?.minimum;
            const range = nextMinimum ? `${tier.minimum}–${nextMinimum - 1} units` : `${tier.minimum}+ units`;
            const minimumKey = `${group}-${index}-minimum`;
            const peninsularKey = `${group}-${index}-peninsular`;
            const eastKey = `${group}-${index}-east`;
            return <div className="ship-tier" key={index}>
              <strong className="ship-range">{range}</strong>
              <label><span>Minimum quantity</span><input id={minimumKey} type="number" min="1" step="1" readOnly={index === 0} value={tier.minimum} aria-invalid={Boolean(validation[minimumKey])} aria-describedby={validation[minimumKey] ? `${minimumKey}-error` : undefined} onChange={(event) => update((next) => { next.groups[group].tiers[index].minimum = Number(event.target.value); })}/>{validation[minimumKey] && <small id={`${minimumKey}-error`} className="ship-field-error" role="alert">{validation[minimumKey]}</small>}</label>
              <label><span>Peninsular Malaysia</span><span className="ship-money"><b>RM</b><input id={peninsularKey} type="number" min="0" step="0.01" value={tier.peninsular} aria-invalid={Boolean(validation[peninsularKey])} aria-describedby={validation[peninsularKey] ? `${peninsularKey}-error` : undefined} onChange={(event) => update((next) => { next.groups[group].tiers[index].peninsular = Number(event.target.value); })}/></span>{tier.peninsular === 0 && <small>Free</small>}{validation[peninsularKey] && <small id={`${peninsularKey}-error`} className="ship-field-error" role="alert">{validation[peninsularKey]}</small>}</label>
              <label><span>Sabah, Sarawak and Labuan</span><span className="ship-money"><b>RM</b><input id={eastKey} type="number" min="0" step="0.01" value={tier.eastMalaysia} aria-invalid={Boolean(validation[eastKey])} aria-describedby={validation[eastKey] ? `${eastKey}-error` : undefined} onChange={(event) => update((next) => { next.groups[group].tiers[index].eastMalaysia = Number(event.target.value); })}/></span>{tier.eastMalaysia === 0 && <small>Free</small>}{validation[eastKey] && <small id={`${eastKey}-error`} className="ship-field-error" role="alert">{validation[eastKey]}</small>}</label>
              <button type="button" className="adm-icon-btn" disabled={index === 0} aria-label={`Delete tier ${range}`} onClick={() => update((next) => { next.groups[group].tiers.splice(index, 1); })}><Icon name="trash"/></button>
            </div>;
          })}</div>
          <button type="button" className="adm-text-button" onClick={() => update((next) => { const tiers = next.groups[group].tiers; tiers.push({ minimum: (tiers.at(-1)?.minimum || 0) + 1, peninsular: 0, eastMalaysia: 0 }); })}><Icon name="plus"/>Add tier</button>
        </div>
      </details>)}</div>
    </section>

    <details className="adm-panel ship-disclosure ship-priority-details">
      <summary>Mixed-order rules (Advanced)</summary>
      <div className="ship-priority-body"><p>The first matching category determines the charge for the entire mixed order.</p>{priorityChanged && <div className="adm-alert is-error" role="alert">Priority changed. Review the effect before saving.</div>}
        <div className="ship-priority">{settings.priority.map((group, index) => <div key={group}><span>{index + 1}</span><strong>{GROUP_LABELS[group]}</strong><button type="button" disabled={!index} aria-label={`Move ${GROUP_LABELS[group]} up`} onClick={() => update((next) => { [next.priority[index - 1], next.priority[index]] = [next.priority[index], next.priority[index - 1]]; })}>↑</button><button type="button" disabled={index === settings.priority.length - 1} aria-label={`Move ${GROUP_LABELS[group]} down`} onClick={() => update((next) => { [next.priority[index + 1], next.priority[index]] = [next.priority[index], next.priority[index + 1]]; })}>↓</button></div>)}</div>
      </div>
    </details>

    {dirty && <div className="ship-dirty-bar" role="status"><strong>{changes} unsaved changes</strong><div><button type="button" className="adm-button secondary" disabled={saving} onClick={cancel}>Cancel</button><button type="button" className="adm-button" disabled={saving || Object.keys(validation).length > 0} onClick={save}><Icon name="save"/>{saving ? 'Saving…' : 'Review and save'}</button></div></div>}
    </fieldset>
  </AdminShell>;
}
