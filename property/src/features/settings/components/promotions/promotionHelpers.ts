import type { Promotion } from '@/shared/types/types';

export interface PromotionFormData {
  code: string;
  amount: string;
  type: 'fixed' | 'percentage' | 'full_month';
  scope: 'business' | 'property' | 'tenant';
  property_id?: string | null;
  tenant_id?: string | null;
  description: string;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

export function formatPromoAmount(promo: Promotion): string {
  switch (promo.type) {
    case 'full_month':
      return 'Full Month Rent';
    case 'percentage':
      return `${promo.amount}% Discount`;
    default:
      return `${promo.amount?.toLocaleString()} Fixed`;
  }
}

export function calculateAdjustment(promo: Promotion, rentAmount: number): number {
  switch (promo.type) {
    case 'full_month':
      return rentAmount;
    case 'percentage': {
      const pct = (promo.amount || 0) / 100;
      return rentAmount * pct;
    }
    default:
      return promo.amount || 0;
  }
}
