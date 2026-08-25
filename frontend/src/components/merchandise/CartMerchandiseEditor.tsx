'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import type { CartItem } from '@/types';
import { getMerchandiseVariantId, getMerchandiseVariantInventory, type MerchandiseProduct } from '@/data/merchandise';
import { formatRM } from '@/lib/utils';
import { minimumOrderLabel } from '@/lib/minimumOrderQuantity';

interface Props {
  item: CartItem;
  product: MerchandiseProduct;
  onClose: () => void;
  reservedQuantityByVariant: Record<number, number>;
  onConfirm: (updates: Pick<CartItem, 'variant' | 'size' | 'image' | 'quantity' | 'bundleVariantId' | 'availableQuantity'>) => void;
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
  images.forEach((src) => {
    const image = new window.Image();
    image.decoding = 'async';
    image.src = src;
  });
}

export default function CartMerchandiseEditor({ item, product, reservedQuantityByVariant, onClose, onConfirm }: Props) {
  const initialOption = Math.max(
    0,
    product.options.findIndex((option) => option.name === item.variant),
  );
  const [optionIndex, setOptionIndex] = useState(initialOption);
  const [selectedSize, setSelectedSize] = useState(item.size || '');
  const [quantity, setQuantity] = useState(
    Math.max(product.minimumOrderQuantity, item.quantity),
  );
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [fullscreenImageIndex, setFullscreenImageIndex] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [showFullscreenGallery, setShowFullscreenGallery] = useState(false);
  const [error, setError] = useState('');
  const touchStartX = useRef<number | null>(null);
  const galleryHistoryRef = useRef(false);
  const sizeGuideHistoryRef = useRef(false);

  const selectedOption = product.options[optionIndex];
  const availableSizes = selectedOption?.sizes || product.sizes;
  const gallery = useMemo(
    () => getOptionGallery(product, optionIndex),
    [product, optionIndex],
  );
  const productGallery = useMemo(() => getProductGallery(product), [product]);
  const selectedImage = gallery[activeImageIndex] || selectedOption.image;
  const fullscreenImage = productGallery[fullscreenImageIndex] || selectedImage;
  const selectedVariantId = getMerchandiseVariantId(product, selectedOption.name, selectedSize || undefined);
  const selectedVariantInventory = getMerchandiseVariantInventory(product, selectedVariantId);
  const maximumQuantity = Math.max(
    0,
    selectedVariantInventory - (selectedVariantId ? reservedQuantityByVariant[selectedVariantId] || 0 : 0),
  );

  useEffect(() => {
    if (!selectedVariantId) return;
    setQuantity((value) => Math.min(maximumQuantity, Math.max(product.minimumOrderQuantity, value)));
  }, [maximumQuantity, product.minimumOrderQuantity, selectedVariantId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.history.pushState({ ...window.history.state, merchCartEditor: true }, '');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (galleryHistoryRef.current || sizeGuideHistoryRef.current) {
        window.history.back();
      } else {
        window.history.back();
      }
    };
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
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onClose]);

  useEffect(() => {
    if (gallery.length < 2 || !autoplayEnabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setActiveImageIndex((index) => (index + 1) % gallery.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [gallery.length, autoplayEnabled]);

  const closeEditor = () => {
    if (galleryHistoryRef.current || sizeGuideHistoryRef.current) {
      window.history.back();
      return;
    }
    if (window.history.state?.merchCartEditor) window.history.back();
    else onClose();
  };

  const openFullscreenGallery = () => {
    const initialIndex = productGallery.indexOf(selectedImage);
    setFullscreenImageIndex(initialIndex >= 0 ? initialIndex : 0);
    if (!galleryHistoryRef.current) {
      galleryHistoryRef.current = true;
      window.history.pushState({ ...window.history.state, merchFullscreenGallery: true }, '');
    }
    setAutoplayEnabled(false);
    setShowFullscreenGallery(true);
  };

  const closeFullscreenGallery = () => {
    if (galleryHistoryRef.current) window.history.back();
    else setShowFullscreenGallery(false);
  };

  const openSizeGuide = () => {
    if (!sizeGuideHistoryRef.current) {
      sizeGuideHistoryRef.current = true;
      window.history.pushState({ ...window.history.state, merchSizeGuide: true }, '');
    }
    setShowSizeGuide(true);
  };

  const closeSizeGuide = () => {
    if (sizeGuideHistoryRef.current) window.history.back();
    else setShowSizeGuide(false);
  };

  const handleOptionChange = (index: number) => {
    preloadGallery(getOptionGallery(product, index));
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

  const handleTouchStart = (clientX: number | undefined) => {
    touchStartX.current = clientX ?? null;
  };

  const handleTouchEnd = (clientX: number | undefined, fullscreen = false) => {
    if (touchStartX.current === null) return;
    const endX = clientX ?? touchStartX.current;
    const distance = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 40) return;
    if (fullscreen) stepFullscreenImage(distance < 0 ? 1 : -1);
    else stepImage(distance < 0 ? 1 : -1);
  };

  const confirm = () => {
    if (availableSizes && !selectedSize) {
      setError('Please select a size.');
      return;
    }
    const bundleVariantId = getMerchandiseVariantId(
      product,
      selectedOption.name,
      selectedSize || undefined,
    );
    if (!bundleVariantId) {
      setError('This option is not available for checkout yet. Please refresh and try again.');
      return;
    }
    if (quantity < product.minimumOrderQuantity || quantity > maximumQuantity) {
      setError(maximumQuantity > 0
        ? 'The selected quantity exceeds the current stock limit.'
        : 'This variation is out of stock.');
      return;
    }
    onConfirm({
      variant: product.options.length > 1 ? selectedOption.name : undefined,
      size: selectedSize || undefined,
      image: selectedOption.image,
      quantity,
      bundleVariantId,
      availableQuantity: selectedVariantInventory,
    });
    closeEditor();
  };

  return createPortal(
    <div
      className="merch-modal-backdrop merch-edit-backdrop"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget
          && !window.matchMedia('(max-width: 760px)').matches
        ) {
          closeEditor();
        }
      }}
    >
      <div
        className="merch-modal merch-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merch-edit-title"
      >
        <button
          type="button"
          className="merch-modal-close"
          onClick={closeEditor}
          aria-label="Close product editor"
          autoFocus
        >
          &times;
        </button>

        <section className="merch-mobile-summary">
          <div
            className="merch-mobile-gallery"
            onTouchStart={(event) => handleTouchStart(event.touches[0]?.clientX)}
            onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX)}
          >
            <Image
              key={`mobile-${selectedImage}`}
              src={selectedImage}
              alt={`${product.name} ${selectedOption.name}`}
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
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            <h2>{product.name}</h2>
            <div className="merch-detail-price">{formatRM(product.price)}</div>
            {product.unitLabel && <div className="merch-unit-label">{product.unitLabel}</div>}
            {(product.minimumOrderQuantity > 1 || product.category === 'SIM Cards') && (
              <div className="merch-minimum-order">
                {minimumOrderLabel(product.minimumOrderQuantity)}
              </div>
            )}
          </div>
        </section>

        <section className="merch-modal-media" aria-label={`${product.name} images`}>
          <div
            className="merch-modal-main-image"
            onTouchStart={(event) => handleTouchStart(event.touches[0]?.clientX)}
            onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX)}
          >
            <Image
              key={selectedImage}
              src={selectedImage}
              alt={`${product.name} ${selectedOption.name}`}
              fill
              priority
              unoptimized
              className="merch-carousel-image"
              sizes="(max-width: 760px) 100vw, 46vw"
            />
            {gallery.length > 1 && (
              <>
                <button type="button" className="merch-carousel-arrow merch-carousel-arrow--previous" onClick={() => stepImage(-1)} aria-label="Previous product image">
                  &lsaquo;
                </button>
                <button type="button" className="merch-carousel-arrow merch-carousel-arrow--next" onClick={() => stepImage(1)} aria-label="Next product image">
                  &rsaquo;
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
          <h2 id="merch-edit-title">{product.name}</h2>
          <div className="merch-detail-price">{formatRM(product.price)}</div>
          {product.unitLabel && <div className="merch-unit-label">{product.unitLabel}</div>}
          {(product.minimumOrderQuantity > 1 || product.category === 'SIM Cards') && (
            <div className="merch-minimum-order">
              {minimumOrderLabel(product.minimumOrderQuantity)}
            </div>
          )}

          {product.options.length > 1 && (
            <div className="merch-selector">
              <div className="merch-selector-title">
                <span>{product.optionLabel || 'Option'}</span>
              </div>
              <div className={`merch-option-list${product.optionLabel === 'Colour' ? ' merch-colour-list' : ''}`}>
                {product.options.map((option, index) => (
                  <button
                    type="button"
                    key={option.name}
                    className={optionIndex === index ? 'active' : ''}
                    onClick={() => handleOptionChange(index)}
                    aria-label={`Select ${option.name}`}
                    title={option.name}
                  >
                    {product.optionLabel === 'Colour' ? (
                      <span className="merch-colour-swatch" style={{ background: option.swatch || '#e2e8f0' }} aria-hidden="true" />
                    ) : option.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableSizes && (
            <div className="merch-selector">
              <div className="merch-selector-title"><span>Size</span></div>
              <div className="merch-size-list">
                {availableSizes.map((size) => (
                  <button
                    type="button"
                    key={size}
                    className={selectedSize === size ? 'active' : ''}
                    onClick={() => {
                      setSelectedSize(size);
                      setError('');
                    }}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <button type="button" className="merch-size-guide-link" onClick={openSizeGuide}>
                View size guide
              </button>
            </div>
          )}

          <div className="merch-purchase-row merch-purchase-row--desktop">
            <div className="merch-quantity" aria-label="Quantity">
              <button type="button" onClick={() => setQuantity((value) => Math.max(product.minimumOrderQuantity, value - 1))} aria-label="Reduce quantity">-</button>
              <span>{quantity}</span>
              <button type="button" disabled={quantity >= maximumQuantity} onClick={() => setQuantity((value) => Math.min(maximumQuantity, value + 1))} aria-label="Increase quantity">+</button>
            </div>
            <button type="button" className="btn btn-primary merch-add-button" onClick={confirm}>
              Confirm · {formatRM(product.price * quantity)}
            </button>
          </div>
          {error && <p className="merch-form-error" role="alert">{error}</p>}

          <div className="merch-product-accordions">
            {product.features && (
              <details>
                <summary>Product details</summary>
                <ul className="merch-accordion-features">
                  {product.features.map((feature) => <li key={feature}>{feature}</li>)}
                </ul>
              </details>
            )}
            <details>
              <summary>Description</summary>
              <p>{product.description}</p>
            </details>
          </div>
        </section>

        <div className="merch-mobile-purchase-shell">
          <div className="merch-mobile-purchase-row">
            <div className="merch-quantity" aria-label="Quantity">
              <button type="button" onClick={() => setQuantity((value) => Math.max(product.minimumOrderQuantity, value - 1))} aria-label="Reduce quantity">-</button>
              <span>{quantity}</span>
              <button type="button" disabled={quantity >= maximumQuantity} onClick={() => setQuantity((value) => Math.min(maximumQuantity, value + 1))} aria-label="Increase quantity">+</button>
            </div>
            <button type="button" className="btn btn-primary merch-add-button" onClick={confirm}>
              Confirm · {formatRM(product.price * quantity)}
            </button>
          </div>
          {error && <p className="merch-mobile-form-error" role="alert">{error}</p>}
        </div>
      </div>

      {showSizeGuide && (
        <div className="merch-size-guide-layer" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeSizeGuide();
        }}>
          <section className="merch-size-guide" role="dialog" aria-modal="true" aria-labelledby="merch-edit-size-guide-title">
            <button type="button" className="merch-size-guide-close" onClick={closeSizeGuide} aria-label="Close size guide">
              &times;
            </button>
            <span className="merch-size-guide-eyebrow">Approximate measurements</span>
            <h3 id="merch-edit-size-guide-title">Size guide</h3>
            <p>Garment measurements in centimetres. Actual sizing may vary slightly.</p>
            <div className="merch-size-table-wrap">
              <table className="merch-size-table">
                <thead>
                  <tr><th>Size</th><th>Chest width</th><th>Length</th></tr>
                </thead>
                <tbody>
                  {SIZE_GUIDE.map(([size, chest, length]) => (
                    <tr key={size}><th>{size}</th><td>{chest} cm</td><td>{length} cm</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {showFullscreenGallery && (
        <div className="merch-fullscreen-gallery" role="dialog" aria-modal="true" aria-label={`${product.name} full-screen gallery`}>
          <button type="button" className="merch-fullscreen-close" onClick={closeFullscreenGallery} aria-label="Close full-screen gallery">
            &times;
          </button>
          <div
            className="merch-fullscreen-image"
            onTouchStart={(event) => handleTouchStart(event.touches[0]?.clientX)}
            onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX, true)}
          >
            <Image
              key={`fullscreen-${fullscreenImage}`}
              src={fullscreenImage}
              alt={`${product.name} image ${fullscreenImageIndex + 1}`}
              fill
              priority
              unoptimized
              className="merch-carousel-image"
              sizes="100vw"
            />
            {productGallery.length > 1 && (
              <>
                <button type="button" className="merch-fullscreen-arrow merch-fullscreen-arrow--previous" onClick={() => stepFullscreenImage(-1)} aria-label="Previous product image">
                  &lsaquo;
                </button>
                <button type="button" className="merch-fullscreen-arrow merch-fullscreen-arrow--next" onClick={() => stepFullscreenImage(1)} aria-label="Next product image">
                  &rsaquo;
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
  );
}
