const PICKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function pickupAddress(date: string) {
  if (!PICKUP_DATE.test(date)) throw new Error('Please select a valid collection date.');
  return `Self Pick Up | Collection date: ${date}`;
}

export function pickupDateFromAddress(address: unknown) {
  if (typeof address !== 'string') return '';
  return address.match(/Self Pick Up \| Collection date: (\d{4}-\d{2}-\d{2})/i)?.[1] || '';
}

export function pickupStatus(orderStatus: string) {
  const status = orderStatus.trim().toUpperCase();
  if (status === 'DELIVERED') return 'COMPLETED';
  if (status === 'PROCESSING') return 'READY_FOR_COLLECTION';
  if (status === 'PAID' || status === 'PENDING') return 'PENDING_COLLECTION';
  return status || 'UNKNOWN';
}

export function pickupBundleStatus(status: string) {
  if (status === 'COMPLETED') return 'DELIVERED';
  if (status === 'READY_FOR_COLLECTION') return 'PROCESSING';
  return 'PAID';
}

export function isPickupWeekday(date: string) {
  if (!PICKUP_DATE.test(date)) return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

export function pickupDateToLocalDate(date: string) {
  if (!PICKUP_DATE.test(date)) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function localDateToPickupDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Official 2026 Kuala Lumpur release: https://www.kabinet.gov.my/storage/2025/08/HKA-2026.pdf
// Extra Aidilfitri holiday: https://www.kabinet.gov.my/storage/2026/03/PUB-111_2026.pdf
// Wesak replacement: https://www.kabinet.gov.my/storage/2025/12/JTK_251231_153535.pdf
// Replacement holidays follow the Holidays Act 1951 (Act 369).
// ponytail: static official calendar; add the next official year before 2027 bookings open.
export const KUALA_LUMPUR_PUBLIC_HOLIDAYS = new Set([
  '2026-01-01', '2026-02-01', '2026-02-02',
  '2026-02-17', '2026-02-18', '2026-03-07', '2026-03-20',
  '2026-03-21', '2026-03-22', '2026-03-23', '2026-05-01',
  '2026-05-27', '2026-05-31', '2026-06-01', '2026-06-02',
  '2026-06-17', '2026-08-25', '2026-08-31', '2026-09-16',
  '2026-11-08', '2026-11-09', '2026-12-25',
]);

export function malaysiaDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isKualaLumpurWorkingDay(date: string) {
  return isPickupWeekday(date) && !KUALA_LUMPUR_PUBLIC_HOLIDAYS.has(date);
}

export function minimumPickupDate(orderDate: string, leadDays = 3) {
  const cursor = pickupDateToLocalDate(orderDate);
  if (!cursor) throw new Error('Invalid order date.');
  let completed = 0;
  while (completed < leadDays) {
    cursor.setDate(cursor.getDate() + 1);
    if (isKualaLumpurWorkingDay(localDateToPickupDate(cursor))) completed += 1;
  }
  return localDateToPickupDate(cursor);
}
