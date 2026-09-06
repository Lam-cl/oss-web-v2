import type { NextRequest } from 'next/server';
import { getAdminSession } from './admin/server';
import { merchandiseCheckoutPolicy } from './merchandiseCheckoutPolicy';

export async function readMerchandiseCheckoutPolicy(request: NextRequest) {
  // QA is an explicit operator setting, never enabled by the clock or a query parameter.
  const tester = process.env.MERCHANDISE_CHECKOUT_MODE?.trim().toLowerCase() === 'qa'
    ? Boolean(await getAdminSession(request)) : false;
  return merchandiseCheckoutPolicy(process.env, tester);
}
