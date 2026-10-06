'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import PaymentResult from '@/components/payment/PaymentResult';
import { trackMerchPurchaseSuccess, type MerchOrderData } from '@/lib/smartech';

function Content() {
  const params = useSearchParams();
  const clear = useCartStore((state) => state.clear);

  useEffect(() => {
    clear();
    localStorage.removeItem('tw_pending_order');
  }, [clear]);

  useEffect(() => {
    const orderId = params.get('orderId') || params.get('order');
    const raw = localStorage.getItem('tw_smartech_merch_order');
    if (!raw) return;

    let stored: (MerchOrderData & { orderId?: string; referenceNumber?: string }) | null = null;
    try { stored = JSON.parse(raw); } catch { return; }
    if (!stored) return;

    const { orderId: storedOrderId, referenceNumber, ...orderData } = stored;
    // padankan order; kalau URL tiada order id, jangan hantar (elak tersalah order)
    if (!orderId || (orderId !== storedOrderId && orderId !== referenceNumber)) return;

    let attempts = 0;
    let timer: number | undefined;
    const send = () => {
      if (window.smartech) {
        trackMerchPurchaseSuccess(orderData);
        localStorage.removeItem('tw_smartech_merch_order'); // elak hantar dua kali + buang IC
        return;
      }
      if (attempts++ < 20) timer = window.setTimeout(send, 500);
    };
    send();
    return () => { if (timer) window.clearTimeout(timer); };
  }, [params]);

  return (
    <PaymentResult
      status="success"
      orderNumber={params.get('orderId') || params.get('order')}
      paymentRef={params.get('gatewayTxnId') || params.get('transactionId') || params.get('ref')}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 80, textAlign: 'center' }}>Loading payment result…</div>}>
      <Content />
    </Suspense>
  );
}