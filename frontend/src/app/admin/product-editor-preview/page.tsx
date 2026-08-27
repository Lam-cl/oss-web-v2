'use client';

import { useState } from 'react';
import UnifiedProductEditor from '@/components/admin/UnifiedProductEditor';
import type {
  UnifiedProductEditorExistingPhoto,
  UnifiedProductEditorPendingPhoto,
} from '@/components/admin/UnifiedProductEditor';
import type { ProductEditorSpec } from '@/lib/admin/productEditor';

const previewModel: ProductEditorSpec = {
  details: {
    title: 'BASICS Oversized Everyday Tee',
    category: 'Apparel',
    description: 'A relaxed heavyweight cotton tee designed for comfortable everyday wear.',
    price: 59,
  },
  choices: [
    {
      key: 'choice-color',
      name: 'Color',
      values: [
        { key: 'value-black', label: 'Midnight Black', retired: false },
        { key: 'value-cream', label: 'Warm Cream', retired: false },
      ],
    },
    {
      key: 'choice-size',
      name: 'Size',
      values: [
        { key: 'value-s', label: 'S', retired: false },
        { key: 'value-m', label: 'M', retired: false },
        { key: 'value-l', label: 'L', retired: false },
      ],
    },
  ],
  combinations: [
    { valueKeys: ['value-black', 'value-s'], price: 59, inventory: 14, sku: 'BSC-BLK-S' },
    { valueKeys: ['value-black', 'value-m'], price: 59, inventory: 22, sku: 'BSC-BLK-M' },
    { valueKeys: ['value-black', 'value-l'], price: 59, inventory: 9, sku: 'BSC-BLK-L' },
    { valueKeys: ['value-cream', 'value-s'], price: 59, inventory: 11, sku: 'BSC-CRM-S' },
    { valueKeys: ['value-cream', 'value-m'], price: 59, inventory: 18, sku: 'BSC-CRM-M' },
    { valueKeys: ['value-cream', 'value-l'], price: 59, inventory: 7, sku: 'BSC-CRM-L' },
  ],
  existingImages: [
    { imageId: 900001, order: 0, assignment: 'value-black', remove: false },
    { imageId: 900002, order: 1, assignment: 'value-cream', remove: false },
  ],
};

const blackTeePreview =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'%3E%3Crect width='800' height='800' fill='%23eeeae3'/%3E%3Cpath d='M270 190 355 145h90l85 45 115 75-65 120-80-45v300H300V340l-80 45-65-120z' fill='%23202020'/%3E%3Ctext x='400' y='730' text-anchor='middle' font-family='Arial' font-size='32' fill='%236b665f'%3EBASICS / MIDNIGHT BLACK%3C/text%3E%3C/svg%3E";
const creamTeePreview =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 800'%3E%3Crect width='800' height='800' fill='%23d9d4cb'/%3E%3Cpath d='M270 190 355 145h90l85 45 115 75-65 120-80-45v300H300V340l-80 45-65-120z' fill='%23f5ebd7' stroke='%23c9bda8' stroke-width='5'/%3E%3Ctext x='400' y='730' text-anchor='middle' font-family='Arial' font-size='32' fill='%236b665f'%3EBASICS / WARM CREAM%3C/text%3E%3C/svg%3E";

const previewPhotos: UnifiedProductEditorExistingPhoto[] = [
  {
    imageId: 900001,
    url: blackTeePreview,
    alt: 'BASICS oversized tee in Midnight Black',
    assignment: 'value-black',
    order: 0,
  },
  {
    imageId: 900002,
    url: creamTeePreview,
    alt: 'BASICS oversized tee in Warm Cream',
    assignment: 'value-cream',
    order: 1,
  },
];

export default function ProductEditorPreviewPage() {
  const [model, setModel] = useState<ProductEditorSpec>(previewModel);
  const [existingPhotos, setExistingPhotos] = useState<UnifiedProductEditorExistingPhoto[]>(previewPhotos);
  const [pendingPhotos, setPendingPhotos] = useState<UnifiedProductEditorPendingPhoto[]>([]);
  const [confirmation, setConfirmation] = useState('Try any field safely. This demo stays only in your browser.');

  const handlePhotosChange = (
    nextExistingPhotos: UnifiedProductEditorExistingPhoto[],
    nextPendingPhotos: UnifiedProductEditorPendingPhoto[],
  ) => {
    setExistingPhotos(nextExistingPhotos);
    setPendingPhotos(nextPendingPhotos);
    setConfirmation('Preview updated locally. Nothing has been saved.');
  };

  const handlePreviewSave = () => {
    setConfirmation('Preview confirmed — nothing was saved or sent anywhere.');
  };

  const handlePreviewReset = () => {
    setModel(previewModel);
    setExistingPhotos(previewPhotos);
    setPendingPhotos([]);
    setConfirmation('Preview reset to the approved BASICS fixture. Nothing was saved.');
  };

  return (
    <main style={{ minHeight: '100vh', background: '#f4f2ed', padding: '20px clamp(12px, 3vw, 40px) 48px' }}>
      <section
        aria-label="Preview safety notice"
        style={{
          maxWidth: 1180,
          margin: '0 auto 16px',
          padding: '14px 18px',
          border: '1px solid #b9a45d',
          borderRadius: 12,
          background: '#fff8d9',
          color: '#493d17',
          boxShadow: '0 8px 24px rgba(50, 42, 18, 0.08)',
        }}
      >
        <strong style={{ display: 'block', fontSize: 16 }}>UI Preview only · No data will be saved</strong>
        <span aria-live="polite" style={{ display: 'block', marginTop: 4 }}>{confirmation}</span>
      </section>

      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <UnifiedProductEditor
          editorKey="preview-product"
          model={model}
          existingPhotos={existingPhotos}
          pendingPhotos={pendingPhotos}
          onModelChange={setModel}
          onPhotosChange={handlePhotosChange}
          onSave={handlePreviewSave}
          onCancel={handlePreviewReset}
        />
      </div>
    </main>
  );
}
