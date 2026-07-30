'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getMerchandiseProduct } from '@/data/merchandise';
import { formatRM } from '@/lib/utils';
import { useCartStore } from '@/store/cartStore';

export default function MerchandiseDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const product = useMemo(() => getMerchandiseProduct(params.slug), [params.slug]);
  const addItem = useCartStore((state) => state.addItem);
  const [optionIndex, setOptionIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState('');
  const [error, setError] = useState('');

  if (!product) {
    return (
      <div className="container merch-not-found">
        <h1>Merchandise not found</h1>
        <Link href="/">← Back to shop</Link>
      </div>
    );
  }

  const selectedOption = product.options[optionIndex];
  const selectedImage = activeImage || selectedOption.image;
  const availableSizes = selectedOption.sizes || product.sizes;
  const gallery = [selectedOption.image, ...(selectedOption.gallery || product.gallery || [])];

  const handleOptionChange = (index: number) => {
    setOptionIndex(index);
    setSelectedSize('');
    setActiveImage('');
    setError('');
  };

  const handleAddToCart = () => {
    if (product.soldOut) {
      setError('This item is currently unavailable.');
      return;
    }
    if (availableSizes && !selectedSize) {
      setError('Please select a size.');
      return;
    }

    setError('');
    addItem({
      id: `merch:${product.id}:${selectedOption.name}:${selectedSize || 'standard'}`,
      type: 'merchandise',
      productId: product.id,
      slug: product.slug,
      name: product.name,
      description: product.unitLabel || product.description,
      variant: product.options.length > 1 ? selectedOption.name : undefined,
      size: selectedSize || undefined,
      image: selectedOption.image,
      price: product.price,
      quantity,
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
            <Image src={selectedImage} alt={`${product.name} ${selectedOption.name}`} fill priority sizes="(max-width: 900px) 100vw, 55vw" />
          </div>
          {gallery.length > 1 && (
            <div className="merch-detail-thumbnails">
              {gallery.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  className={selectedImage === image ? 'active' : ''}
                  onClick={() => setActiveImage(image)}
                  aria-label={`View image ${index + 1}`}
                >
                  <Image src={image} alt="" fill sizes="88px" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="merch-detail-panel">
          <h1>{product.name}</h1>
          {product.unitLabel && <div className="merch-unit-label">{product.unitLabel}</div>}

          {product.options.length > 1 && (
            <div className="merch-selector">
              <div className="merch-selector-title">
                <span>{product.optionLabel || 'Option'}</span>
                <strong>{selectedOption.name}</strong>
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

          <div className="merch-detail-price">{formatRM(product.price)}</div>
          {product.soldOut && <div className="merch-stock-status">Sold out</div>}
          {product.soldOut ? (
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
                <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button>
                <span>{quantity}</span>
                <button type="button" onClick={() => setQuantity((value) => value + 1)}>+</button>
              </div>
              <button type="button" className="btn btn-primary merch-add-button" onClick={handleAddToCart}>
                Add to Cart · {formatRM(product.price * quantity)}
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
