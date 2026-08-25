import PaymentResult from '@/components/payment/PaymentResult';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: SearchParams[string]) => Array.isArray(value) ? value[0] : value;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <PaymentResult
    status="failed"
    orderNumber={first(searchParams.orderId) || first(searchParams.order)}
    paymentRef={first(searchParams.gatewayTxnId) || first(searchParams.transactionId) || first(searchParams.ref)}
    reason={first(searchParams.error) || first(searchParams.reason)}
  />;
}
