export { dynamic, GET, POST, PUT, PATCH, DELETE } from '@/app/api/admin/[...path]/route';
// Keep this literal: Vercel statically reads route execution limits.
export const maxDuration = 120;
