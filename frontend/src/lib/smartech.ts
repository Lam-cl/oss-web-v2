// src/lib/smartech.ts
declare global {
  interface Window {
    smartech?: (...args: any[]) => void;
  }
}

export function smartechDispatch(event: string, payload: Record<string, any>) {
  if (typeof window === 'undefined' || !window.smartech) return;
  window.smartech('dispatch', event, payload);
}

export function smartechIdentify(id: string) {
  if (typeof window === 'undefined' || !window.smartech) return;
  window.smartech('identify', id);
}

export function smartechContact(listId: string, data: Record<string, any>) {
  if (typeof window === 'undefined' || !window.smartech) return;
  window.smartech('contact', listId, data);
}

export type SimOrderData = {
  icNumber: string;
  name: string;
  email: string;
  mobile: string;
  city: string;
  state: string;
  postcode: string;
  simType: string;
  packageType: string;
  totalAmount: number;
  paymentMethod: string;
  addressOne: string;
  addressTwo: string;
};

function sendSimOrderEvent(eventName: string, d: SimOrderData) {

  if (!d.icNumber) return; // pk^ic_number wajib ada
  smartechContact('23', {
    'pk^ic_number': d.icNumber,
    NAME: d.name,
    email: d.email,
    mobile: d.mobile,
    CITY: d.city,
    STATE: d.state,
    POSTCODE: d.postcode,
  });
  smartechIdentify(d.icNumber);
  smartechDispatch(eventName, {
    ic_number: d.icNumber,
    name: d.name,
    email: d.email,
    mobile: d.mobile,
    city: d.city,
    state: d.state,
    postcode: d.postcode,
    sim_type: d.simType,
    package_type: d.packageType,
    total_amount_txt: d.totalAmount,
    total_amount: d.totalAmount,
    payment_method: d.paymentMethod,
    address_one: d.addressOne,
    address_two: d.addressTwo,
  });
}

export const trackSimPurchaseInitiated = (d: SimOrderData) =>
  sendSimOrderEvent('online sim purchase initiated', d);

export const trackSimPurchaseSuccess = (d: SimOrderData) =>
  sendSimOrderEvent('online sim purchase success', d);