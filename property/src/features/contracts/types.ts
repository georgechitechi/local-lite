export type ContractAction =
  | 'pause'
  | 'resume'
  | 'terminate'
  | 'batch_pause'
  | 'batch_resume';

export interface Contract {
  id: string;
  status: string;
  start_date?: string;
  end_date?: string;
  rent_amount?: number;
  renewal_reminder_sent_at?: string;
  renewal_token_expires_at?: string;
  updated_at?: string;
  metadata?: any;
  propertyName?: string;
  houseNumber?: string;
  tenantName?: string;
  tenantEmail?: string;
  tenantStatus?: string;
  daysUntilExpiry: number | null;
  tenant?: {
    name?: string;
    email?: string;
    phone?: string;
    status?: string;
  };
  house?: {
    house_number?: string;
    property?: {
      name?: string;
    };
  };
  isPaused?: boolean;
}

export interface Summary {
  total: number;
  expiringSoon: number;
  byStatus: Record<string, number>;
}
