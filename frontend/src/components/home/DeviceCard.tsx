'use client';

import { useRouter } from 'next/navigation';
import type { Device } from '@/types';

interface Props {
  device: Device;
}

export default function DeviceCard({ device }: Props) {
  const router = useRouter();

  const handleClick = () => {
    if (!device.is_sold_out) {
      router.push(`/devices/${device.slug}`);
    }
  };

  return (
    <div
      className={`device-card-cd ${device.is_sold_out ? 'sold-out' : ''}`}
      onClick={handleClick}
      style={device.is_sold_out ? {} : { cursor: 'pointer' }}
    >
      {/* Device Image */}
      <div className="device-card-img">
        <img src={device.image_url} alt={device.name} loading="lazy" />
      </div>
      {/* Device Info */}
      <div className="device-card-info">
        {device.tag && <span className="device-tag">{device.tag}</span>}
        <h4 className="device-card-name">{device.name}</h4>
        <div className="device-card-price">RM{device.monthly_price}/mo</div>
        {!device.is_sold_out ? (
          <button
            className="btn btn-primary device-buy-btn"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/devices/${device.slug}`);
            }}
          >
            Buy Now
          </button>
        ) : (
          <span className="device-sold-out-badge">Sold Out</span>
        )}
      </div>
    </div>
  );
}
