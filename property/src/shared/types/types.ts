import type { Database } from './database.types';

type Tables = Database['public']['Tables'];

type DBRow<T extends keyof Tables> = Tables[T]['Row'];

export type DBBackupLog = DBRow<'backup_logs'>;
export type DBSchedule = DBRow<'schedules'>;
type DBBooking = DBRow<'bookings'>;
type DBBusiness = DBRow<'businesses'>;
export type DBBusinessShare = DBRow<'business_shares'>;
export type DBContract = DBRow<'contracts'>;
type DBExpense = DBRow<'expenses'>;
export type DBHouse = DBRow<'houses'>;
type DBPaymentMessage = DBRow<'payment_messages'>;
export type DBPaymentMessageReceipt = DBRow<'payment_message_receipts'>;
export type DBProperty = DBRow<'properties'>;
export type DBReceipt = DBRow<'receipts'> & { promotion_id?: string | null };
export type DBReceiptRefund = DBRow<'receipt_refunds'>;
export type DBReminderLog = DBRow<'reminder_logs'>;
export type DBSetting = DBRow<'settings'>;
export type DBTenant = DBRow<'tenants'>;
type DBMaintenanceRequest = DBRow<'maintenance_requests'>;
type DBPromotion = DBRow<'promotions'>;
export type DBProfile = DBRow<'profiles'>;
export type DBToken = DBRow<'tokens'>;
export type DBMessageTemplate = DBRow<'message_templates'>;
type DBApiKey = DBRow<'api_keys'>;
export type DBTransaction = DBRow<'transactions'>;

// Metadata fields that are often present in DB objects
interface SyncMetadata {
  created_at?: string | null;
  updated_at?: string | null;
  deleted?: boolean | null;
}

// =============================================
// AUDIT LOG
// =============================================
export interface AuditLogChange {
  old: any;
  new: any;
}

/**
 * A single audit log entry from the dedicated `audit_logs` table.
 */
export interface AuditLog extends Omit<DBRow<'audit_logs'>, 'action' | 'changes'> {
  action: 'insert' | 'update' | 'delete';
  changes: Record<string, AuditLogChange> | null;
  actor_name?: string | null;
}

/**
 * SyncedRow makes standard sync fields optional for locally persisted database rows.
 */
export type SyncedRow<T> = Omit<T, keyof SyncMetadata> & SyncMetadata;

// Business and Extended Interfaces
// Application Types mapping to SyncedRow DB types
export type BackupLog = SyncedRow<DBBackupLog>;
export type Schedule = SyncedRow<DBSchedule>;
export type BusinessShare = SyncedRow<DBBusinessShare>;
export type Expense = SyncedRow<DBExpense>;
export type House = SyncedRow<DBHouse>;
export type MaintenanceRequest = SyncedRow<DBMaintenanceRequest>;
export type PaymentMessageReceipt = SyncedRow<DBPaymentMessageReceipt>;
export type Property = SyncedRow<DBProperty>;
export type Receipt = SyncedRow<DBReceipt>;
export type ReceiptRefund = SyncedRow<DBReceiptRefund>;
export type Setting = SyncedRow<DBSetting>;
export type Promotion = SyncedRow<DBPromotion>;
export type Profile = SyncedRow<DBProfile>;
export type Token = SyncedRow<DBToken>;
export type MessageTemplate = SyncedRow<DBMessageTemplate>;
export type ApiKey = SyncedRow<DBApiKey>;
export type Transaction = SyncedRow<DBTransaction>;
export type GalleryImage = SyncedRow<DBRow<'gallery_images'>>;

export type Business = SyncedRow<DBBusiness> & {
  user_id?: string | null;
  isSharedWithMe?: boolean;
  isSharedByMe?: boolean;
  shareStatus?: string;
  shareId?: string;
  [key: string]: any;
};

export interface NewBusiness {
  name: string;
  phone: string;
  email: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: {
    api_enabled?: boolean;
    [key: string]: any;
  } | null;
}

export interface Errors {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface ConfirmDialog {
  visible: boolean;
  title: string;
  message: string;
  onConfirm: (() => void) | null;
  confirmText: string;
  showCancel: boolean;
  destructive: boolean;
}

export type PaymentMessage = SyncedRow<DBPaymentMessage> & {
  [key: string]: any;
};

export interface BankTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  reference?: string;
  mpesaCode?: string;
  phone?: string;
  raw: string;
}

export interface HolidayBreak {
  id: string;
  start_date: string;
  end_date: string;
  reason?: string;
  is_partial?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Enriched holiday break with UI-specific computed fields.
 */
export interface HolidayBreakItem extends HolidayBreak {
  contractId: string;
  tenantName: string;
  propertyName: string;
  houseNumber: string;
  status: 'ongoing' | 'upcoming' | 'past';
  propertyId?: string;
}

export interface Contract extends SyncedRow<DBContract> {
  metadata: {
    breaks?: HolidayBreak[];
    [key: string]: any;
  };
}

interface BookingReview {
  status: string;
  reviewed_at: string;
  reviewed_by: string;
  review_notes?: string;
  action_type?: 'approve' | 'reject' | 'convert' | 'reserve';
}

export interface Booking extends SyncedRow<DBBooking> {
  metadata: {
    reviews?: BookingReview[];
    [key: string]: any;
  };
}

export interface StoreState {
  properties: Record<string, Property>;
  houses: Record<string, House>;
  tenants: Record<string, Tenant>;
  contracts: Record<string, Contract>;
  receipts: Record<string, Receipt>;
  expenses: Record<string, Expense>;
  bookings: Record<string, Booking>;
  paymentMessages: Record<string, PaymentMessage>;
  reminderLogs: Record<string, ReminderLog>;
  paymentMessageReceipts: Record<string, PaymentMessageReceipt>;
  settings: Record<string, Setting>;
  receiptRefunds: Record<string, ReceiptRefund>;
  schedules: Record<string, Schedule>;
  backupLogs: Record<string, BackupLog>;
  maintenanceRequests: Record<string, MaintenanceRequest>;
  promotions: Record<string, Promotion>;
  apiKeys: Record<string, ApiKey>;
}

// Payment Methods
export interface PaymentMethodField {
  key: string;
  label: string;
  type: 'numeric' | 'text';
  required: boolean;
}

export interface PaymentMethodType {
  name: string;
  fields: PaymentMethodField[];
}

export interface PaymentMethod {
  id: string;
  type: string;
  default?: boolean;
  paybill_number?: string;
  account_number?: string;
  till_number?: string;
  business_name?: string;
  bank_name?: string;
  account_name?: string;
  [key: string]: any;
}

export interface PaymentMethodDisplayInfo {
  title: string;
  description: string;
  type: string;
}

// Reminders and Tenants
export interface Tenant extends SyncedRow<DBTenant> {
  pendingRentAmount?: number;
  paidAmount?: number;
  contracts?: (DBContract & {
    house?: DBHouse & {
      property?: DBProperty;
    };
  })[];
}

export interface ReminderTenant {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  business_id?: string | null;
  next_of_kin?: any;
  pendingRentAmount?: number;
  paidAmount?: number;
  contracts?: {
    id?: string | null;
    rent_amount?: number | null;
    metadata?: any;
    house?: {
      id?: string | null;
      property_id?: string | null;
      type?: string | null;
      house_number?: string | null;
      property?: {
        id?: string | null;
        name?: string | null;
      } | null;
    } | null;
  }[];
}

export interface ReminderLog extends Omit<SyncedRow<DBReminderLog>, 'metadata'> {
  tenant?: ReminderTenant;
  metadata: any;
}

export type ReminderCategoryType =
  | 'payment'
  | 'welcome'
  | 'whatsapp_invite'
  | 'data_cleanup'
  | 'announcement'
  | 'request_info'
  | 'mark_holiday';

export interface ReminderCategory {
  id: ReminderCategoryType;
  title: string;
  description: string;
  icon: string;
  color: string;
}

// VCF Export
export interface VCFTenant {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  contracts?: {
    id: string;
    status: string;
    house?: {
      house_number: string;
      property?: {
        name: string;
      };
    };
  }[];
}

export interface ExportResult {
  success: boolean;
  message?: string;
  fileUri?: string;
}

// Offline Image Manager
export interface PendingUpload {
  id: string;
  localUri: string;
  remotePath: string;
  bucket: string;
  folder: string;
  entityId: string; // ID of the entity (user, business, etc.)
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  publicUrl?: string;
  mimeType?: string;
  retryCount: number;
  createdAt: string;
  error?: string;
}

// House types and Settings
export interface HouseType {
  id: string;
  value: string;
  label: string;
  active: boolean;
  amenities: string[];
}

export interface Amenity {
  id: string;
  value: string;
  label: string;
  active: boolean;
}

export interface Links {
  whatsapp_group?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
}
