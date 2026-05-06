export function formatRM(amount: number): string {
  return 'RM' + Number(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPhoneNumber(phoneNo: string): string {
  let local = phoneNo.startsWith('60') ? '0' + phoneNo.substring(2) : phoneNo;
  if (local.length === 11) {
    return `${local.substring(0, 3)}-${local.substring(3, 7)} ${local.substring(7)}`;
  }
  if (local.length === 12) {
    return `${local.substring(0, 4)}-${local.substring(4, 8)} ${local.substring(8)}`;
  }
  return local;
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
