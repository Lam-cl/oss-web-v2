import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Order } from '../orders/order.entity';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order]), HttpModule],
  controllers: [PaymentController],
  providers: [PaymentService, WhatsAppService],
})
export class PaymentModule {}
