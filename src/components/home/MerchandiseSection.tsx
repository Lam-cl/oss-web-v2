'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import {
  merchandiseProducts,
  type MerchandiseProduct,
} from '@/data/merchandise';
import { formatRM } from '@/lib/utils';
import { useCartStore } from '@/store/cartStore';

function getOptionGallery(product: MerchandiseProduct, optionIndex: number) {
  const option = product.options[optionIndex];
  if (!option) return [];
  return Array.from(new Set([option.image, ...(option.gallery || product.gallery || [])]));
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
  const items = useCartStore((state) => state.items);
  const addItem = useCartStore((state) => state.addItem);
  const [selectedProduct, setSelectedProduct] = useState<MerchandiseProduct | null>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [autoplayEnabled, setAutoplayEnabled] = useState(true);
  const [error, setError] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  const merchandiseQuantities = useMemo(
    () => items.reduce<Record<string, number>>((totals, item) => {
      if (item.type === 'merchandise' && item.productId) {
        totals[item.productId] = (totals[item.productId] || 0) + item.quantity;
      }
      return totals;
    }, {}),
    [items],
  );

  useEffect(() => {
    if (!selectedProduct) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeProduct();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedProduct]);

  const openProduct = (product: MerchandiseProduct, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    preloadGallery(getOptionGallery(product, 0));
    setSelectedProduct(product);
    setOptionIndex(0);
    setSelectedSize('');
    setQuantity(1);
    setActiveImageIndex(0);
    setAutoplayEnabled(true);
    setError('');
  };

  const closeProduct = () => {
    setSelectedProduct(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const selectedOption = selectedProduct?.options[optionIndex];
  const availableSizes = selectedOption?.sizes || selectedProduct?.sizes;
  const gallery = useMemo(
    () => selectedProduct ? getOptionGallery(selectedProduct, optionIndex) : [],
    [selectedProduct, optionIndex],
  );
  const selectedImage = gallery[activeImageIndex] || selectedOption?.image || '';

  useEffect(() => {
    if (!selectedProduct || gallery.length < 2 || !autoplayEnabled) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => {
      setActiveImageIndex((index) => (index + 1) % gallery.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [selectedProduct, gallery.length, autoplayEnabled]);

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

    addItem({
      id: `merch:${selectedProduct.id}:${selectedOption.name}:${selectedSize || 'standard'}`,
      type: 'merchandise',
      productId: selectedProduct.id,
      slug: selectedProduct.slug,
      name: selectedProduct.name,
      description: selectedProduct.unitLabel || selectedProduct.description,
      variant: selectedProduct.options.length > 1 ? selectedOption.name : undefined,
      size: selectedSize || undefined,
      image: selectedOption.image,
      price: selectedProduct.price,
      quantity,
    });
    closeProduct();
  };

  return (
    <div className="merch-catalog">
      <div className="merch-catalog-heading">
        <span className="merch-eyebrow">tone wow Collection</span>
        <h2>Merchandise</h2>
        <p>Gear up with official tone wow apparel, drinkware and event essentials.</p>
      </div>

      <div className="merch-catalog-grid">
        {merchandiseProducts.map((product) => {
          const inCart = merchandiseQuantities[product.id] || 0;
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
                  <span className="merch-sold-out-label">Sold out</span>
                )}
                <Image
                  src={product.options[0].image}
                  alt={product.name}
                  fill
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
                <span className="merch-view-button" aria-hidden="true">
                  {product.soldOut ? 'View details' : 'View options'} →
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {selectedProduct && selectedOption && createPortal(
        <div
          className="merch-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProduct();
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

            <section className="merch-modal-media" aria-label={`${selectedProduct.name} images`}>
              <div
                className="merch-modal-main-image"
                onTouchStart={(event) => {
                  touchStartX.current = event.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(event) => {
                  if (touchStartX.current === null) return;
                  const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
                  const distance = endX - touchStartX.current;
                  touchStartX.current = null;
                  if (Math.abs(distance) < 40) return;
                  stepImage(distance < 0 ? 1 : -1);
                }}
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
            </section>

            <section className="merch-modal-content">
              <h2 id="merch-modal-title">{selectedProduct.name}</h2>
              <div className="merch-detail-price">{formatRM(selectedProduct.price)}</div>
              {selectedProduct.soldOut && (
                <div className="merch-stock-status">Sold out</div>
              )}
              {selectedProduct.unitLabel && (
                <div className="merch-unit-label">{selectedProduct.unitLabel}</div>
              )}

              {selectedProduct.options.length > 1 && (
                <div className="merch-selector">
                  <div className="merch-selector-title">
                    <span>{selectedProduct.optionLabel || 'Option'}</span>
                    <strong>{selectedOption.name}</strong>
                  </div>
                  <div className={`merch-option-list${selectedProduct.optionLabel === 'Colour' ? ' merch-colour-list' : ''}`}>
                    {selectedProduct.options.map((option, index) => (
                      <button
                        type="button"
                        key={option.name}
                        className={optionIndex === index ? 'active' : ''}
                        onClick={() => handleOptionChange(index)}
                        aria-label={`Select ${option.name}`}
                        title={option.name}
                      >
                        {selectedProduct.optionLabel === 'Colour' ? (
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
                    <strong>{selectedSize || 'Select a size'}</strong>
                  </div>
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
                </div>
              )}

              {selectedProduct.soldOut ? (
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
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                      aria-label="Reduce quantity"
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity((value) => value + 1)}
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
                    Add to Cart · {formatRM(selectedProduct.price * quantity)}
                  </button>
                </div>
              )}
              {error && <p className="merch-form-error" role="alert">{error}</p>}

              {selectedProduct.features && (
                <div className="merch-features">
                  <h3>Product details</h3>
                  <ul>
                    {selectedProduct.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="merch-detail-description">{selectedProduct.description}</p>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
