import { NextRequest, NextResponse } from 'next/server';

const LEGACY_API = 'https://www.tonewow.net/tgpayment';

const PLAN_MAP: Record<number, { category: string; price: number; label: string }> = {
  1: { category: 'PREMIUM', price: 988, label: 'PREMIUM' },
  2: { category: 'VIP', price: 2298, label: 'VIP' },
  3: { category: 'VVIP', price: 3088, label: 'VVIP' },
};

function formatPhone(phoneNo: string): string {
  let local = phoneNo.startsWith('60') ? '0' + phoneNo.substring(2) : phoneNo;
  if (local.length === 11) return `${local.substring(0, 3)}-${local.substring(3, 7)} ${local.substring(7)}`;
  if (local.length === 12) return `${local.substring(0, 4)}-${local.substring(4, 8)} ${local.substring(8)}`;
  return local;
}

export async function GET(req: NextRequest) {
  const digits = req.nextUrl.searchParams.get('digits');
  if (!digits || digits.length < 1) {
    return NextResponse.json({ data: [], total: 0, message: 'Please provide digits to search' });
  }

  const results: any[] = [];
  const priority: Record<string, number> = { VVIP: 0, VIP: 1, PREMIUM: 2 };

  for (const planId of [1, 2, 3]) {
    try {
      const url = `${LEGACY_API}/getVipPremiumNumber?planId=${planId}&phoneNo=${encodeURIComponent(digits)}`;
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://shop.tonewow.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      const data = await res.json();
      if (data.systemCode === '0' && Array.isArray(data.data) && data.data.length > 0) {
        const plan = PLAN_MAP[planId];
        for (const phoneNo of data.data) {
          results.push({
            phoneNo,
            displayNo: formatPhone(phoneNo),
            planId,
            category: plan.category,
            price: plan.price,
            label: plan.label,
          });
        }
      }
    } catch { /* skip failed plan */ }
  }

  results.sort((a, b) => (priority[a.category] ?? 99) - (priority[b.category] ?? 99));

  return NextResponse.json({ data: results, total: results.length });
}
