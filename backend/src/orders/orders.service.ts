import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Order } from './order.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private bundleApiUrl: string;

  constructor(
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.bundleApiUrl = this.configService.get(
      'BUNDLE_API_URL',
      'https://bundleapi.tonewow.com/api',
    );
  }

  private generateOrderNumber(): string {
    const now = new Date();
    const prefix = 'TW';
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0');
    return `${prefix}${date}${rand}`;
  }

  async create(dto: CreateOrderDto): Promise<Order> {
    const order = this.orderRepo.create({
      ...dto,
      order_number: this.generateOrderNumber(),
      subtotal: dto.total,
      shipping_cost: dto.shipping || 0,
      status: 'pending',
    });
    return this.orderRepo.save(order);
  }

  async findByOrderNumber(orderNumber: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { order_number: orderNumber },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async findById(id: number): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // Proxy checkout to bundleapi
  async guestCheckout(orderData: any): Promise<any> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.bundleApiUrl}/payment/initiate-with-order-guest`,
          orderData,
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Referer: 'https://shop.tonewow.com/',
            },
          },
        ),
      );
      return data;
    } catch (error) {
      return { error: true, message: error.message };
    }
  }

  // Proxy payment initiation
  async initiatePayment(paymentData: any): Promise<any> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.bundleApiUrl}/payment/gkash/initiate`,
          paymentData,
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );
      return data;
    } catch (error) {
      return { error: true, message: error.message };
    }
  }
}
