"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const devices_module_1 = require("./devices/devices.module");
const brands_module_1 = require("./brands/brands.module");
const banners_module_1 = require("./banners/banners.module");
const plans_module_1 = require("./plans/plans.module");
const numbers_module_1 = require("./numbers/numbers.module");
const orders_module_1 = require("./orders/orders.module");
const payment_module_1 = require("./payment/payment.module");
const proxy_module_1 = require("./proxy/proxy.module");
const settings_module_1 = require("./settings/settings.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            typeorm_1.TypeOrmModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    type: 'postgres',
                    host: config.get('DB_HOST', 'localhost'),
                    port: config.get('DB_PORT', 5432),
                    username: config.get('DB_USERNAME', 'tonewow'),
                    password: config.get('DB_PASSWORD', 'ToneWow@2024'),
                    database: config.get('DB_DATABASE', 'tonewow_shop'),
                    autoLoadEntities: true,
                    synchronize: true,
                }),
            }),
            devices_module_1.DevicesModule,
            brands_module_1.BrandsModule,
            banners_module_1.BannersModule,
            plans_module_1.PlansModule,
            numbers_module_1.NumbersModule,
            orders_module_1.OrdersModule,
            payment_module_1.PaymentModule,
            proxy_module_1.ProxyModule,
            settings_module_1.SettingsModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map