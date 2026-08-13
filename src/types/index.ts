// Shared TypeScript types used across routes and services.

export type UserRole = 'SELLER' | 'CUSTOMER';
export type ProductStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
}

export interface Product {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price_minor: number;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  customer_id: string;
  status: OrderStatus;
  total_minor: number;
  created_at: string;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  unit_price_minor: number;
}

// Augment Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
