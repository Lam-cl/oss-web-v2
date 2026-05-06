import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (!isNaN(numId)) {
      return this.ordersService.findById(numId);
    }
    return this.ordersService.findByOrderNumber(id);
  }

  @Post('checkout')
  async guestCheckout(@Body() body: any) {
    return this.ordersService.guestCheckout(body);
  }

  @Post('payment/initiate')
  async initiatePayment(@Body() body: any) {
    return this.ordersService.initiatePayment(body);
  }
}
