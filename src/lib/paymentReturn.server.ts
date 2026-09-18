import { readBundlePaymentStatus } from '@/lib/bundlePaymentStatus.server';
import { paymentResultUrl, type PaymentStatus } from '@/lib/paymentProcessing';

export const PAYMENT_PROCESSING_PATH = '/payment/processing';

type PaymentStatusReader = (orderId: number) => Promise<PaymentStatus>;

export async function authoritativePaymentReturnPath(
  orderId: number,
  readStatus: PaymentStatusReader = readBundlePaymentStatus,
) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return PAYMENT_PROCESSING_PATH;
  try {
    return paymentResultUrl(await readStatus(orderId)) || PAYMENT_PROCESSING_PATH;
  } catch {
    return PAYMENT_PROCESSING_PATH;
  }
}
