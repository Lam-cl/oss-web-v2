export type PublicationChangeState = 'clean' | 'dirty' | 'unknown';

export type VersionedDocument<T = unknown> = {
  key: string;
  revision: number;
  value: T;
  createdAt: string;
  updatedAt: string;
};

export type StoredMedia = {
  mediaId: string;
  catalogueId: string;
  objectKey: string;
  originalName: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  sha256: string;
  order: number;
  assignment: string;
  visibility: 'draft' | 'published';
  createdAt: string;
};

export type DataApiError = {
  error: { code: string; message: string; requestId: string };
};
