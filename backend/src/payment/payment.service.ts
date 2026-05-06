import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Order } from '../orders/order.entity';
import { WhatsAppService } from './whatsapp.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private bundleApiUrl: string;
  private frontendUrl: string;
  private backendUrl: string;

  constructor(
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    private httpService: HttpService,
    private configService: ConfigService,
    private whatsappService: WhatsAppService,
  ) {
    this.bundleApiUrl = this.configService.get(
      'BUNDLE_API_URL',
      'https://bundleapi.tonewow.com/api',
    );
    this.frontendUrl = this.configService.get(
      'FRONTEND_URL',
      'https://tonewow-v2.xifuhalim.com',
    );
    this.backendUrl = this.configService.get(
      'BACKEND_URL',
      'https://tonewow-v2.xifuhalim.com/api',
    );
  }

  getFrontendUrl(): string {
    return this.frontendUrl;
  }

  async initiateSwiftPayment(checkoutData: any): Promise<any> {
    try {
      const FormData = (await import('form-data')).default;
      const fd = new FormData();
      fd.append('checkoutData', JSON.stringify(checkoutData));

      const url = `${this.bundleApiUrl}/payment/swiftpay/initiate-with-order-guest`;
      this.logger.log(`SwiftPay initiate: ${url}`);

      const { data } = await firstValueFrom(
        this.httpService.post(url, fd, {
          headers: {
            ...fd.getHeaders(),
            Accept: 'application/json',
          },
        }),
      );
      return data;
    } catch (err: any) {
      this.logger.error('SwiftPay error:', err?.response?.data || err.message);
      if (err?.response?.data) return err.response.data;
      return { success: false, message: err.message || 'SwiftPay request failed' };
    }
  }

  async initiateGkashPayment(data: {
    orderId: string;
    amount: number;
    customerName: string;
    customerEmail: string;
    description?: string;
  }) {
    try {
      // Call bundle API to get GKash payment params
      const { data: gkashData } = await firstValueFrom(
        this.httpService.post(
          `${this.bundleApiUrl}/payment/gkash/initiate`,
          {
            amount: data.amount,
            orderId: data.orderId,
            customerName: data.customerName,
            description: data.description || `tone wow Order ${data.orderId}`,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );

      if (!gkashData.success) {
        throw new Error('Failed to initiate GKash payment');
      }

      // Override return URLs to point to our backend
      const paymentParams = {
        ...gkashData.paymentParams,
        returnurl: `${this.backendUrl}/payment/gkash/return`,
        callbackurl: `${this.backendUrl}/payment/gkash/callback`,
        failureurl: `${this.backendUrl}/payment/gkash/return`,
      };

      // Update order payment method
      await this.orderRepo.update(
        { order_number: data.orderId },
        { payment_method: 'gkash', status: 'awaiting_payment' },
      );

      this.logger.log(`GKash payment initiated for order ${data.orderId}`);

      return {
        success: true,
        paymentUrl: gkashData.paymentUrl,
        paymentParams,
        cartId: gkashData.cartId,
      };
    } catch (error) {
      this.logger.error(`Payment initiation failed: ${error.message}`);
      return {
        success: false,
        error: error.message || 'Payment initiation failed',
      };
    }
  }

  /**
   * 3-checkpoint payment success detection.
   * Checkpoint 1: return.aspx params (status=88/Transferred, description=00/Approved)
   * Checkpoint 2: tw_confirmation.jsp (_paymentAlreadyProcessed==false → success)
   * Checkpoint 3: api.tonewow.com/payment/return/gkash (systemCode=="0")
   */
  async processPaymentReturn(params: Record<string, string>): Promise<{
    success: boolean;
    refNo: string;
    source: string;
    alreadyProcessed: boolean;
  }> {
    this.logger.log(`Payment return received: ${JSON.stringify(params)}`);

    const refNo = params.refNo || params.RefNo || params.ref_no || '';
    if (!refNo) return { success: false, refNo: '', source: 'none', alreadyProcessed: false };

    // Check if already processed
    const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
    if (order?.status === 'paid') {
      return { success: true, refNo, source: 'already_processed', alreadyProcessed: true };
    }

    // Primary: ToneWow getPaymentStatus API
    // status "2" = SUCCESS, status "1" = PENDING/FAILED
    try {
      const statusUrl = `https://www.tonewow.net/tgpayment/getPaymentStatus?refNo=${encodeURIComponent(refNo)}`;
      const { data: statusData } = await firstValueFrom(
        this.httpService.get(statusUrl, { timeout: 10000 }),
      );
      this.logger.log(`getPaymentStatus response: ${JSON.stringify(statusData).substring(0, 300)}`);

      const paymentStatus = statusData?.data?.[0]?.status;
      if (paymentStatus === '2') {
        await this.markOrderPaid(refNo, refNo);
        return { success: true, refNo, source: 'tgpayment', alreadyProcessed: false };
      }
      if (paymentStatus === '1') {
        return { success: false, refNo, source: 'tgpayment_pending', alreadyProcessed: false };
      }
    } catch (err) {
      this.logger.warn(`getPaymentStatus failed: ${err.message}`);
    }

    return { success: false, refNo, source: 'none', alreadyProcessed: false };
  }

  private async markOrderPaid(refNo: string, transactionId: string) {
    const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
    if (!order) {
      this.logger.warn(`markOrderPaid: no order found for refNo ${refNo}`);
      return;
    }
    if (order.status === 'paid') return;

    await this.orderRepo.update(order.id, { status: 'paid', payment_ref: transactionId });
    this.logger.log(`Order ${order.order_number} marked as paid`);

    // Send WhatsApp confirmation
    if (order.customer_phone) {
      await this.whatsappService.sendOrderConfirmation(
        order.customer_phone,
        order.customer_name || 'Pelanggan',
        refNo,
      );
    }
  }

  private async markOrderFailed(refNo: string) {
    await this.orderRepo.update({ payment_ref: refNo }, { status: 'payment_failed' });
  }

  /**
   * Start background polling for a payment refNo.
   * Polls checkpoints 2 & 3 every 30s for up to 10 minutes.
   * Called by frontend after redirecting to osspay.jsp (since returnUrl is ignored).
   */
  startPaymentPolling(refNo: string) {
    const maxAttempts = 20; // 20 x 30s = 10 minutes
    let attempt = 0;

    const poll = async () => {
      attempt++;
      this.logger.log(`Payment poll #${attempt} for refNo: ${refNo}`);

      // Check if already paid
      const order = await this.orderRepo.findOne({ where: { payment_ref: refNo } });
      if (!order) {
        this.logger.warn(`Poll: no order with payment_ref ${refNo}`);
        return;
      }
      if (order.status === 'paid') {
        this.logger.log(`Poll: order ${order.order_number} already paid, stopping`);
        return;
      }

      const result = await this.processPaymentReturn({ refNo });
      if (result.success) {
        this.logger.log(`Poll: payment confirmed for ${refNo} via ${result.source}`);
        return; // success — markOrderPaid already called inside processPaymentReturn
      }

      if (attempt < maxAttempts) {
        setTimeout(poll, 30000); // retry after 30s
      } else {
        this.logger.warn(`Poll: max attempts reached for ${refNo}, giving up`);
      }
    };

    // Start first poll after 15 seconds (give customer time to pay)
    setTimeout(poll, 15000);
  }

  async processGkashReturn(data: any) {
    this.logger.log(`GKash return received: ${JSON.stringify(data)}`);

    const cartId = data.cartid || data.CARTID || data.v_cartid || '';
    const status = data.status || data.Status || '';
    const transactionId = data.POID || data.poid || data.txnid || '';
    const amount = data.amount || data.v_amount || '';

    // Extract order number from cartId (format: "renthing-order-TWXXXXXXXX")
    let orderId = cartId;
    if (cartId.includes('order-')) {
      orderId = cartId.split('order-').pop() || cartId;
    }

    // Map GKash status codes
    let statusMessage = 'Unknown';
    if (status === '88') {
      statusMessage = 'Payment Successful';
      await this.orderRepo.update(
        { order_number: orderId },
        { status: 'paid', payment_ref: transactionId },
      );
      this.logger.log(`Order ${orderId} marked as paid, ref: ${transactionId}`);
    } else if (status === '66') {
      statusMessage = 'Payment Pending';
      await this.orderRepo.update(
        { order_number: orderId },
        { status: 'payment_pending', payment_ref: transactionId },
      );
    } else {
      statusMessage = 'Payment Failed';
      await this.orderRepo.update(
        { order_number: orderId },
        { status: 'payment_failed', payment_ref: transactionId },
      );
    }

    return { status, statusMessage, orderId, transactionId, amount };
  }

  async processGkashCallback(data: any) {
    this.logger.log(`GKash callback received: ${JSON.stringify(data)}`);

    // Process the same as return but don't redirect
    const result = await this.processGkashReturn(data);

    // Also forward to bundle API callback
    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.bundleApiUrl}/payment/gkash/callback`,
          data,
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );
    } catch (error) {
      this.logger.warn(`Bundle API callback forward failed: ${error.message}`);
    }

    return { success: true, ...result };
  }
}
