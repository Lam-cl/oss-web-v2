"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.setGlobalPrefix('api');
    const corsOrigins = (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    app.enableCors({
        origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
    });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
    }));
    const port = process.env.PORT || 4000;
    await app.listen(port);
    console.log(`🚀 ToneWow Backend running on http://localhost:${port}/api`);
}
bootstrap();
//# sourceMappingURL=main.js.map