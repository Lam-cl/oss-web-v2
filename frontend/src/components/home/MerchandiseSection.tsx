'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import {
  getMerchandiseVariantId,
  getMerchandiseVariantInventory,
  merchandiseVariantKey,
  type MerchandiseProduct,
} from '@/data/merchandise';
import { useMerchandiseProducts } from '@/hooks/useMerchandiseProducts';
import { formatRM } from '@/lib/utils';
import { minimumOrderLabel } from '@/lib/minimumOrderQuantity';
import { useCartStore } from '@/store/cartStore';

type CategoryFilter = 'All' | string;

function isColourOption(label?: string) {
  return Boolean(label && /^colou?r$/i.test(label));
}

const SIZE_GUIDE = [
  ['XS', '46', '66'],
  ['S', '48', '68'],
  ['M', '50', '70'],
  ['L', '52', '72'],
  ['XL', '54', '74'],
  ['2XL', '56', '76'],
  ['3XL', '58', '78'],
  ['4XL', '60', '80'],
  ['5XL', '62', '82'],
];

function getOptionGallery(product: MerchandiseProduct, optionIndex: number) {
  const option = product.options[optionIndex];
  if (!option) return [];
  return Array.from(new Set([option.image, ...(option.gallery || product.gallery || [])]));
}

function getProductGallery(product: MerchandiseProduct) {
  return Array.from(new Set([
    ...product.options.flatMap((option) => [option.image, ...(option.gallery || [])]),
    ...(product.gallery || []),
  ]));
}

function preloadGallery(images: string[]) {
  if (typeof window === 'undefined') return;
  images.forEach((src) => {
    const image = new window.Image();
    image.decoding = 'async';
    image.src = src;
  });
}

export default function MerchandiseSection() {
  const {
    products: merchandiseProducts,
    loading: productsLoading,
    error: productsError,
    retry: retryProducts,
  } = useMerchandiseProducts();
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const [selectedProduct, setSelectedProduct] = useState<MerchandiseProduct | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [fullscreenImageIndex, setFullscreenImageIndex] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('All');
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [showFullscreenGallery, setShowFullscreenGallery] = useState(false);
  const [cartBumped, setCartBumped] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const productHistoryRef = useRef(false);
  const galleryHistoryRef = useRef(false);
  const sizeGuideHistoryRef = useRef(false);

  useEffect(() => {
    setPortalReady(true);
    document.body.classList.add('merchandise-active');
    const freshworks = (window as Window & {
      FreshworksWidget?: (...args: unknown[]) => void;
    }).FreshworksWidget;
    freshworks?.('hide');
    const handlePopState = () => {
      if (galleryHistoryRef.current) {
        galleryHistoryRef.current = false;
        setShowFullscreenGallery(false);
        return;
      }
      if (sizeGuideHistoryRef.current) {
        sizeGuideHistoryRef.current = false;
        setShowSizeGuide(false);
        return;
      }
      if (productHistoryRef.current) {
        productHistoryRef.current = false;
        setShowSizeGuide(false);
        setSelectedProduct(null);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      document.body.classList.remove('merchandise-active');
      freshworks?.('show');
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const merchandiseQuantities = useMemo(
    () => items.reduce<Record<string, number>>((totals, item) => {
      if (item.type === 'merchandise' && item.productId) {
        totals[item.productId] = (totals[item.productId] || 0) + item.quantity;
      }
      return totals;
    }, {}),
    [items],
  );
  const cartCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );
  const filteredProducts = useMemo(
    () => activeCategory === 'All'
      ? merchandiseProducts
      : merchandiseProducts.filter((product) => product.category === activeCategory),
    [activeCategory, merchandiseProducts],
  );
  const categoryFilters = useMemo<CategoryFilter[]>(
    () => ['All', ...Array.from(new Set(merchandiseProducts.map((product) => product.category)))],
    [merchandiseProducts],
  );

  useEffect(() => {
    if (activeCategory !== 'All' && !categoryFilters.includes(activeCategory)) {
      setActiveCategory('All');
    }
  }, [activeCategory, categoryFilters]);

  useEffect(() => {
    if (!selectedProduct) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (galleryHistoryRef.current) {
        closeFullscreenGallery();
      } else if (sizeGuideHistoryRef.current || showSizeGuide) {
        closeSizeGuide();
      } else {
        closeProduct();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedProduct, showSizeGuide]);

  const openProduct = (product: MerchandiseProduct, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    preloadGallery(getProductGallery(product));
    if (window.matchMedia('(max-width: 760px)').matches && !productHistoryRef.current) {
      window.history.pushState({ ...window.history.state, merchProductSheet: true }, '');
      productHistoryRef.current = true;
    }
    setSelectedProduct(product);
    setOptionIndex(0);
    setSelectedSize('');
    setQuantity(product.minimumOrderQuantity);
    setActiveImageIndex(0);
    setFullscreenImageIndex(0);
    setAutoplayEnabled(true);
    setShowSizeGuide(false);
    setShowFullscreenGallery(false);
    setError('');
  };

  const closeProduct = () => {
    if (galleryHistoryRef.current) {
      closeFullscreenGallery();
      return;
    }
    if (sizeGuideHistoryRef.current) {
      closeSizeGuide();
      return;
    }
    if (productHistoryRef.current) {
      window.history.back();
      return;
    }
    setShowSizeGuide(false);
    setSelectedProduct(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openFullscreenGallery = () => {
    const initialIndex = productGallery.indexOf(selectedImage);
    setFullscreenImageIndex(initialIndex >= 0 ? initialIndex : 0);
    if (!galleryHistoryRef.current) {
      window.history.pushState({ ...window.history.state, merchFullscreenGallery: true }, '');
      galleryHistoryRef.current = true;
    }
    setAutoplayEnabled(false);
    setShowFullscreenGallery(true);
  };

  const closeFullscreenGallery = () => {
    if (galleryHistoryRef.current) {
      window.history.back();
      return;
    }
    setShowFullscreenGallery(false);
  };

  const openSizeGuide = () => {
    if (window.matchMedia('(max-width: 760px)').matches && !sizeGuideHistoryRef.current) {
      window.history.pushState({ ...window.history.state, merchSizeGuide: true }, '');
      sizeGuideHistoryRef.current = true;
    }
    setShowSizeGuide(true);
  };

  const closeSizeGuide = () => {
    if (sizeGuideHistoryRef.current) {
      window.history.back();
      return;
    }
    setShowSizeGuide(false);
  };
  const selectedOption = selectedProduct?.options[optionIndex];
  const availableSizes = selectedOption?.sizes || selectedProduct?.sizes;
  const gallery = useMemo(
    () => selectedProduct ? getOptionGallery(selectedProduct, optionIndex) : [],
    [selectedProduct, optionIndex],
  );
  const productGallery = useMemo(
    () => selectedProduct ? getProductGallery(selectedProduct) : [],
    [selectedProduct],
  );
  const selectedImage = gallery[activeImageIndex] || selectedOption?.image || '';
  const fullscreenImage = productGallery[fullscreenImageIndex] || selectedImage;
  const selectedBundleVariantId = selectedProduct && selectedOption
    ? getMerchandiseVariantId(selectedProduct, selectedOption.name, selectedSize || undefined)
    : undefined;
  const selectedVariantPrice = selectedProduct && selectedOption
    ? selectedProduct.variantPrices?.[merchandiseVariantKey(selectedOption.name, selectedSize || undefined)] ?? selectedProduct.price
    : selectedProduct?.price || 0;
  const selectedVariantInventory = selectedProduct
    ? getMerchandiseVariantInventory(selectedProduct, selectedBundleVariantId)
    : 0;
  const selectedVariantInCart = selectedBundleVariantId
    ? items.reduce((total, item) => total + (
      item.type === 'merchandise' && item.bundleVariantId === selectedBundleVariantId ? item.quantity : 0
    ), 0)
    : 0;
  const remainingVariantInventory = Math.max(0, selectedVariantInventory - selectedVariantInCart);
  const insufficientVariantStock = Boolean(
    selectedProduct && selectedBundleVariantId
    && remainingVariantInventory < selectedProduct.minimumOrderQuantity,
  );
  const optionMappingUnavailable = Boolean(
    selectedProduct
    && (!availableSizes || selectedSize)
    && !selectedBundleVariantId,
  );

  useEffect(() => {
    if (!selectedProduct || !selectedBundleVariantId) return;
    setQuantity((value) => Math.min(
      remainingVariantInventory,
      Math.max(selectedProduct.minimumOrderQuantity, value),
    ));
  }, [selectedProduct, selectedBundleVariantId, remainingVariantInventory]);

  useEffect(() => {
    if (!selectedProduct || gallery.length < 2 || !autoplayEnabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => {
      setActiveImageIndex((index) => (index + 1) % gallery.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedProduct, gallery.length, autoplayEnabled]);

  useEffect(() => {
    if (!cartBumped) return;
    const timer = window.setTimeout(() => setCartBumped(false), 520);
    return () => window.clearTimeout(timer);
  }, [cartBumped]);

  const handleOptionChange = (index: number) => {
    if (!selectedProduct) return;
    preloadGallery(getOptionGallery(selectedProduct, index));
    setOptionIndex(index);
    setSelectedSize('');
    setActiveImageIndex(0);
    setAutoplayEnabled(true);
    setError('');
  };

  const showImage = (index: number) => {
    setActiveImageIndex(index);
    setAutoplayEnabled(false);
  };

  const stepImage = (direction: -1 | 1) => {
    if (gallery.length < 2) return;
    setActiveImageIndex((index) => (index + direction + gallery.length) % gallery.length);
    setAutoplayEnabled(false);
  };

  const stepFullscreenImage = (direction: -1 | 1) => {
    if (productGallery.length < 2) return;
    setFullscreenImageIndex(
      (index) => (index + direction + productGallery.length) % productGallery.length,
    );
  };

  const handleGalleryTouchStart = (clientX: number | undefined) => {
    touchStartX.current = clientX ?? null;
  };

  const handleGalleryTouchEnd = (clientX: number | undefined) => {
    if (touchStartX.current === null) return;
    const endX = clientX ?? touchStartX.current;
    const distance = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 40) return;
    stepImage(distance < 0 ? 1 : -1);
  };

  const handleFullscreenTouchEnd = (clientX: number | undefined) => {
    if (touchStartX.current === null) return;
    const endX = clientX ?? touchStartX.current;
    const distance = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 40) return;
    stepFullscreenImage(distance < 0 ? 1 : -1);
  };

  const handleAddToCart = () => {
    if (!selectedProduct || !selectedOption) return;
    if (selectedProduct.soldOut) {
      setError('This item is currently unavailable.');
      return;
    }
    if (availableSizes && !selectedSize) {
      setError('Please select a size.');
      return;
    }
    const bundleVariantId = getMerchandiseVariantId(
      selectedProduct,
      selectedOption.name,
      selectedSize || undefined,
    );
    if (!selectedProduct.apiProductId || !bundleVariantId) {
      setError('This option is not available for checkout yet. Please refresh and try again.');
      return;
    }
    const inventory = getMerchandiseVariantInventory(selectedProduct, bundleVariantId);
    const alreadyInCart = items.reduce((total, item) => total + (
      item.type === 'merchandise' && item.bundleVariantId === bundleVariantId ? item.quantity : 0
    ), 0);
    const remaining = Math.max(0, inventory - alreadyInCart);
    if (quantity < selectedProduct.minimumOrderQuantity || quantity > remaining) {
      setError(remaining > 0
        ? 'The selected quantity exceeds the current stock limit.'
        : 'This variation is currently unavailable.');
      return;
    }

    addItem({
      id: `merch:${selectedProduct.id}:${selectedOption.name}:${selectedSize || 'standard'}`,
      type: 'merchandise',
      productId: selectedProduct.id,
      bundleProductId: selectedProduct.apiProductId,
      bundleVariantId,
      slug: selectedProduct.slug,
      name: selectedProduct.name,
      description: selectedProduct.unitLabel || selectedProduct.description,
      variant: selectedProduct.options.length > 1 ? selectedOption.name : undefined,
      size: selectedSize || undefined,
      image: selectedOption.image,
      price: selectedVariantPrice,
      quantity,
      minimumOrderQuantity: selectedProduct.minimumOrderQuantity,
      availableQuantity: inventory,
    });
    setCartBumped(false);
    window.requestAnimationFrame(() => setCartBumped(true));
    setError('');
    closeProduct();
  };

  return (
    <div className="merch-catalog">
      <div className="merch-catalog-heading">
        <span className="merch-eyebrow">tone wow Collection</span>
        <h2>Merchandise</h2>
        <p>Shop official tone wow merchandise and SIM cards for individual or bulk orders.</p>
      </div>

      <div className="merch-category-filters" role="tablist" aria-label="Merchandise categories">
        {categoryFilters.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={activeCategory === category}
            className={activeCategory === category ? 'active' : ''}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {productsLoading && (
        <div className="merch-api-notice" role="status">Loading merchandise...</div>
      )}
      {productsError && (
        <div className="merch-api-notice is-error" role="alert">
          <span>{productsError}</span>
          <button type="button" onClick={retryProducts}>Retry</button>
        </div>
      )}

      <div className="merch-catalog-grid">
        {productsLoading && Array.from({ length: 8 }, (_, index) => (
          <div key={`merch-skeleton-${index}`} className="merch-product-skeleton" aria-hidden="true" />
        ))}
        {filteredProducts.map((product, productIndex) => {
          const inCart = merchandiseQuantities[product.id] || 0;
          const colourOptions = isColourOption(product.optionLabel)
            ? product.options.filter((option) => option.swatch).slice(0, 4)
            : [];
          const showsMinimumOrder = product.minimumOrderQuantity > 1 || product.category === 'SIM Cards';
          return (
            <button
              key={product.id}
              type="button"
              className={`merch-product-card${product.soldOut ? ' is-sold-out' : ''}`}
              onClick={(event) => openProduct(product, event.currentTarget)}
              onMouseEnter={() => preloadGallery(getOptionGallery(product, 0))}
              onFocus={() => preloadGallery(getOptionGallery(product, 0))}
              aria-label={`View ${product.name}`}
            >
              <span className="merch-product-image">
                {product.soldOut && (
                  <span className="merch-sold-out-label">
                    <Image
                      src="/images/merchandise/sold-out-stamp.png"
                      alt="Sold out"
                      width={577}
                      height={375}
                      unoptimized
                    />
                  </span>
                )}
                <Image
                  className="merch-card-main-image"
                  src={product.options[0].image}
                  alt={product.name}
                  fill
                  priority={productIndex < 4}
                  unoptimized
                  sizes="(max-width: 640px) 128px, (max-width: 1024px) 50vw, 25vw"
                />
                {inCart > 0 && (
                  <span className="merch-card-quantity" aria-label={`${inCart} in cart`}>
                    {inCart}
                  </span>
                )}
              </span>
              <span className="merch-product-body">
                <span className="merch-card-title">{product.name}</span>
                <span className="merch-price-stack">
                  <strong>{formatRM(product.price)}</strong>
                </span>
                <span
                  className={`merch-minimum-order merch-card-minimum-order${showsMinimumOrder ? '' : ' is-empty'}`}
                  aria-hidden={!showsMinimumOrder}
                >
                  {showsMinimumOrder ? minimumOrderLabel(product.minimumOrderQuantity) : '\u00A0'}
                </span>
                <span
                  className={`merch-card-swatches${colourOptions.length > 0 ? '' : ' is-empty'}`}
                  aria-label={colourOptions.length > 0 ? `${colourOptions.length} colours available` : undefined}
                  aria-hidden={colourOptions.length === 0}
                >
                  {colourOptions.map((option) => (
                    <span
                      key={option.name}
                      title={option.name}
                      style={{ background: option.swatch }}
                    />
                  ))}
                  {product.options.length > colourOptions.length && colourOptions.length > 0 && (
                    <small>+{product.options.length - colourOptions.length}</small>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {portalReady && !selectedProduct && createPortal(
        <Link
          href="/cart"
          className={`merch-floating-cart${cartBumped ? ' is-bumped' : ''}`}
          aria-label={`Open cart${cartCount > 0 ? `, ${cartCount} items` : ''}`}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="20" r="1" />
            <circle cx="18" cy="20" r="1" />
            <path d="M2 3h2l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 7H5" />
          </svg>
          {cartCount > 0 && (
            <span className="merch-floating-cart-count">
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </Link>,
        document.body,
      )}

      {selectedProduct && selectedOption && createPortal(
        <div
          className="merch-modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
              && !window.matchMedia('(max-width: 760px)').matches
            ) {
              closeProduct();
            }
          }}
        >
          <div
            className="merch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merch-modal-title"
          >
            <button
              type="button"
              className="merch-modal-close"
              onClick={closeProduct}
              aria-label="Close product details"
              autoFocus
            >
              ×
            </button>

            <section className="merch-mobile-summary">
              <div
                className="merch-mobile-gallery"
                onTouchStart={(event) => handleGalleryTouchStart(event.touches[0]?.clientX)}
                onTouchEnd={(event) => handleGalleryTouchEnd(event.changedTouches[0]?.clientX)}
              >
                <Image
                  key={`mobile-${selectedImage}`}
                  src={selectedImage}
                  alt={`${selectedProduct.name} ${selectedOption.name}`}
                  fill
                  priority
                  unoptimized
                  className="merch-carousel-image"
                  sizes="112px"
                />
                <button
                  type="button"
                  className="merch-gallery-expand"
                  onClick={openFullscreenGallery}
                  aria-label="Open full-screen gallery"
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M16 3h3a2 2 0 0 1 2 2v3" />
                    <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </svg>
                </button>
                {gallery.length > 1 && (
                  <span className="merch-mobile-image-count">
                    {activeImageIndex + 1}/{gallery.length}
                  </span>
                )}
              </div>
              <div className="merch-mobile-summary-copy">
                <h2>{selectedProduct.name}</h2>
                <div className="merch-detail-price">{formatRM(selectedVariantPrice)}</div>
                {selectedProduct.soldOut && (
                  <div className="merch-stock-status">Sold out</div>
                )}
                {selectedProduct.unitLabel && (
                  <div className="merch-unit-label">{selectedProduct.unitLabel}</div>
                )}
                {(selectedProduct.minimumOrderQuantity > 1 || selectedProduct.category === 'SIM Cards') && (
                  <div className="merch-minimum-order">
                    {minimumOrderLabel(selectedProduct.minimumOrderQuantity)}
                  </div>
                )}
              </div>
            </section>

            <section className="merch-modal-media" aria-label={`${selectedProduct.name} images`}>
              <div
                className="merch-modal-main-image"
                onTouchStart={(event) => handleGalleryTouchStart(event.touches[0]?.clientX)}
                onTouchEnd={(event) => handleGalleryTouchEnd(event.changedTouches[0]?.clientX)}
              >
                <Image
                  key={selectedImage}
                  src={selectedImage}
                  alt={`${selectedProduct.name} ${selectedOption.name}`}
                  fill
                  priority
                  unoptimized
                  className="merch-carousel-image"
                  sizes="(max-width: 760px) 100vw, 46vw"
                />
                {gallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="merch-carousel-arrow merch-carousel-arrow--previous"
                      onClick={() => stepImage(-1)}
                      aria-label="Previous product image"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="merch-carousel-arrow merch-carousel-arrow--next"
                      onClick={() => stepImage(1)}
                      aria-label="Next product image"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
              {gallery.length > 1 && (
                <div className="merch-detail-thumbnails">
                  {gallery.map((image, index) => (
                    <button
                      key={`${image}-${index}`}
                      type="button"
                      className={activeImageIndex === index ? 'active' : ''}
                      onClick={() => showImage(index)}
                      aria-label={`View image ${index + 1}`}
                    >
                      <Image src={image} alt="" fill unoptimized sizes="72px" />
                    </button>
                  ))}
                </div>
              )}
              {gallery.length > 1 && (
                <div className="merch-carousel-dots" aria-label={`Image ${activeImageIndex + 1} of ${gallery.length}`}>
                  {gallery.map((image, index) => (
                    <button
                      key={`dot-${image}-${index}`}
                      type="button"
                      className={activeImageIndex === index ? 'active' : ''}
                      onClick={() => showImage(index)}
                      aria-label={`View image ${index + 1}`}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="merch-modal-content">
              <h2 id="merch-modal-title">{selectedProduct.name}</h2>
              <div className="merch-detail-price">{formatRM(selectedVariantPrice)}</div>
              {selectedProduct.soldOut && (
                <div className="merch-stock-status">Sold out</div>
              )}
              {selectedProduct.unitLabel && (
                <div className="merch-unit-label">{selectedProduct.unitLabel}</div>
              )}
              {(selectedProduct.minimumOrderQuantity > 1 || selectedProduct.category === 'SIM Cards') && (
                <div className="merch-minimum-order">
                  {minimumOrderLabel(selectedProduct.minimumOrderQuantity)}
                </div>
              )}

              {selectedProduct.options.length > 1 && (
                <div className="merch-selector">
                  <div className="merch-selector-title">
                    <span>{selectedProduct.optionLabel || 'Option'}</span>
                  </div>
                  <div className={`merch-option-list${isColourOption(selectedProduct.optionLabel) ? ' merch-colour-list' : ''}`}>
                    {selectedProduct.options.map((option, index) => (
                      <button
                        type="button"
                        key={option.name}
                        className={optionIndex === index ? 'active' : ''}
                        onClick={() => handleOptionChange(index)}
                        aria-label={`Select ${option.name}`}
                        title={option.name}
                        disabled={!(option.sizes || selectedProduct.sizes) && !getMerchandiseVariantId(selectedProduct, option.name)}
                      >
                        {isColourOption(selectedProduct.optionLabel) ? (
                          <span
                            className="merch-colour-swatch"
                            style={{ background: option.swatch || '#e2e8f0' }}
                            aria-hidden="true"
                          />
                        ) : option.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {availableSizes && (
                <div className="merch-selector">
                  <div className="merch-selector-title">
                    <span>Size</span>
                  </div>
                  <div className="merch-size-list">
                    {availableSizes.map((size) => (
                      <button
                        type="button"
                        key={size}
                        className={selectedSize === size ? 'active' : ''}
                        disabled={(() => {
                          const variantId = getMerchandiseVariantId(selectedProduct, selectedOption.name, size);
                          return !variantId || getMerchandiseVariantInventory(selectedProduct, variantId) <= 0;
                        })()}
                        onClick={() => {
                          setSelectedSize(size);
                          setError('');
                        }}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="merch-size-guide-link"
                    onClick={openSizeGuide}
                  >
                    View size guide
                  </button>
                </div>
              )}

              {selectedProduct.soldOut || optionMappingUnavailable || insufficientVariantStock ? (
                <div className="merch-purchase-row merch-purchase-row--desktop merch-purchase-row--unavailable">
                  <button
                    type="button"
                    className="btn merch-add-button merch-unavailable-button"
                    disabled
                  >
                    {selectedProduct.soldOut || insufficientVariantStock ? 'Insufficient stock' : 'Variation unavailable'}
                  </button>
                </div>
              ) : (
                <div className="merch-purchase-row merch-purchase-row--desktop">
                  <div className="merch-quantity" aria-label="Quantity">
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => Math.max(selectedProduct.minimumOrderQuantity, value - 1))}
                      aria-label="Reduce quantity"
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      disabled={quantity >= remainingVariantInventory}
                      onClick={() => setQuantity((value) => Math.min(remainingVariantInventory, value + 1))}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary merch-add-button"
                    onClick={handleAddToCart}
                  >
                    Add to Cart · {formatRM(selectedVariantPrice * quantity)}
                  </button>
                </div>
              )}
              {error && <p className="merch-form-error" role="alert">{error}</p>}

              <div className="merch-product-accordions">
                {selectedProduct.features && (
                  <details>
                    <summary>Product details</summary>
                    <ul className="merch-accordion-features">
                      {selectedProduct.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <details>
                  <summary>Description</summary>
                  <p>{selectedProduct.description}</p>
                </details>
              </div>
            </section>

            <div className="merch-mobile-purchase-shell">
              {selectedProduct.soldOut || optionMappingUnavailable || insufficientVariantStock ? (
                <button
                  type="button"
                  className="btn merch-add-button merch-unavailable-button"
                  disabled
                >
                  {selectedProduct.soldOut || insufficientVariantStock ? 'Insufficient stock' : 'Variation unavailable'}
                </button>
              ) : (
                <div className="merch-mobile-purchase-row">
                  <div className="merch-quantity" aria-label="Quantity">
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => Math.max(selectedProduct.minimumOrderQuantity, value - 1))}
                      aria-label="Reduce quantity"
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      disabled={quantity >= remainingVariantInventory}
                      onClick={() => setQuantity((value) => Math.min(remainingVariantInventory, value + 1))}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary merch-add-button"
                    onClick={handleAddToCart}
                  >
                    Add to Cart · {formatRM(selectedVariantPrice * quantity)}
                  </button>
                </div>
              )}
              {error && <p className="merch-mobile-form-error" role="alert">{error}</p>}
            </div>
          </div>

          {showSizeGuide && (
            <div
              className="merch-size-guide-layer"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeSizeGuide();
              }}
            >
              <section
                className="merch-size-guide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="merch-size-guide-title"
              >
                <button
                  type="button"
                  className="merch-size-guide-close"
                  onClick={closeSizeGuide}
                  aria-label="Close size guide"
                >
                  &times;
                </button>
                <span className="merch-size-guide-eyebrow">Approximate measurements</span>
                <h3 id="merch-size-guide-title">Size guide</h3>
                <p>Garment measurements in centimetres. Actual sizing may vary slightly.</p>
                <div className="merch-size-table-wrap">
                  <table className="merch-size-table">
                    <thead>
                      <tr>
                        <th>Size</th>
                        <th>Chest width</th>
                        <th>Length</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SIZE_GUIDE.map(([size, chest, length]) => (
                        <tr key={size}>
                          <th>{size}</th>
                          <td>{chest} cm</td>
                          <td>{length} cm</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {showFullscreenGallery && (
            <div className="merch-fullscreen-gallery" role="dialog" aria-modal="true" aria-label={`${selectedProduct.name} full-screen gallery`}>
              <button
                type="button"
                className="merch-fullscreen-close"
                onClick={closeFullscreenGallery}
                aria-label="Close full-screen gallery"
                autoFocus
              >
                ×
              </button>
              <div
                className="merch-fullscreen-image"
                onTouchStart={(event) => handleGalleryTouchStart(event.touches[0]?.clientX)}
                onTouchEnd={(event) => handleFullscreenTouchEnd(event.changedTouches[0]?.clientX)}
              >
                <Image
                  key={`fullscreen-${fullscreenImage}`}
                  src={fullscreenImage}
                  alt={`${selectedProduct.name} image ${fullscreenImageIndex + 1}`}
                  fill
                  priority
                  unoptimized
                  className="merch-carousel-image"
                  sizes="100vw"
                />
                {productGallery.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="merch-fullscreen-arrow merch-fullscreen-arrow--previous"
                      onClick={() => stepFullscreenImage(-1)}
                      aria-label="Previous product image"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="merch-fullscreen-arrow merch-fullscreen-arrow--next"
                      onClick={() => stepFullscreenImage(1)}
                      aria-label="Next product image"
                    >
                      ›
                    </button>
                  </>
                )}
              </div>
              <span className="merch-fullscreen-count">
                {fullscreenImageIndex + 1} / {productGallery.length}
              </span>
            </div>
          )}

        </div>,
        document.body,
      )}
    </div>
  );
}
