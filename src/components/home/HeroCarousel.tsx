'use client';

import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Pagination, Navigation, EffectFade } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-fade';
import 'swiper/css/pagination';
import 'swiper/css/navigation';
import type { Banner } from '@/types';

interface Props {
  banners: Banner[];
}

export default function HeroCarousel({ banners }: Props) {
  return (
    <section className="hero-section">
      <Swiper
        className="hero-carousel"
        modules={[Autoplay, Pagination, Navigation, EffectFade]}
        loop={true}
        autoplay={{ delay: 5000, disableOnInteraction: false }}
        pagination={{ clickable: true }}
        navigation
        effect="fade"
        fadeEffect={{ crossFade: true }}
      >
        {banners.map((banner) => (
          <SwiperSlide key={banner.id} className="hero-slide" style={{ padding: 0, height: 'auto' }}>
            <picture>
              <source media="(max-width: 768px)" srcSet={banner.mobile_image} />
              <img
                src={banner.desktop_image}
                alt={banner.title || 'tone wow Banner'}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </picture>
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  );
}
