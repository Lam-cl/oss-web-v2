'use client';

import { getImageProps } from 'next/image';
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

// Intrinsic size of the hero artwork (all current desktop banners are 1440x480).
// width/height reserve the 3:1 aspect ratio before the image loads (no layout shift).
// If a mobile_image with a different aspect ratio is ever used, give its <source>
// its own width/height here.
const HERO_WIDTH = 1440;
const HERO_HEIGHT = 480;
const MOBILE_MEDIA = '(max-width: 768px)';

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
        {banners.map((banner, index) => {
          const common = {
            alt: banner.title || 'tone wow Banner',
            width: HERO_WIDTH,
            height: HERO_HEIGHT,
            sizes: '100vw',
            // Banners carry text; 85 keeps it crisp (default 75 softens small type).
            quality: 85,
            // Only the first slide is the LCP candidate; the rest load lazily.
            priority: index === 0,
          };
          const {
            props: { srcSet: mobileSrcSet, sizes: mobileSizes, width: mobileWidth, height: mobileHeight },
          } = getImageProps({ ...common, src: banner.mobile_image });
          const { props: desktopProps } = getImageProps({
            ...common,
            src: banner.desktop_image,
            style: { width: '100%', height: 'auto', display: 'block' },
          });
          return (
            <SwiperSlide key={banner.id} className="hero-slide" style={{ padding: 0, height: 'auto' }}>
              <picture>
                <source
                  media={MOBILE_MEDIA}
                  srcSet={mobileSrcSet}
                  sizes={mobileSizes}
                  width={mobileWidth}
                  height={mobileHeight}
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- optimized props (incl. alt) come from next/image getImageProps */}
                <img {...desktopProps} />
              </picture>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </section>
  );
}
