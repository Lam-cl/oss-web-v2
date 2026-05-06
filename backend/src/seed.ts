import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Brand } from './brands/brand.entity';
import { Device } from './devices/device.entity';
import { Banner } from './banners/banner.entity';
import { Plan } from './plans/plan.entity';
import * as dotenv from 'dotenv';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'tonewow',
  password: process.env.DB_PASSWORD || 'ToneWow@2024',
  database: process.env.DB_DATABASE || 'tonewow_shop',
  entities: [Brand, Device, Banner, Plan],
  synchronize: true,
});

async function seed() {
  await AppDataSource.initialize();
  console.log('Connected to database. Seeding...');

  const brandRepo = AppDataSource.getRepository(Brand);
  const deviceRepo = AppDataSource.getRepository(Device);
  const bannerRepo = AppDataSource.getRepository(Banner);
  const planRepo = AppDataSource.getRepository(Plan);

  // Clear existing data
  await deviceRepo.createQueryBuilder().delete().from("devices").execute();
  await bannerRepo.createQueryBuilder().delete().from("banners").execute();
  await planRepo.createQueryBuilder().delete().from("plans").execute();
  await brandRepo.createQueryBuilder().delete().from("brands").execute();

  // ===== BRANDS =====
  const brandsData = [
    { name: 'itel', slug: 'itel', sort_order: 1 },
    { name: 'Apple', slug: 'apple', sort_order: 2 },
    { name: 'Google', slug: 'google', sort_order: 3 },
    { name: 'Samsung', slug: 'samsung', sort_order: 4 },
    { name: 'Oppo', slug: 'oppo', sort_order: 5 },
    { name: 'Vivo', slug: 'vivo', sort_order: 6 },
    { name: 'Others', slug: 'others', sort_order: 7 },
  ];

  const brands: Record<string, Brand> = {};
  for (const b of brandsData) {
    const brand = brandRepo.create(b);
    brands[b.slug] = await brandRepo.save(brand);
  }
  console.log(`Seeded ${Object.keys(brands).length} brands`);

  // ===== DEVICES =====
  const devicesData = [
    // Apple (9)
    { slug: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max 5G', brand: 'apple', tag: 'New 5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/iphone-17-pro-max.png', is_sold_out: true },
    { slug: 'iphone-17-pro', name: 'iPhone 17 Pro 5G', brand: 'apple', tag: 'New 5G Phone', rrp: 5499, monthly_price: 230, image_url: '/images/devices/iphone-17-pro.png', is_sold_out: true },
    { slug: 'iphone-air', name: 'iPhone Air 5G', brand: 'apple', tag: 'New 5G Phone', rrp: 4999, monthly_price: 209, image_url: '/images/devices/iphone-air.png', is_sold_out: true },
    { slug: 'iphone-17', name: 'iPhone 17 5G', brand: 'apple', tag: 'New 5G Phone', rrp: 3999, monthly_price: 167, image_url: '/images/devices/iphone-17.png', is_sold_out: true },
    { slug: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max 5G', brand: 'apple', tag: '5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/iphone-16-pro-max.png', is_sold_out: true },
    { slug: 'iphone-16-pro', name: 'iPhone 16 Pro 5G', brand: 'apple', tag: '5G Phone', rrp: 4999, monthly_price: 209, image_url: '/images/devices/iphone-16-pro.png', is_sold_out: true },
    { slug: 'iphone-16-plus', name: 'iPhone 16 Plus 5G', brand: 'apple', tag: '5G Phone', rrp: 4499, monthly_price: 188, image_url: '/images/devices/iphone-16-plus.png', is_sold_out: true },
    { slug: 'iphone-16', name: 'iPhone 16 5G', brand: 'apple', tag: '5G Phone', rrp: 3499, monthly_price: 146, image_url: '/images/devices/iphone-16.png', is_sold_out: true },
    { slug: 'iphone-16e', name: 'iPhone 16e 5G', brand: 'apple', tag: '5G Phone', rrp: 2999, monthly_price: 125, image_url: '/images/devices/iphone-16e.png', is_sold_out: true },

    // Google (4)
    { slug: 'google-pixel-10', name: 'Google Pixel 10', brand: 'google', tag: 'New 5G Phone', rrp: 4499, monthly_price: 188, image_url: '/images/devices/google-pixel-10.png', is_sold_out: true },
    { slug: 'google-pixel-10-pro', name: 'Google Pixel 10 Pro 5G', brand: 'google', tag: 'New 5G Phone', rrp: 5499, monthly_price: 230, image_url: '/images/devices/google-pixel-10-pro.png', is_sold_out: true },
    { slug: 'google-pixel-10-pro-xl', name: 'Google Pixel 10 Pro XL', brand: 'google', tag: 'New 5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/google-pixel-10-pro-xl.png', is_sold_out: true },
    { slug: 'google-pixel-9a', name: 'Google Pixel 9a 5G', brand: 'google', tag: '5G Phone', rrp: 2699, monthly_price: 113, image_url: '/images/devices/google-pixel-9a.png', is_sold_out: true },

    // Samsung (11)
    { slug: 'samsung-s26-plus', name: 'Samsung Galaxy S26+ 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 6199, monthly_price: 259, image_url: '/images/devices/samsung-s26-plus.png', is_sold_out: true },
    { slug: 'samsung-s26', name: 'Samsung Galaxy S26 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 4399, monthly_price: 184, image_url: '/images/devices/samsung-s26.png', is_sold_out: true },
    { slug: 'samsung-s26-ultra', name: 'Samsung Galaxy S26 Ultra 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 6799, monthly_price: 284, image_url: '/images/devices/samsung-s26-ultra.png', is_sold_out: true },
    { slug: 'samsung-a17', name: 'Samsung Galaxy A17 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 999, monthly_price: 42, image_url: '/images/devices/samsung-a17.png', is_sold_out: true },
    { slug: 'samsung-z-fold7', name: 'Samsung Galaxy Z Fold7 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 8399, monthly_price: 350, image_url: '/images/devices/samsung-z-fold7.png', is_sold_out: true },
    { slug: 'samsung-z-flip7', name: 'Samsung Galaxy Z Flip7 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/samsung-z-flip7.png', is_sold_out: true },
    { slug: 'samsung-a36', name: 'Samsung A36 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 1699, monthly_price: 71, image_url: '/images/devices/samsung-a36.png', is_sold_out: true },
    { slug: 'samsung-a56', name: 'Samsung A56 5G', brand: 'samsung', tag: 'New 5G Phone', rrp: 2199, monthly_price: 92, image_url: '/images/devices/samsung-a56.png', is_sold_out: true },
    { slug: 'samsung-s25-ultra', name: 'Samsung Galaxy S25 Ultra 5G', brand: 'samsung', tag: '5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/samsung-s25-ultra.png', is_sold_out: true },
    { slug: 'samsung-s25-plus', name: 'Samsung Galaxy S25+ 5G', brand: 'samsung', tag: '5G Phone', rrp: 5599, monthly_price: 234, image_url: '/images/devices/samsung-s25-plus.png', is_sold_out: true },
    { slug: 'samsung-s25', name: 'Samsung Galaxy S25 5G', brand: 'samsung', tag: '5G Phone', rrp: 3999, monthly_price: 167, image_url: '/images/devices/samsung-s25.png', is_sold_out: true },

    // Oppo (7)
    { slug: 'oppo-a6t', name: 'Oppo A6T 5G', brand: 'oppo', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/oppo-a6t.png', is_sold_out: true },
    { slug: 'oppo-reno15', name: 'Oppo Reno 15 5G', brand: 'oppo', tag: '5G Phone', rrp: 1999, monthly_price: 84, image_url: '/images/devices/oppo-reno15.png', is_sold_out: true },
    { slug: 'oppo-reno15-pro', name: 'Oppo Reno 15 Pro 5G', brand: 'oppo', tag: '5G Phone', rrp: 2999, monthly_price: 125, image_url: '/images/devices/oppo-reno15-pro.png', is_sold_out: true },
    { slug: 'oppo-find-x9-pro', name: 'OPPO Find X9 Pro 5G', brand: 'oppo', tag: 'New 5G Phone', rrp: 5099, monthly_price: 213, image_url: '/images/devices/oppo-find-x9-pro.png', is_sold_out: true },
    { slug: 'oppo-find-x8-pro', name: 'Oppo Find X8 Pro 5G', brand: 'oppo', tag: 'New 5G Phone', rrp: 4999, monthly_price: 209, image_url: '/images/devices/oppo-find-x8-pro.png', is_sold_out: true },
    { slug: 'oppo-a3-pro', name: 'Oppo A3 Pro 5G', brand: 'oppo', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/oppo-a3-pro.png', is_sold_out: true },
    { slug: 'oppo-find-n3-flip', name: 'Oppo Find N3 Flip 5G', brand: 'oppo', tag: '5G Phone', rrp: 4399, monthly_price: 184, image_url: '/images/devices/oppo-find-n3-flip.png', is_sold_out: true },

    // Vivo (8)
    { slug: 'vivo-y31', name: 'Vivo Y31 5G', brand: 'vivo', tag: 'New 5G Phone', rrp: 1399, monthly_price: 59, image_url: '/images/devices/vivo-y31.png', is_sold_out: true },
    { slug: 'vivo-x300-pro', name: 'Vivo X300 Pro 5G', brand: 'vivo', tag: '5G Phone', rrp: 4699, monthly_price: 196, image_url: '/images/devices/vivo-x300-pro.png', is_sold_out: true },
    { slug: 'vivo-v60', name: 'Vivo V60 5G', brand: 'vivo', tag: 'New 5G Phone', rrp: 2399, monthly_price: 100, image_url: '/images/devices/vivo-v60.png', is_sold_out: true },
    { slug: 'vivo-x-fold5', name: 'Vivo X Fold5 5G', brand: 'vivo', tag: '5G Phone', rrp: 6999, monthly_price: 292, image_url: '/images/devices/vivo-x-fold5.png', is_sold_out: true },
    { slug: 'vivo-x200-fe', name: 'Vivo X200 FE 5G', brand: 'vivo', tag: '5G Phone', rrp: 3199, monthly_price: 134, image_url: '/images/devices/vivo-x200-fe.png', is_sold_out: true },
    { slug: 'vivo-y29t', name: 'Vivo Y29T 5G', brand: 'vivo', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/vivo-y29t.png', is_sold_out: true },
    { slug: 'vivo-v40-lite', name: 'Vivo V40 Lite 5G', brand: 'vivo', tag: 'New 5G Phone', rrp: 1299, monthly_price: 55, image_url: '/images/devices/vivo-v40-lite.png', is_sold_out: true },
    { slug: 'vivo-y28s', name: 'Vivo Y28s 5G', brand: 'vivo', tag: 'New 5G Phone', rrp: 799, monthly_price: 34, image_url: '/images/devices/vivo-y28s.png', is_sold_out: true },

    // Others (35)
    { slug: 'xiaomi-redmi-note15-pro-plus', name: 'Xiaomi Redmi Note15 Pro+ 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1899, monthly_price: 80, image_url: '/images/devices/xiaomi-redmi-note15-pro-plus.png', is_sold_out: true },
    { slug: 'xiaomi-redmi-note15-pro', name: 'Xiaomi Redmi Note15 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1699, monthly_price: 71, image_url: '/images/devices/xiaomi-redmi-note15-pro.png', is_sold_out: true },
    { slug: 'nubia-air', name: 'Nubia Air 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/nubia-air.png', is_sold_out: true },
    { slug: 'honor-magic8-pro', name: 'Honor Magic8 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 5199, monthly_price: 217, image_url: '/images/devices/honor-magic8-pro.png', is_sold_out: true },
    { slug: 'xiaomi-15t-pro', name: 'Xiaomi 15T Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 2999, monthly_price: 125, image_url: '/images/devices/xiaomi-15t-pro.png', is_sold_out: true },
    { slug: 'honor-x9d', name: 'Honor X9d 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1699, monthly_price: 71, image_url: '/images/devices/honor-x9d.png', is_sold_out: true },
    { slug: 'honor-pad-10', name: 'Honor Pad 10 5G', brand: 'others', tag: 'New', rrp: 1799, monthly_price: 75, image_url: '/images/devices/honor-pad-10.png', is_sold_out: true },
    { slug: 'honor-400-smart', name: 'Honor 400 Smart 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/honor-400-smart.png', is_sold_out: true },
    { slug: 'honor-magic-v5', name: 'Honor Magic V5 5G', brand: 'others', tag: '5G Phone', rrp: 5999, monthly_price: 250, image_url: '/images/devices/honor-magic-v5.png', is_sold_out: true },
    { slug: 'honor-400-pro', name: 'Honor 400 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 2399, monthly_price: 100, image_url: '/images/devices/honor-400-pro.png', is_sold_out: true },
    { slug: 'honor-400', name: 'Honor 400 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1899, monthly_price: 80, image_url: '/images/devices/honor-400.png', is_sold_out: true },
    { slug: 'samsung-tab-s10-fe', name: 'Samsung Galaxy Tab S10 FE 5G', brand: 'others', tag: '5G', rrp: 2699, monthly_price: 113, image_url: '/images/devices/samsung-tab-s10-fe.png', is_sold_out: true },
    { slug: 'realme-14-pro', name: 'Realme 14 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1799, monthly_price: 75, image_url: '/images/devices/realme-14-pro.png', is_sold_out: true },
    { slug: 'nubia-neo-3-gt', name: 'Nubia Neo 3 GT 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1199, monthly_price: 50, image_url: '/images/devices/nubia-neo-3-gt.png', is_sold_out: true },
    { slug: 'ipad-air-13-cellular', name: 'Apple iPad Air 13 M3 Cellular', brand: 'others', tag: 'New', rrp: 4399, monthly_price: 184, image_url: '/images/devices/ipad-air-13-cellular.png', is_sold_out: true },
    { slug: 'ipad-air-13-wifi', name: 'Apple iPad Air 13 M3 WiFi', brand: 'others', tag: 'New', rrp: 3699, monthly_price: 155, image_url: '/images/devices/ipad-air-13-wifi.png', is_sold_out: true },
    { slug: 'ipad-air-11-cellular', name: 'Apple iPad Air 11 M3 Cellular', brand: 'others', tag: 'New', rrp: 3499, monthly_price: 146, image_url: '/images/devices/ipad-air-11-cellular.png', is_sold_out: true },
    { slug: 'ipad-air-11-wifi', name: 'Apple iPad Air 11 M3 WiFi', brand: 'others', tag: 'New', rrp: 2799, monthly_price: 117, image_url: '/images/devices/ipad-air-11-wifi.png', is_sold_out: true },
    { slug: 'ipad-11-cellular', name: 'Apple iPad 11th Gen Cellular', brand: 'others', tag: 'New', rrp: 2299, monthly_price: 96, image_url: '/images/devices/ipad-11-cellular.png', is_sold_out: true },
    { slug: 'ipad-11-wifi', name: 'Apple iPad 11th Gen WiFi', brand: 'others', tag: 'New', rrp: 1599, monthly_price: 67, image_url: '/images/devices/ipad-11-wifi.png', is_sold_out: true },
    { slug: 'xiaomi-15-ultra', name: 'Xiaomi 15 Ultra 5G', brand: 'others', tag: 'New 5G Phone', rrp: 5199, monthly_price: 217, image_url: '/images/devices/xiaomi-15-ultra.png', is_sold_out: true },
    { slug: 'realme-14x', name: 'Realme 14x 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/realme-14x.png', is_sold_out: true },
    { slug: 'asus-rog-phone-9-pro', name: 'Asus ROG Phone 9 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 4999, monthly_price: 209, image_url: '/images/devices/asus-rog-phone-9-pro.png', is_sold_out: true },
    { slug: 'honor-x9c', name: 'Honor X9c 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1699, monthly_price: 71, image_url: '/images/devices/honor-x9c.png', is_sold_out: true },
    { slug: 'realme-13', name: 'Realme 13 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1199, monthly_price: 50, image_url: '/images/devices/realme-13.png', is_sold_out: true },
    { slug: 'realme-12-pro-plus', name: 'Realme 12 Pro+ 5G', brand: 'others', tag: 'New 5G Phone', rrp: 2099, monthly_price: 88, image_url: '/images/devices/realme-12-pro-plus.png', is_sold_out: true },
    { slug: 'xiaomi-mix-flip', name: 'Xiaomi Mix Flip 5G', brand: 'others', tag: 'New 5G Phone', rrp: 4999, monthly_price: 209, image_url: '/images/devices/xiaomi-mix-flip.png', is_sold_out: true },
    { slug: 'realme-13-pro-plus', name: 'Realme 13 Pro+ 5G', brand: 'others', tag: 'New 5G Phone', rrp: 2099, monthly_price: 88, image_url: '/images/devices/realme-13-pro-plus.png', is_sold_out: true },
    { slug: 'honor-magic-v2', name: 'Honor Magic V2', brand: 'others', tag: '5G Phone', rrp: 6999, monthly_price: 292, image_url: '/images/devices/honor-magic-v2.png', is_sold_out: true },
    { slug: 'honor-200-pro', name: 'Honor 200 Pro 5G', brand: 'others', tag: 'New 5G Phone', rrp: 2499, monthly_price: 105, image_url: '/images/devices/honor-200-pro.png', is_sold_out: true },
    { slug: 'honor-200', name: 'Honor 200 5G', brand: 'others', tag: 'New 5G Phone', rrp: 1599, monthly_price: 67, image_url: '/images/devices/honor-200.png', is_sold_out: true },
    { slug: 'redmi-13c', name: 'Redmi 13C 5G', brand: 'others', tag: 'New 5G Phone', rrp: 999, monthly_price: 42, image_url: '/images/devices/redmi-13c.png', is_sold_out: true },
    { slug: 'realme-12', name: 'Realme 12 5G', brand: 'others', tag: '5G Phone', rrp: 1299, monthly_price: 55, image_url: '/images/devices/realme-12.png', is_sold_out: true },
    { slug: 'honor-90-lite', name: 'Honor 90 Lite 5G', brand: 'others', tag: '5G Phone', rrp: 1099, monthly_price: 46, image_url: '/images/devices/honor-90-lite.png', is_sold_out: true },
  ];

  let deviceCount = 0;
  for (let i = 0; i < devicesData.length; i++) {
    const d = devicesData[i];
    const device = deviceRepo.create({
      slug: d.slug,
      name: d.name,
      brand_id: brands[d.brand].id,
      tag: d.tag,
      rrp: d.rrp,
      monthly_price: d.monthly_price,
      image_url: d.image_url,
      is_sold_out: d.is_sold_out,
      sort_order: i + 1,
    });
    await deviceRepo.save(device);
    deviceCount++;
  }
  console.log(`Seeded ${deviceCount} devices`);

  // ===== BANNERS =====
  const bannersData = [
    { title: 'ToneWow Banner 1', desktop_image: '/images/banners/banner1-desktop.jpg', mobile_image: '/images/banners/banner1-mobile.jpg', sort_order: 1 },
    { title: 'ToneWow Banner 2', desktop_image: '/images/banners/banner2-desktop.jpg', mobile_image: '/images/banners/banner2-mobile.jpg', sort_order: 2 },
    { title: 'ToneWow Banner 3', desktop_image: '/images/banners/banner3-desktop.jpg', mobile_image: '/images/banners/banner3-mobile.jpg', sort_order: 3 },
  ];

  for (const b of bannersData) {
    const banner = bannerRepo.create(b);
    await bannerRepo.save(banner);
  }
  console.log(`Seeded ${bannersData.length} banners`);

  // ===== PLANS =====
  const plansData = [
    {
      slug: 'lite', name: 'Lite', tagline: 'Built for everyday heroes',
      price: 19.50, features: ['20GB Data', 'PA Takaful RM30,000'],
      sub_features: null, extras: null, dataplan: null, gradient: 'lite', sort_order: 1,
    },
    {
      slug: 'pro', name: 'Pro', tagline: 'Because this is protection with power',
      price: 49.50, features: ['WOW35 5G Data Plan for the 1st month'],
      sub_features: ['70GB Data', '5GB Hotspot', '3,000 Minutes (All Net)'],
      extras: ['PA Takaful RM30,000', 'Life Insurance RM4,000'],
      dataplan: 'WOW35 5G Data Plan', gradient: 'pro', sort_order: 2,
    },
    {
      slug: 'biz', name: 'Biz', tagline: 'You deserve a line, as serious as your ambition',
      price: 128, features: ['WOW60 5G Data Plan for the 1st month'],
      sub_features: ['225GB Data', '15GB Hotspot', '3,000 Minutes (All Net)'],
      extras: ['PA Takaful RM50,000', 'Life Insurance RM4,000'],
      dataplan: 'WOW60 5G Data Plan', gradient: 'biz', sort_order: 3,
    },
  ];

  for (const p of plansData) {
    const plan = planRepo.create(p);
    await planRepo.save(plan);
  }
  console.log(`Seeded ${plansData.length} plans`);

  console.log('\n✅ Database seeded successfully!');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
