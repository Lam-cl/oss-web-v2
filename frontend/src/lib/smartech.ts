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



/* ── Merchandise: product view, add to cart, checkout ── */
export type MerchItem = {
  prid: string;
  image: string;
  prqt: number;
  productName: string;
  brand: string;
  colour: string;
  price: number;
  size?: string;
  stockAvailability: string;
};

const itemPayload = (p: MerchItem) => ({
  prid: p.prid,
  image: p.image,
  prqt: p.prqt,
  Product_name: p.productName,
  brand: p.brand,
  colour: p.colour,
  price: p.price,
  price_txt: p.price,
  size: p.size ?? '',
  Stock_Availability: p.stockAvailability,
});

export const trackProductView = (p: MerchItem) =>
  smartechDispatch('product View', itemPayload(p));

export const trackAddToCart = (p: MerchItem) =>
  smartechDispatch('add to cart', itemPayload(p));

export const trackCheckout = (items: MerchItem[], amount: number) =>
  smartechDispatch('checkout', {
    amount,
    amount_txt: amount,
    total_prqt: items.reduce((n, i) => n + i.prqt, 0),
    items: items.map(itemPayload),
  });

/* ── Merchandise purchase (list '24') ── */
export type MerchOrderData = {
  icNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  city: string;
  state: string;
  postcode: string;
  totalAmount: number;
  paymentMethod: string;
  addressOne: string;
  addressTwo: string;
};

const MERCH_INITIATED_EVENT = 'online merchandise purchase initiated';
const MERCH_SUCCESS_EVENT = 'online merchandise purchase success';

function sendMerchOrderEvent(eventName: string, d: MerchOrderData) {
    
  if (!d.icNumber) return;
  smartechContact('24', {
    'pk^ic_number': d.icNumber,
    FIRST_NAME: d.firstName,
    LAST_NAME: d.lastName,
    email: d.email,
    mobile: d.mobile,
    CITY: d.city,
    STATE: d.state,
    POSTCODE: d.postcode,
  });
  smartechIdentify(d.icNumber);
  smartechDispatch(eventName, {
    ic_number: d.icNumber,
    name: `${d.firstName} ${d.lastName}`.trim(),
    first_name: d.firstName,
    last_name: d.lastName,
    email: d.email,
    mobile: d.mobile,
    city: d.city,
    state: d.state,
    postcode: d.postcode,
    sim_type: '',
    package_type: '',
    total_amount_txt: d.totalAmount,
    total_amount: d.totalAmount,
    payment_method: d.paymentMethod,
    address_one: d.addressOne,
    address_two: d.addressTwo,
  });
}

export const trackMerchPurchaseInitiated = (d: MerchOrderData) =>
  sendMerchOrderEvent(MERCH_INITIATED_EVENT, d);

export const trackMerchPurchaseSuccess = (d: MerchOrderData) =>
  sendMerchOrderEvent(MERCH_SUCCESS_EVENT, d);