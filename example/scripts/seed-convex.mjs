#!/usr/bin/env node
/**
 * Standalone Convex Cloud Seeder CLI
 *
 * Usage:
 *   node scripts/seed-convex.mjs 500       # Seeds 500 records into Convex
 *   node scripts/seed-convex.mjs 2000      # Seeds 2,000 records into Convex
 *   node scripts/seed-convex.mjs --clear   # Clears all rental tables in Convex
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { ConvexRemoteAdapter } from 'local-lite/convex';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read .env.local if present
const envPath = resolve(__dirname, '../.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...vals] = trimmed.split('=');
    if (key && !process.env[key.trim()]) {
      process.env[key.trim()] = vals.join('=').trim();
    }
  }
}

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('Set EXPO_PUBLIC_CONVEX_URL in .env.local');
const client = new ConvexHttpClient(url);
const tables = ['properties', 'tenants', 'maintenance_requests', 'payments'];
const remote = new ConvexRemoteAdapter(client, {
  tables, pushMutation: anyApi.sync.pushBatch, pullQuery: anyApi.sync.pullDeltas,
});
async function push(operations) {
  const result = await remote.pushChanges(operations);
  if (result === false || (typeof result === 'object' && (result.success === false || result.failedIds?.length))) {
    throw new Error('Convex rejected the batch');
  }
}

const args = process.argv.slice(2);
const isClearOnly = args.includes('--clear');
const countArg = args.find((a) => !a.startsWith('--') && !isNaN(Number(a)));
const targetCount = countArg ? Number(countArg) : 500;
if (!Number.isInteger(targetCount) || targetCount < 6) throw new Error('Record count must be an integer of at least 6');

// Data Pools
const PROPERTY_PREFIXES = ['Sunset', 'Oakwood', 'Grand', 'Skyline', 'Harbor', 'Emerald', 'Meadow', 'Pinecrest', 'Highland', 'Riverfront', 'Maple', 'Cedar', 'Silver', 'Beacon', 'Crestview', 'Parkside', 'Westlake', 'Avalon', 'Lakeside', 'Summit', 'Pacific', 'Magnolia'];
const PROPERTY_SUFFIXES = ['Heights', 'Apartments', 'Residences', 'Villas', 'Lofts', 'Place', 'Court', 'Gardens', 'Towers', 'Terrace', 'Plaza', 'Manor', 'Commons', 'Pointe', 'Estates'];
const STREET_NAMES = ['Oak Avenue', 'Broad Street', 'Lexington Blvd', 'Riverside Drive', 'Parkway Lane', 'Beacon Way', 'Ocean Blvd', 'Market Street', 'Maple Road', 'Pine Lane', 'Sunset Strip'];
const CITIES = ['Austin, TX', 'Seattle, WA', 'Denver, CO', 'Miami, FL', 'Chicago, IL', 'Atlanta, GA', 'Boston, MA', 'Phoenix, AZ', 'San Diego, CA'];
const FIRST_NAMES = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Sam', 'Chris', 'Casey', 'Riley', 'Jamie', 'Avery', 'Logan', 'Dakota', 'Quinn', 'Cameron', 'Jesse', 'Skyler', 'Rowan', 'Elena', 'Marcus', 'Sophia', 'Lucas', 'Maya', 'Liam'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
const MAINTENANCE_TITLES = [
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
  { title: 'Refrigerator freezer coils frosted over', priority: 'MEDIUM', baseCost: 220 }
];

const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const generateId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

async function clearTables() {
  // Query directly so connection errors abort instead of appearing as an empty snapshot.
  const snapshot = await client.query(anyApi.sync.pullDeltas, { sinceTimestamp: 0, tables });
  const rows = snapshot.changes.filter(row => row.operation !== 'DELETE');
  for (let i = 0; i < rows.length; i += 150) {
    await push(rows.slice(i, i + 150).map(row => ({
      id: crypto.randomUUID(), tableName: row.tableName, rowId: row.rowId,
      operation: 'DELETE', payload: null, timestamp: Date.now(),
    })));
  }
}

async function seedData(count) {
  console.log(`\n🚀 Generating ${count} realistic rental portfolio records...`);
  const propCount = Math.max(2, Math.round(count * 0.25));
  const tenantCount = Math.max(2, Math.round(count * 0.35));
  const maintCount = Math.max(1, Math.round(count * 0.15));
  const paymentCount = Math.max(1, count - (propCount + tenantCount + maintCount));

  const now = new Date();
  const properties = [];
  const tenants = [];
  const maintenanceRequests = [];
  const payments = [];

  for (let i = 0; i < propCount; i++) {
    const bedrooms = randomChoice([1, 2, 2, 3, 3, 4]);
    const bathrooms = Math.max(1, Math.min(bedrooms, randomChoice([1, 1.5, 2, 2.5, 3])));
    properties.push({
      id: generateId('prop'),
      name: `${randomChoice(PROPERTY_PREFIXES)} ${randomChoice(PROPERTY_SUFFIXES)}`,
      unit: `Unit ${randomInt(1, 50)}${randomChoice(['A', 'B', 'C', ''])}`,
      address: `${randomInt(100, 9999)} ${randomChoice(STREET_NAMES)}, ${randomChoice(CITIES)}`,
      rent: bedrooms * 650 + bathrooms * 250 + randomInt(1, 10) * 50,
      status: randomChoice(['Occupied', 'Occupied', 'Occupied', 'Vacant', 'Renovating']),
      bedrooms,
      bathrooms,
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(30, 365) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < tenantCount; i++) {
    const assignedProp = properties[i % properties.length];
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const leaseMonths = randomChoice([6, 12, 12, 24]);
    const leaseStart = new Date(now.getTime() - randomInt(30, 180) * 86400000).toISOString().split('T')[0];
    const leaseEnd = new Date(new Date(leaseStart).getTime() + leaseMonths * 30 * 86400000).toISOString().split('T')[0];
    tenants.push({
      id: generateId('ten'),
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randomInt(10, 99)}@gmail.com`,
      phone: `+1 (555) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`,
      property_id: assignedProp.id,
      property_name: `${assignedProp.name} (${assignedProp.unit})`,
      lease_start: leaseStart,
      lease_end: leaseEnd,
      rent_amount: assignedProp.rent,
      status: randomChoice(['ACTIVE', 'ACTIVE', 'ACTIVE', 'PENDING', 'FORMER']),
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(10, 200) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < maintCount; i++) {
    const assignedProp = properties[i % properties.length];
    const template = randomChoice(MAINTENANCE_TITLES);
    maintenanceRequests.push({
      id: generateId('maint'),
      property_name: `${assignedProp.name} (${assignedProp.unit})`,
      title: template.title,
      priority: template.priority,
      status: randomChoice(['PENDING', 'IN_PROGRESS', 'RESOLVED']),
      estimated_cost: template.baseCost + randomInt(-20, 50),
      reported_date: new Date(now.getTime() - randomInt(1, 60) * 86400000).toISOString().split('T')[0],
      deleted: false,
      created_at: new Date(now.getTime() - randomInt(1, 60) * 86400000).toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < paymentCount; i++) {
    const assignedTenant = tenants[i % tenants.length];
    payments.push({
      id: generateId('pay'),
      property_name: assignedTenant.property_name,
      tenant_name: assignedTenant.name,
      amount: assignedTenant.rent_amount,
      due_date: randomChoice(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']),
      status: randomChoice(['PAID', 'PAID', 'PAID', 'PENDING', 'OVERDUE']),
      deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const startTime = Date.now();
  const tables = [
    { name: 'properties', rows: properties },
    { name: 'tenants', rows: tenants },
    { name: 'maintenance_requests', rows: maintenanceRequests },
    { name: 'payments', rows: payments }
  ];

  const BATCH_SIZE = 500;
  for (const { name, rows } of tables) {
    console.log(`📤 Pushing ${rows.length} rows to ${name}...`);
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const slice = rows.slice(i, i + BATCH_SIZE);
      await push(slice.map(row => ({
        id: crypto.randomUUID(), tableName: name, rowId: row.id,
        operation: 'INSERT', payload: row, timestamp: Date.now(),
      })));
      process.stdout.write(`   ↳ ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} upserted\r`);
    }
    console.log(`   ✓ ${rows.length} rows completed.              `);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const total = properties.length + tenants.length + maintenanceRequests.length + payments.length;
  const rate = Math.round(total / Math.max(0.01, parseFloat(durationSec)));

  console.log(`\n🎉 Successfully seeded ${total} records into Convex in ${durationSec}s (${rate} records/sec)!`);
  console.log(`   • Properties:           ${properties.length}`);
  console.log(`   • Tenants:              ${tenants.length}`);
  console.log(`   • Maintenance Tickets:  ${maintenanceRequests.length}`);
  console.log(`   • Payment Transactions: ${payments.length}`);
  console.log(`\n💡 Open your local-lite app or tap "Reset Cursor" to pull and sync this massive dataset!`);
}

async function main() {
  if (isClearOnly) {
    await clearTables();
    console.log('✅ Convex cloud tables cleared.');
    return;
  }

  if (args.includes('--clean-first')) {
    await clearTables();
  }

  await seedData(targetCount);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
