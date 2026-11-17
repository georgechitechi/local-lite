import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LocalFirstClient } from '../src/core/client.js';
import { NodeSQLiteAdapter } from '../src/adapters/local/node-sqlite.js';
import { MemoryDemoRemoteAdapter } from '../src/adapters/remote/demo.js';
import { DefaultNetworkStatusProvider } from '../src/adapters/network/index.js';

describe('QueryBuilder & Native Relational Operations', () => {
  let raw: DatabaseSync;
  let db: NodeSQLiteAdapter;
  let client: LocalFirstClient;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    db = new NodeSQLiteAdapter(raw);
    client = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      tables: ['contracts', 'houses', 'tenants', 'receipts'],
      autoStart: false,
      logger: false,
    });
    await client.initialize();

    // Seed test schema and data
    await client.insertMany('houses', [
      { id: 'h1', house_number: '101', rent: 15000 },
      { id: 'h2', house_number: '102', rent: 20000 },
      { id: 'h3', house_number: '103', rent: 25000 },
    ]);

    await client.insertMany('tenants', [
      { id: 't1', name: 'Alice Smith' },
      { id: 't2', name: 'Bob Jones' },
    ]);

    await client.insertMany('contracts', [
      {
        id: 'c1',
        house_id: 'h1',
        tenant_id: 't1',
        rent_amount: 15000,
        status: 'ACTIVE',
      },
      {
        id: 'c2',
        house_id: 'h2',
        tenant_id: 't2',
        rent_amount: 20000,
        status: 'ACTIVE',
      },
      {
        id: 'c3',
        house_id: 'h3',
        tenant_id: null,
        rent_amount: 25000,
        status: 'TERMINATED',
      },
    ]);

    await client.insertMany('receipts', [
      { id: 'r1', contract_id: 'c1', amount: 15000, refunded_amount: 0 },
      { id: 'r2', contract_id: 'c1', amount: 15000, refunded_amount: 1000 },
      { id: 'r3', contract_id: 'c2', amount: 20000, refunded_amount: 0 },
    ]);
  });

  it('compiles and executes multi-table JOINs in SQLite', async () => {
    const rows = await client
      .from('contracts')
      .join('houses', 'contracts.house_id', 'houses.id')
      .leftJoin('tenants', 'contracts.tenant_id', 'tenants.id')
      .where({ 'contracts.status': 'ACTIVE' })
      .select([
        'contracts.id AS contract_id',
        'contracts.rent_amount',
        'houses.house_number',
        'tenants.name AS tenant_name',
      ])
      .orderBy('houses.house_number', 'asc')
      .execute();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      contract_id: 'c1',
      rent_amount: 15000,
      house_number: '101',
      tenant_name: 'Alice Smith',
    });
    expect(rows[1]).toEqual({
      contract_id: 'c2',
      rent_amount: 20000,
      house_number: '102',
      tenant_name: 'Bob Jones',
    });
  });

  it('executes native count() in SQLite', async () => {
    const totalHouses = await client.count('houses');
    expect(totalHouses).toBe(3);

    const activeContracts = await client.count('contracts', {
      where: { status: 'ACTIVE' },
    });
    expect(activeContracts).toBe(2);
  });

  it('executes native sum() and avg() in SQLite', async () => {
    const totalRent = await client.sum('houses', 'rent');
    expect(totalRent).toBe(60000);

    const totalReceipts = await client.sum('receipts', 'amount');
    expect(totalReceipts).toBe(50000);

    const avgRent = await client.avg('houses', 'rent');
    expect(avgRent).toBe(20000);
  });

  it('executes single-pass multi-metric aggregate() in SQLite', async () => {
    const stats = await client.aggregate('receipts', {
      count: true,
      sum: ['amount', 'refunded_amount'],
      avg: ['amount'],
      min: ['amount'],
      max: ['amount'],
    });

    expect(stats.count).toBe(3);
    expect(stats.sum).toEqual({ amount: 50000, refunded_amount: 1000 });
    expect(stats.avg?.amount).toBeCloseTo(16666.66, 1);
    expect(stats.min).toEqual({ amount: 15000 });
    expect(stats.max).toEqual({ amount: 20000 });
  });

  it('first() returns single row directly', async () => {
    const firstHouse = await client
      .from('houses')
      .where({ house_number: '102' })
      .first();
    expect(firstHouse?.id).toBe('h2');
    expect(firstHouse?.rent).toBe(20000);
  });

  it('supports $not, whereNot(), and orWhere() boolean combinators', async () => {
    const notTerminated = await client
      .from('contracts')
      .whereNot({ status: 'TERMINATED' })
      .orderBy('id', 'asc')
      .execute();
    expect(notTerminated.map((c) => c.id)).toEqual(['c1', 'c2']);

    const orRows = await client
      .from('houses')
      .orWhere({ house_number: '101' }, { rent: { $gte: 25000 } })
      .orderBy('house_number', 'asc')
      .execute();
    expect(orRows.map((h) => h.id)).toEqual(['h1', 'h3']);

    const nestedNot = await client
      .from('contracts')
      .where({ $not: { tenant_id: null } })
      .execute();
    expect(nestedNot).toHaveLength(2);
  });

  it('supports distinct() and groupBy() + having()', async () => {
    const distinctAmounts = await client
      .from('receipts')
      .distinct()
      .select('amount')
      .orderBy('amount', 'asc')
      .execute();
    expect(distinctAmounts.map((r) => r.amount)).toEqual([15000, 20000]);

    const highReceiptContracts = await client
      .from('receipts')
      .select(['contract_id', 'SUM(amount) AS total_paid'])
      .groupBy('contract_id')
      .having('SUM(amount)', '>=', 25000)
      .execute();
    expect(highReceiptContracts).toHaveLength(1);
    expect(highReceiptContracts[0].contract_id).toBe('c1');
    expect(highReceiptContracts[0].total_paid).toBe(30000);
  });

  it('preloads hasMany and belongsTo relations via .with()', async () => {
    const relClient = new LocalFirstClient({
      local: db,
      remote: new MemoryDemoRemoteAdapter(0),
      network: new DefaultNetworkStatusProvider(false),
      autoSchema: true,
      tables: ['contracts', 'houses', 'tenants', 'receipts'],
      relationships: [
        { table: 'contracts', foreignKey: 'house_id', references: 'houses' },
        { table: 'contracts', foreignKey: 'tenant_id', references: 'tenants' },
        { table: 'receipts', foreignKey: 'contract_id', references: 'contracts' },
      ],
      autoStart: false,
      logger: false,
    });
    await relClient.initialize();

    const housesWithContracts = await relClient
      .from('houses')
      .with('contracts')
      .orderBy('house_number', 'asc')
      .execute();
    expect(housesWithContracts[0].contracts).toHaveLength(1);
    expect(housesWithContracts[0].contracts[0].id).toBe('c1');

    const contractsWithParents = await relClient
      .from('contracts')
      .with('houses', { table: 'tenants', as: 'tenant', type: 'belongsTo', foreignKey: 'tenant_id' })
      .orderBy('id', 'asc')
      .execute();
    expect(contractsWithParents[0].houses?.house_number).toBe('101');
    expect(contractsWithParents[0].tenant?.name).toBe('Alice Smith');
    expect(contractsWithParents[2].tenant).toBeNull();
  });

  it('supports clone() and prepare() for reusable parameterized queries', async () => {
    const base = client.from('contracts').where({ status: 'ACTIVE' });
    const cloned = base.clone().where({ house_id: 'h2' });

    expect(await base.count()).toBe(2);
    expect(await cloned.count()).toBe(1);

    const prepared = client
      .from('houses')
      .where('rent', '>=', 20000)
      .orderBy('house_number', 'asc')
      .prepare();

    const rows20k = await prepared.execute();
    expect(rows20k.map((h) => h.id)).toEqual(['h2', 'h3']);

    const rows25k = await prepared.execute([25000]);
    expect(rows25k.map((h) => h.id)).toEqual(['h3']);
  });
});
