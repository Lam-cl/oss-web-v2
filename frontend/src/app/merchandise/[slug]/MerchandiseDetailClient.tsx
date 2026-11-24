'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getMerchandiseGalleryIndexForOption, getMerchandiseOptionIndexForImage, getMerchandiseVariantId, getMerchandiseVariantPurchaseLimit, mergeBundleMerchandiseProducts, merchandiseVariantKey, type BundleMerchandiseProduct, type MerchandiseProduct } from '@/data/merchandise';
import { resolveMerchandiseDetailProducts } from '@/lib/merchandiseDetail';
import { minimumOrderError } from '@/lib/minimumOrderQuantity';
import { formatRM } from '@/lib/utils';
import { useCartStore } from '@/store/cartStore';

type MerchandiseDetailClientProps = {
  slug: string;
  /** Product resolved on the server from the cached catalogue (no live stock yet). */
  initialProduct: MerchandiseProduct;
  /** Raw published catalogue record for this slug, re-adapted here once live stock arrives. */
  catalogueRecord: Record<string, unknown> | null;
};

export default function MerchandiseDetailClient({ slug, initialProduct, catalogueRecord }: MerchandiseDetailClientProps) {
  const router = useRouter();
  // Live Bundle stock/pre-order data; null until `/bundle/merchandise` answers. The catalogue
  // itself comes from the server render and is not refetched here.
  const [liveProducts, setLiveProducts] = useState<MerchandiseProduct[] | null>(null);
  const stockReady = liveProducts !== null;
  const resolved = useMemo(
    () => liveProducts ? resolveMerchandiseDetailProducts(slug, catalogueRecord, liveProducts) : null,
    [slug, catalogueRecord, liveProducts],
  );
  const product = resolved?.product || initialProduct;
  const addItem = useCartStore((state) => state.addItem);
  const reconcileMerchandiseCatalog = useCartStore((state) => state.reconcileMerchandiseCatalog);
  const [optionIndex, setOptionIndex] = useState(0);
  const variantChoiceRequired = Boolean(product && /^variant$/i.test(product.optionLabel || '') && product.options.length > 1);
  const [optionExplicitlySelected, setOptionExplicitlySelected] = useState(!variantChoiceRequired);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(initialProduct.minimumOrderQuantity);
  const [activeImage, setActiveImage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/bundle/merchandise', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.data)) throw new Error('Unable to load merchandise');
        const nextProducts = mergeBundleMerchandiseProducts(result.data as BundleMerchandiseProduct[]);
        if (controller.signal.aborted) return;
        setLiveProducts(nextProducts);
        reconcileMerchandiseCatalog(resolveMerchandiseDetailProducts(slug, catalogueRecord, nextProducts).products);
      })
      .catch((loadError) => {
        // Same as before: without live stock the product shows with no purchasable stock.
        if (!controller.signal.aborted && (loadError as Error).name !== 'AbortError') setLiveProducts([]);
      });
    return () => controller.abort();
  }, [slug, catalogueRecord, reconcileMerchandiseCatalog]);

  useEffect(() => {
    if (!product) return;
    setOptionIndex(0);
    setOptionExplicitlySelected(!(/^variant$/i.test(product.optionLabel || '') && product.options.length > 1));
    setSelectedSize('');
    setQuantity(product.minimumOrderQuantity);
    setActiveImage('');
    setError('');
  }, [product?.id]);

  // Live data can change the minimum order quantity after the server render: keep the quantity
  // valid, and follow the new minimum if the shopper was still on the old one.
  const previousMinimum = useRef(product.minimumOrderQuantity);
  useEffect(() => {
    const previous = previousMinimum.current;
    const minimum = product.minimumOrderQuantity;
    previousMinimum.current = minimum;
    if (previous === minimum) return;
    setQuantity((value) => (value < minimum || value === previous ? minimum : value));
  }, [product.minimumOrderQuantity]);

  const selectedOption = product.options[optionIndex] || product.options[0];
  const availableSizes = selectedOption.sizes || product.sizes;
  const gallery = (product.gallery?.length
    ? product.gallery
    : product.options.map((option) => option.image)).filter(Boolean);
  const selectedImage = activeImage || gallery[0] || selectedOption.image;
  const bundleVariantId = getMerchandiseVariantId(product, selectedOption.name, selectedSize || undefined);
  const variantPrice = product.variantPrices?.[merchandiseVariantKey(selectedOption.name, selectedSize || undefined)] ?? product.price;
  const availableQuantity = getMerchandiseVariantPurchaseLimit(product, bundleVariantId);

  const handleOptionChange = (index: number) => {
    setOptionIndex(index);
    setOptionExplicitlySelected(true);
    setSelectedSize('');
    const galleryIndex = getMerchandiseGalleryIndexForOption(product, index);
    setActiveImage(galleryIndex >= 0 ? gallery[galleryIndex] : product.options[index]?.image || '');
    setError('');
  };

  const handleImageChange = (image: string) => {
    const nextOption = getMerchandiseOptionIndexForImage(product, image);
    if (nextOption >= 0 && nextOption !== optionIndex) {
      setOptionIndex(nextOption);
      setSelectedSize('');
      setError('');
    }
    setActiveImage(image);
  };

  const handleAddToCart = () => {
    if (!stockReady) {
      setError('Checking live stock. Please try again in a moment.');
      return;
    }
    if (product.soldOut) {
      setError('This item is currently unavailable.');
      return;
    }
    if (!optionExplicitlySelected) {
      setError('Please select a variant.');
      return;
    }
    if (availableSizes && !selectedSize) {
      setError('Please select a size.');
      return;
    }
    if (!product.apiProductId || !bundleVariantId) {
      setError('This option is not available for checkout yet. Please refresh and try again.');
      return;
    }
    if (quantity < product.minimumOrderQuantity) {
      setError(minimumOrderError(product.minimumOrderQuantity));
      return;
    }
    if (quantity > availableQuantity) {
      setError(availableQuantity > 0 ? 'The selected quantity exceeds the current stock limit.' : 'This variation is out of stock.');
      return;
    }

    setError('');
    addItem({
      id: `merch:${product.id}:${selectedOption.name}:${selectedSize || 'standard'}`,
      type: 'merchandise',
      productId: product.id,
      bundleProductId: product.apiProductId,
      bundleVariantId,
      slug: product.slug,
      name: product.name,
      description: product.unitLabel || product.description,
      variant: selectedOption.name,
      size: selectedSize || undefined,
      image: selectedOption.image,
      price: variantPrice,
      quantity,
      minimumOrderQuantity: product.minimumOrderQuantity,
      availableQuantity: Number.isFinite(availableQuantity) ? availableQuantity : undefined,
      isPreOrder: product.isPreOrder === true,
    });
    router.push('/cart');
  };

  return (
    <main className="container merchandise-detail">
      <div className="merch-detail-breadcrumb">
        <Link href="/">Shop</Link><span>/</span><span>Merchandise</span><span>/</span><strong>{product.name}</strong>
      </div>

      <div className="merch-detail-grid">
        <section className="merch-detail-media" aria-label={`${product.name} images`}>
          <div className="merch-detail-main-image">
            <Image src={selectedImage} alt={`${product.name} ${selectedOption.name}`} fill priority unoptimized sizes="(max-width: 900px) 100vw, 55vw" />
          </div>
          {gallery.length > 1 && (
            <div className="merch-detail-thumbnails">
              {gallery.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  className={selectedImage === image ? 'active' : ''}
                  onClick={() => handleImageChange(image)}
                  aria-label={`View image ${index + 1}`}
                >
                  <Image src={image} alt="" fill unoptimized sizes="88px" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="merch-detail-panel">
          <h1>{product.name}</h1>
          {stockReady && product.isPreOrder && <div className="merch-stock-status">Unlimited (pre-order)</div>}
          {product.unitLabel && <div className="merch-unit-label">{product.unitLabel}</div>}

          {product.options.length > 1 && (
            <div className="merch-selector">
              <div className="merch-selector-title">
                <span>{product.optionLabel || 'Option'}</span>
                <strong>{selectedOption.name}</strong>
              </div>
              <div className={`merch-option-list${/^colou?r$/i.test(product.optionLabel || '') ? ' merch-colour-list' : ''}`}>
                {product.options.map((option, index) => (
                  <button
                    type="button"
                    key={option.name}
                    className={optionIndex === index ? 'active' : ''}
                    onClick={() => handleOptionChange(index)}
                    aria-label={`Select ${option.name}`}
                    title={option.name}
                  >
                    {/^colou?r$/i.test(product.optionLabel || '') ? (
                      <>
                        <span
                        className="merch-colour-swatch"
                        style={{ background: option.swatch || '#e2e8f0' }}
                        aria-hidden="true"
                      />
                      <span className="merch-colour-name">{option.name}</span>
                    </>
                    ) : option.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableSizes && (
            <div className="merch-selector">
              <div className="merch-selector-title"><span>Size</span><strong>{selectedSize || 'Select a size'}</strong></div>
              <div className="merch-size-list">
                {availableSizes.map((size) => (
                  <button
                    type="button"
                    key={size}
                    className={selectedSize === size ? 'active' : ''}
                    onClick={() => { setSelectedSize(size); setError(''); }}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="merch-detail-price">{formatRM(variantPrice)}</div>
          {stockReady && product.soldOut && <div className="merch-stock-status">Sold out</div>}
          {stockReady && product.soldOut ? (
            <div className="merch-purchase-row merch-purchase-row--unavailable">
              <button
                type="button"
                className="btn merch-add-button merch-unavailable-button"
                disabled
              >
                Currently unavailable
              </button>
            </div>
          ) : (
            <div className="merch-purchase-row">
              <div className="merch-quantity" aria-label="Quantity">
                <button type="button" disabled={!stockReady} onClick={() => setQuantity((value) => Math.max(product.minimumOrderQuantity, value - 1))}>−</button>
                <span>{quantity}</span>
                <button type="button" disabled={!stockReady} onClick={() => setQuantity((value) => Math.min(availableQuantity, value + 1))}>+</button>
              </div>
              <button type="button" className="btn btn-primary merch-add-button" disabled={!stockReady} onClick={handleAddToCart}>
                {stockReady ? <>Add to Cart · {formatRM(variantPrice * quantity)}</> : 'Checking stock…'}
              </button>
            </div>
          )}
          {error && <p className="merch-form-error" role="alert">{error}</p>}

          {product.features && (
            <div className="merch-features">
              <h2>Product details</h2>
              <ul>{product.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            </div>
          )}

          <div className="merch-shipping-note">
            <strong>Delivery or self-pickup</strong>
            <span>Flat RM10 merchandise delivery per order. Self-pickup is free.</span>
          </div>
        </section>
      </div>
    </main>
  );
}
