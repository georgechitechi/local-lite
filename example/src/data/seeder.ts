import { LocalFirstClient } from 'outbox-sync';

export interface SeedProperty {
  id: string;
  name: string;
  unit: string;
  address: string;
  rent: number;
  status: 'Occupied' | 'Vacant' | 'Renovating';
  bedrooms: number;
  bathrooms: number;
}

export interface SeedTenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  property_id: string;
  property_name: string;
  lease_start: string;
  lease_end: string;
  rent_amount: number;
  status: 'ACTIVE' | 'PENDING' | 'FORMER';
}

export interface SeedMaintenanceTicket {
  id: string;
  property_name: string;
  title: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'IN_PROGRESS' | 'RESOLVED';
  estimated_cost: number;
  reported_date: string;
}

export interface SeedRentPayment {
  id: string;
  property_name: string;
  tenant_name: string;
  amount: number;
  due_date: string;
  status: 'PAID' | 'PENDING' | 'OVERDUE';
}

export const SEED_PROPERTIES: SeedProperty[] = [
  {
    id: 'prop-101',
    name: 'Skyline Lofts',
    unit: 'Unit 4B',
    address: '742 Evergreen Terrace',
    rent: 2450,
    status: 'Occupied',
    bedrooms: 2,
    bathrooms: 2,
  },
  {
    id: 'prop-102',
    name: 'Grandview Manor',
    unit: 'PH 12',
    address: '100 Ocean Blvd',
    rent: 3800,
    status: 'Occupied',
    bedrooms: 3,
    bathrooms: 2.5,
  },
  {
    id: 'prop-103',
    name: 'Oakridge Townhomes',
    unit: 'Apt 1A',
    address: '42 Pine Street',
    rent: 1650,
    status: 'Vacant',
    bedrooms: 1,
    bathrooms: 1,
  },
  {
    id: 'prop-104',
    name: 'Harbor Point Residences',
    unit: 'Suite 802',
    address: '250 Marina Way',
    rent: 2950,
    status: 'Occupied',
    bedrooms: 2,
    bathrooms: 2,
  },
];

export const SEED_TENANTS: SeedTenant[] = [
  {
    id: 'ten-1',
    name: 'Sarah Connor',
    email: 'sarah.connor@example.com',
    phone: '+1 (555) 234-5678',
    property_id: 'prop-101',
    property_name: 'Skyline Lofts 4B',
    lease_start: '2026-01-01',
    lease_end: '2026-12-31',
    rent_amount: 2450,
    status: 'ACTIVE',
  },
  {
    id: 'ten-2',
    name: 'Marcus Vance',
    email: 'm.vance@company.com',
    phone: '+1 (555) 987-6543',
    property_id: 'prop-102',
    property_name: 'Grandview Manor PH 12',
    lease_start: '2025-06-01',
    lease_end: '2027-05-31',
    rent_amount: 3800,
    status: 'ACTIVE',
  },
  {
    id: 'ten-3',
    name: 'Elena Rostova',
    email: 'elena.rostova@design.co',
    phone: '+1 (555) 876-5432',
    property_id: 'prop-104',
    property_name: 'Harbor Point Suite 802',
    lease_start: '2026-03-01',
    lease_end: '2027-02-28',
    rent_amount: 2950,
    status: 'ACTIVE',
  },
  {
    id: 'ten-4',
    name: 'Emily Watson',
    email: 'emily.w@studio.net',
    phone: '+1 (555) 456-7890',
    property_id: '',
    property_name: 'Applicant Pool',
    lease_start: '2026-11-01',
    lease_end: '2027-10-31',
    rent_amount: 1650,
    status: 'PENDING',
  },
];

export const SEED_MAINTENANCE: SeedMaintenanceTicket[] = [
  {
    id: 'maint-201',
    property_name: 'Skyline Lofts 4B',
    title: 'HVAC Air Handler Filter & Inspection',
    priority: 'HIGH',
    status: 'IN_PROGRESS',
    estimated_cost: 320,
    reported_date: 'Oct 10, 2026',
  },
  {
    id: 'maint-202',
    property_name: 'Grandview Manor PH 12',
    title: 'Master Bathroom Faucet Dripping',
    priority: 'MEDIUM',
    status: 'PENDING',
    estimated_cost: 150,
    reported_date: 'Oct 12, 2026',
  },
  {
    id: 'maint-203',
    property_name: 'Harbor Point Suite 802',
    title: 'Balcony Door Latch Adjustment',
    priority: 'LOW',
    status: 'RESOLVED',
    estimated_cost: 85,
    reported_date: 'Oct 05, 2026',
  },
];

export const SEED_PAYMENTS: SeedRentPayment[] = [
  {
    id: 'pay-301',
    property_name: 'Skyline Lofts 4B',
    tenant_name: 'Sarah Connor',
    amount: 2450,
    due_date: 'Oct 01, 2026',
    status: 'PAID',
  },
  {
    id: 'pay-302',
    property_name: 'Grandview Manor PH 12',
    tenant_name: 'Marcus Vance',
    amount: 3800,
    due_date: 'Nov 01, 2026',
    status: 'PENDING',
  },
  {
    id: 'pay-303',
    property_name: 'Harbor Point Suite 802',
    tenant_name: 'Elena Rostova',
    amount: 2950,
    due_date: 'Oct 01, 2026',
    status: 'PAID',
  },
];

/**
 * Seeds the complete rental property management portfolio across all 4 tables:
 * properties, tenants, maintenance_requests, and payments.
 */
export async function seedRentalPortfolio(client: LocalFirstClient): Promise<{
  propertiesCount: number;
  tenantsCount: number;
  maintenanceCount: number;
  paymentsCount: number;
}> {
  // 1. Seed Properties
  for (const property of SEED_PROPERTIES) {
    await client.insert('properties', property);
  }

  // 2. Seed Tenants
  for (const tenant of SEED_TENANTS) {
    await client.insert('tenants', tenant);
  }

  // 3. Seed Maintenance Tickets
  for (const ticket of SEED_MAINTENANCE) {
    await client.insert('maintenance_requests', ticket);
  }

  // 4. Seed Rent Payments
  for (const payment of SEED_PAYMENTS) {
    await client.insert('payments', payment);
  }

  return {
    propertiesCount: SEED_PROPERTIES.length,
    tenantsCount: SEED_TENANTS.length,
    maintenanceCount: SEED_MAINTENANCE.length,
    paymentsCount: SEED_PAYMENTS.length,
  };
}

/**
 * Clears all rental data from local SQLite tables.
 */
export async function clearRentalPortfolio(client: LocalFirstClient): Promise<void> {
  const tables = ['properties', 'tenants', 'maintenance_requests', 'payments'];
  for (const table of tables) {
    try {
      await client.db.execute(`DELETE FROM ${table}`);
    } catch {
      // Table may not exist yet
    }
  }
}
