'use client';

import { useEffect, useState } from 'react';
import { detectDeviceType, openToneWowAppWithRegistration, type DeviceType } from './appLauncher';

type RegisterActionsProps = {
  clipboardText: string;
};

const buttonStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 54,
  borderRadius: 999,
  color: '#fff',
  font: 'inherit',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 10px 24px rgba(45, 98, 255, 0.24)',
} as const;

export default function RegisterActions({ clipboardText }: RegisterActionsProps) {
  const [deviceType, setDeviceType] = useState<DeviceType>('other');

  useEffect(() => {
    setDeviceType(detectDeviceType());
  }, []);

  const openAppThenFallback = async () => {
    await openToneWowAppWithRegistration(clipboardText, deviceType);
  };

  return (
    <button
      type="button"
      onClick={openAppThenFallback}
      style={{
        ...buttonStyle,
        width: '100%',
        marginBottom: 24,
        border: 0,
        background: 'linear-gradient(135deg, #2d62ff 0%, #1e4fd6 100%)',
      }}
    >
      Open tone wow 2.0 App
    </button>
  );
}
