export interface Brand {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}

export interface Device {
  id: number;
  slug: string;
  name: string;
  brand: Brand;
  brand_id: number;
  tag: string;
  rrp: number;
  monthly_price: number;
  image_url: string;
  is_sold_out: boolean;
  is_api_device: boolean;
  external_id?: string;
  sort_order: number;
}

export interface DeviceResponse {
  data: Device[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface Banner {
  id: number;
  title: string;
  desktop_image: string;
  mobile_image: string;
  link_url?: string;
  sort_order: number;
}

export interface Plan {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  price: number;
  features: string[];
  sub_features?: string[];
  extras?: string[];
  dataplan?: string;
  gradient: string;
  sort_order: number;
}

export interface CartItem {
  id: string;
  type: 'sim' | 'device';
  plan?: string;
  number?: string;
  numberType?: string;
  category?: string;
  price: number;
  quantity: number;
  simType?: string;
  name: string;
  description?: string;
  addedAt: string;
}

export interface NumberResult {
  phoneNo: string;
  displayNo: string;
  planId: number;
  category: string;
  price: number;
  label: string;
}

export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items: any[];
  total: number;
  status: string;
  created_at: string;
}
