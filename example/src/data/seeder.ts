import { LocalFirstClient, BatchMutation } from 'local-lite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface SeedProgress {
  current: number;
  total: number;
  stage: string;
  percent: number;
  rate?: number; // records per second
}

export interface SeedResult {
  durationMs: number;
  totalInserted: number;
  rate: number;
  breakdown: {
    properties: number;
    tenants: number;
    maintenanceRequests: number;
    payments: number;
  };
}

export interface SeedOptions {
  totalCount?: number;
  skipOutbox?: boolean;
  batchChunkSize?: number;
  onProgress?: (progress: SeedProgress) => void;
}

export interface SupabaseSeedOptions extends SeedOptions {
  supabaseUrl?: string;
  supabaseKey?: string;
  client?: SupabaseClient;
}

// ---------------------------------------------------------------------------
// UUID Helper (cross-platform Expo & Node)
// ---------------------------------------------------------------------------
export function generateId(prefix: string = ''): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix ? `${prefix}_${crypto.randomUUID()}` : crypto.randomUUID();
  }
  const s4 = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  const uuid = `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

// ---------------------------------------------------------------------------
// Realistic Mock Data Pools
// ---------------------------------------------------------------------------
const PROPERTY_PREFIXES = [
  'Sunset', 'Oakwood', 'Grand', 'Skyline', 'Harbor', 'Emerald', 'Meadow',
  'Pinecrest', 'Highland', 'Riverfront', 'Maple', 'Cedar', 'Silver',
  'Beacon', 'Crestview', 'Parkside', 'Westlake', 'Avalon', 'Lakeside',
  'Summit', 'Canyon', 'Pacific', 'Blue Ridge', 'Magnolia', 'Cambridge'
];

const PROPERTY_SUFFIXES = [
  'Heights', 'Apartments', 'Residences', 'Villas', 'Lofts', 'Place',
  'Court', 'Gardens', 'Towers', 'Terrace', 'Plaza', 'Manor', 'Commons',
  'Pointe', 'Estates', 'View', 'Park', 'Ridge'
];

const STREET_NAMES = [
  'Oak Avenue', 'Broad Street', 'Lexington Blvd', 'Riverside Drive',
  'Parkway Lane', 'Beacon Way', 'Ocean Blvd', 'Market Street', 'Maple Road',
  'Pine Lane', 'Highland Court', 'Elm Street', 'Cedar Way', 'Sunset Strip'
];

const CITIES = [
  'Austin, TX', 'Seattle, WA', 'Denver, CO', 'Miami, FL', 'Chicago, IL',
  'Atlanta, GA', 'Boston, MA', 'Phoenix, AZ', 'San Diego, CA', 'Nashville, TN'
];

const FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Chris', 'Casey', 'Riley',
  'Jamie', 'Avery', 'Logan', 'Dakota', 'Quinn', 'Cameron', 'Jesse',
  'Skyler', 'Rowan', 'Reese', 'Harper', 'Peyton', 'Adrian', 'Blake',
  'Charlie', 'Finley', 'Elena', 'Marcus', 'Sophia', 'Lucas', 'Maya', 'Liam'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez'
];

const MAINTENANCE_TITLES: Array<{ title: string; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY'; baseCost: number }> = [
  { title: 'AC compressor blowing lukewarm air', priority: 'HIGH', baseCost: 350 },
  { title: 'Kitchen sink disposal humming & jammed', priority: 'MEDIUM', baseCost: 120 },
  { title: 'Water heater tank leaking onto floor', priority: 'EMERGENCY', baseCost: 850 },
  { title: 'Smoke detector battery chirping in hallway', priority: 'LOW', baseCost: 25 },
  { title: 'Balcony sliding glass door latch loose', priority: 'LOW', baseCost: 85 },
  { title: 'Master bathroom shower grout caulking', priority: 'LOW', baseCost: 110 },
  { title: 'Dishwasher cycle not draining water', priority: 'MEDIUM', baseCost: 180 },
  { title: 'Ceiling water stain noticed after rainstorm', priority: 'HIGH', baseCost: 650 },
  { title: 'Main electrical breaker tripped repeatedly', priority: 'EMERGENCY', baseCost: 400 },
  { title: 'HVAC seasonal air filter replacement', priority: 'LOW', baseCost: 45 },
  { title: 'Window seal broken, condensation inside pane', priority: 'LOW', baseCost: 160 },
  { title: 'Refrigerator freezer coils frosted over', priority: 'MEDIUM', baseCost: 220 }
];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Dataset Generator (Generates cohesive relational entities)
// ---------------------------------------------------------------------------
export function generateRentalDataset(totalTargetCount: number = 200) {
  // Approximate ratio: 25% properties, 35% tenants, 15% maintenance, 25% payments
  const propCount = Math.max(2, Math.round(totalTargetCount * 0.25));
  const tenantCount = Math.max(2, Math.round(totalTargetCount * 0.35));
  const maintCount = Math.max(1, Math.round(totalTargetCount * 0.15));
  const paymentCount = Math.max(1, totalTargetCount - (propCount + tenantCount + maintCount));

  const properties: any[] = [];
  const tenants: any[] = [];
  const maintenanceRequests: any[] = [];
  const payments: any[] = [];

  const now = new Date();

  // 1. Generate Properties
  for (let i = 0; i < propCount; i++) {
    const id = generateId('prop');
    const name = `${randomChoice(PROPERTY_PREFIXES)} ${randomChoice(PROPERTY_SUFFIXES)}`;
    const unit = `Unit ${randomInt(1, 40)}${randomChoice(['A', 'B', 'C', 'D', ''])}`;
    const address = `${randomInt(100, 9999)} ${randomChoice(STREET_NAMES)}, ${randomChoice(CITIES)}`;
    const bedrooms = randomChoice([1, 2, 2, 3, 3, 4]);
    const bathrooms = Math.max(1, Math.min(bedrooms, randomChoice([1, 1.5, 2, 2.5, 3])));
    const rent = bedrooms * 650 + bathrooms * 250 + randomInt(1, 10) * 50;
    const status = randomChoice(['Occupied', 'Occupied', 'Occupied', 'Vacant', 'Renovating']);

    properties.push({
      id,
      name,
      unit,
      address,
      rent,
      status,
      bedrooms,
      bathrooms,
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(30, 365) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // 2. Generate Tenants (linked to existing properties)
  for (let i = 0; i < tenantCount; i++) {
    const id = generateId('ten');
    const assignedProp = properties[i % properties.length];
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const name = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(10, 99)}@gmail.com`;
    const phone = `+1 (555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
    const leaseMonths = randomChoice([6, 12, 12, 24]);
    const leaseStart = new Date(now.getTime() - randomInt(30, 180) * 86400000).toISOString().split('T')[0];
    const leaseEnd = new Date(new Date(leaseStart).getTime() + leaseMonths * 30 * 86400000).toISOString().split('T')[0];
    const status = randomChoice(['ACTIVE', 'ACTIVE', 'ACTIVE', 'PENDING', 'FORMER']);

    tenants.push({
      id,
      name,
      email,
      phone,
      property_id: assignedProp.id,
      property_name: `${assignedProp.name} (${assignedProp.unit})`,
      lease_start: leaseStart,
      lease_end: leaseEnd,
      rent_amount: assignedProp.rent,
      status,
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(10, 200) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // 3. Generate Maintenance Requests
  for (let i = 0; i < maintCount; i++) {
    const id = generateId('maint');
    const assignedProp = properties[i % properties.length];
    const template = randomChoice(MAINTENANCE_TITLES);
    const reportedDate = new Date(now.getTime() - randomInt(1, 60) * 86400000).toISOString().split('T')[0];
    const status = randomChoice(['PENDING', 'IN_PROGRESS', 'RESOLVED', 'RESOLVED']);

    maintenanceRequests.push({
      id,
      property_name: `${assignedProp.name} (${assignedProp.unit})`,
      title: template.title,
      priority: template.priority,
      status,
      estimated_cost: template.baseCost + randomInt(-20, 50),
      reported_date: reportedDate,
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(1, 60) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // 4. Generate Payments
  for (let i = 0; i < paymentCount; i++) {
    const id = generateId('pay');
    const assignedTenant = tenants[i % tenants.length];
    const assignedProp = properties.find((p) => p.id === assignedTenant.property_id) || properties[0];
    const dueDay = randomChoice(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']);
    const status = randomChoice(['PAID', 'PAID', 'PAID', 'PENDING', 'OVERDUE']);

    payments.push({
      id,
      property_name: assignedTenant.property_name || `${assignedProp.name} (${assignedProp.unit})`,
      tenant_name: assignedTenant.name,
      amount: assignedTenant.rent_amount || assignedProp.rent,
      due_date: dueDay,
      status,
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return { properties, tenants, maintenanceRequests, payments };
}

// ---------------------------------------------------------------------------
// Local SQLite Seeder (via local-lite Client Batch Transactions)
// ---------------------------------------------------------------------------
export async function seedLocalPortfolio(
  client: LocalFirstClient,
  options: SeedOptions = {}
): Promise<SeedResult> {
  const totalCount = options.totalCount ?? 200;
  const skipOutbox = options.skipOutbox ?? false;
  const chunkSize = options.batchChunkSize ?? 150;
  const startTime = Date.now();

  const { properties, tenants, maintenanceRequests, payments } = generateRentalDataset(totalCount);
  const totalRecords = properties.length + tenants.length + maintenanceRequests.length + payments.length;

  const allMutations: BatchMutation[] = [
    ...properties.map((p) => ({ tableName: 'properties', operation: 'INSERT' as const, payload: p, skipOutbox })),
    ...tenants.map((t) => ({ tableName: 'tenants', operation: 'INSERT' as const, payload: t, skipOutbox })),
    ...maintenanceRequests.map((m) => ({ tableName: 'maintenance_requests', operation: 'INSERT' as const, payload: m, skipOutbox })),
    ...payments.map((p) => ({ tableName: 'payments', operation: 'INSERT' as const, payload: p, skipOutbox })),
  ];

  let insertedCount = 0;

  for (let i = 0; i < allMutations.length; i += chunkSize) {
    const slice = allMutations.slice(i, i + chunkSize);
    await client.batch(slice, { skipOutbox });
    insertedCount += slice.length;

    if (options.onProgress) {
      const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
      options.onProgress({
        current: insertedCount,
        total: totalRecords,
        stage: `Inserting local SQLite records (${insertedCount}/${totalRecords})...`,
        percent: Math.round((insertedCount / totalRecords) * 100),
        rate: Math.round(insertedCount / elapsedSec),
      });
    }

    // Yield control so UI thread can re-render progress smoothly
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const durationMs = Date.now() - startTime;
  const rate = Math.round((totalRecords / Math.max(1, durationMs)) * 1000);

  return {
    durationMs,
    totalInserted: totalRecords,
    rate,
    breakdown: {
      properties: properties.length,
      tenants: tenants.length,
      maintenanceRequests: maintenanceRequests.length,
      payments: payments.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase Cloud Seeder (Direct Cloud Batch Upsert)
// ---------------------------------------------------------------------------
export async function seedSupabaseCloud(options: SupabaseSeedOptions = {}): Promise<SeedResult> {
  const totalCount = options.totalCount ?? 500;
  const url = options.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = options.supabaseKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  const supabase = options.client || createClient(url, key);
  const startTime = Date.now();

  const { properties, tenants, maintenanceRequests, payments } = generateRentalDataset(totalCount);
  const totalRecords = properties.length + tenants.length + maintenanceRequests.length + payments.length;

  let insertedCount = 0;
  const BATCH_SIZE = 500;

  const pushTableInChunks = async (tableName: string, rows: any[]) => {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from(tableName).upsert(chunk);
      if (error) {
        throw new Error(`Failed seeding ${tableName}: ${error.message}`);
      }
      insertedCount += chunk.length;

      if (options.onProgress) {
        const elapsedSec = Math.max(0.001, (Date.now() - startTime) / 1000);
        options.onProgress({
          current: insertedCount,
          total: totalRecords,
          stage: `Pushing to Supabase [${tableName}] (${insertedCount}/${totalRecords})...`,
          percent: Math.round((insertedCount / totalRecords) * 100),
          rate: Math.round(insertedCount / elapsedSec),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  await pushTableInChunks('properties', properties);
  await pushTableInChunks('tenants', tenants);
  await pushTableInChunks('maintenance_requests', maintenanceRequests);
  await pushTableInChunks('payments', payments);

  const durationMs = Date.now() - startTime;
  const rate = Math.round((totalRecords / Math.max(1, durationMs)) * 1000);

  return {
    durationMs,
    totalInserted: totalRecords,
    rate,
    breakdown: {
      properties: properties.length,
      tenants: tenants.length,
      maintenanceRequests: maintenanceRequests.length,
      payments: payments.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Local Portfolio Clearer
// ---------------------------------------------------------------------------
export async function clearRentalPortfolio(
  client: LocalFirstClient,
  options?: { clearOutbox?: boolean }
): Promise<void> {
  const tables = ['properties', 'tenants', 'maintenance_requests', 'payments'];

  for (const table of tables) {
    try {
      await client.db.execute(`DELETE FROM ${table}`);
      client.events.emit(table, {
        operation: 'DELETE',
        rowId: '*',
        payload: null,
        source: 'local',
      });
    } catch {
      // Table may not exist yet
    }
  }

  if (options?.clearOutbox) {
    try {
      await client.db.execute(`DELETE FROM sync_outbox`);
      client.events.emit('sync_outbox', { operation: 'DELETE', rowId: '*' });
    } catch {
      // Outbox may not exist yet
    }
  }
}

// ---------------------------------------------------------------------------
// Remote Supabase Cloud Clearer
// ---------------------------------------------------------------------------
export async function clearSupabaseCloud(options?: {
  supabaseUrl?: string;
  supabaseKey?: string;
  client?: SupabaseClient;
}): Promise<void> {
  const url = options?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = options?.supabaseKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const supabase = options?.client || createClient(url, key);

  const tables = ['payments', 'maintenance_requests', 'tenants', 'properties'];
  for (const t of tables) {
    const { error } = await supabase.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      console.warn(`Error clearing remote table ${t}:`, error.message);
    }
  }
}
