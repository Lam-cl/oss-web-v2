import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { DevicesModule } from './devices/devices.module';
import { BrandsModule } from './brands/brands.module';
import { BannersModule } from './banners/banners.module';
import { PlansModule } from './plans/plans.module';
import { NumbersModule } from './numbers/numbers.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentModule } from './payment/payment.module';
import { ProxyModule } from './proxy/proxy.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'tonewow'),
        password: config.get('DB_PASSWORD', 'ToneWow@2024'),
        database: config.get('DB_DATABASE', 'tonewow_shop'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    DevicesModule,
    BrandsModule,
    BannersModule,
    PlansModule,
    NumbersModule,
    OrdersModule,
    PaymentModule,
    ProxyModule,
    SettingsModule,
  ],
})
export class AppModule {}
