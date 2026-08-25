'use client';
import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useCartStore } from '@/store/cartStore';
import PaymentResult from '@/components/payment/PaymentResult';
function Content(){const params=useSearchParams();const clear=useCartStore(state=>state.clear);useEffect(()=>{clear();localStorage.removeItem('tw_pending_order')},[clear]);return <PaymentResult status="success" orderNumber={params.get('orderId')||params.get('order')} paymentRef={params.get('gatewayTxnId')||params.get('transactionId')||params.get('ref')}/>}
export default function Page(){return <Suspense fallback={<div className="container" style={{padding:80,textAlign:'center'}}>Loading payment result…</div>}><Content/></Suspense>}
