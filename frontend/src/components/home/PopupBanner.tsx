'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

const STORAGE_KEY = 'skmm-popup-dismissed-date';
const POPUP_IMAGE_SRC = '/images/banners/skmm-banner.png';
const POPUP_LINK =
  'https://skmm.gov.my/ms/media/announcements/notice-commission-determination-on-the-mandato-1';

export default function PopupBanner() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const dismissedDate = localStorage.getItem(STORAGE_KEY);
    const today = new Date().toDateString();

    // Popup akan muncul semula esok kalau user dah tutup hari ni
    if (dismissedDate !== today) {
      setShow(true);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, new Date().toDateString());
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black font-bold hover:bg-white"
          aria-label="Close"
        >
          ✕
        </button>

        <a href={POPUP_LINK} target="_blank" rel="noopener noreferrer">
          <Image
            src={POPUP_IMAGE_SRC}
            alt="Notis SKMM - Pendaftaran pelanggan baru"
            width={1600}
            height={900}
            className="w-full h-auto"
            priority
          />
        </a>
      </div>
    </div>
  );
}