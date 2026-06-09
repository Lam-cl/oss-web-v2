'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import { formatRM } from '@/lib/utils';

export default function OrderSummaryPage() {
  const router = useRouter();
  const addItem = useCartStore((s) => s.addItem);
  const [plan, setPlan] = useState<any>(null);
  const [number, setNumber] = useState<any>(null);

  useEffect(() => {
    const savedPlan = localStorage.getItem('tw_selected_plan');
    const savedNumber = localStorage.getItem('tw_selected_number');
    if (savedPlan) setPlan(JSON.parse(savedPlan));
    if (savedNumber) setNumber(JSON.parse(savedNumber));
  }, []);

  if (!plan) {
    return (
      <div className="container" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h3>No plan selected</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Please select a plan first.</p>
        <a href="/sim/plans" className="btn btn-primary">Choose Plan</a>
      </div>
    );
  }

  const totalPrice = plan.price + (number?.price || 0);

  const handleAddToCart = () => {
    addItem({
      type: 'sim',
      plan: plan.slug || plan.name,
      number: number?.phoneNo,
      numberType: number?.category,
      category: number?.category,
      price: totalPrice,
      quantity: 1,

      name: `${plan.name} SIM${number ? ' + ' + number.displayNo : ''}`,
      description: `${plan.name} Plan${number ? ' with ' + number.label + ' number' : ' with random number'}`,
    });
    router.push('/cart');
  };

  return (
    <div className="container" style={{ paddingTop: 48, paddingBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <a href="/" style={{ color: 'var(--tw-blue)', fontWeight: 500 }}>← Back to Shop</a>
      </div>

      <h1 style={{ marginBottom: 32 }}>Order Summary</h1>

      <div className="order-summary-card">
        {number && (
          <div>
            <h4>Special Number: {number.displayNo || number.phoneNo}</h4>
            <span className="number-category-badge">{number.category}</span>
          </div>
        )}

        <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid var(--border)', fontSize: 18, fontWeight: 700 }}>
          Total: {formatRM(totalPrice)}
        </div>

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={handleAddToCart}>
          Add to Cart
        </button>
      </div>
    </div>
  );
}
