import type { Business, BusinessShare, Tenant } from '@/shared/types/types';
import { accessibleBusinesses } from '@/shared/utils/businessAccess';
import { defaultCurrencies, formatWithCurrency } from '@/shared/utils/formatters';
import { calculateEffectiveRent } from '@/shared/utils/helper';

describe('Performance Benchmark Suite', () => {
  it('benchmarks currency formatting throughput', () => {
    const iterations = 5000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      formatWithCurrency(12500.5 + i, defaultCurrencies[0]);
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `\n[BENCHMARK] Currency Formatting: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(durationMs).toBeGreaterThan(0);
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  it('benchmarks JSON payload serialization and hydration', () => {
    const iterations = 2000;
    const sample = {
      id: 'tenant-12345',
      name: 'John Doe',
      contacts: ['+254711223344', '+254722334455'],
      metadata: {
        rent: 25000,
        deposit: 25000,
        amenities: ['parking', 'water', 'security'],
        history: Array.from({ length: 12 }, (_, m) => ({ month: m + 1, paid: true })),
      },
    };

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const serialized = JSON.stringify(sample);
      JSON.parse(serialized);
    }
    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] JSON Hydration: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(opsPerSec).toBeGreaterThan(5000);
  });

  it('benchmarks business access control resolution across 500 businesses', () => {
    const user = { id: 'user-main', email: 'owner@example.com' };
    const businesses: Business[] = Array.from({ length: 500 }, (_, i) => ({
      id: `biz-${i}`,
      name: `Business ${i}`,
      user_id: i % 5 === 0 ? 'user-main' : `user-other-${i}`,
      deleted: false,
    })) as any;

    const shares: BusinessShare[] = Array.from({ length: 50 }, (_, i) => ({
      id: `share-${i}`,
      business_id: `biz-${i * 7}`,
      shared_with: 'owner@example.com',
      status: 'active',
      roles: '["staff"]',
    })) as any;

    const tenants: Tenant[] = Array.from({ length: 50 }, (_, i) => ({
      id: `tenant-${i}`,
      business_id: `biz-${i * 9}`,
      email: 'owner@example.com',
      deleted: false,
    })) as any;

    const iterations = 200;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      accessibleBusinesses(businesses, shares, tenants, user, 'offline');
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Access Control (500 businesses): ${iterations.toLocaleString()} evaluations in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(opsPerSec).toBeGreaterThan(100);
  });

  it('benchmarks rent calculation across 2,000 contracts', () => {
    const start = performance.now();
    for (let i = 0; i < 2000; i++) {
      calculateEffectiveRent(15000 + (i % 10) * 1000, 10, 2026, []);
    }
    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((2000 / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Rent Calculations (2,000 contracts): 2,000 ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)\n`,
    );
    expect(opsPerSec).toBeGreaterThan(1000);
  });
});
