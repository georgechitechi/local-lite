import type { Business, BusinessShare, Tenant } from '@/shared/types/types';
import { accessibleBusinesses } from '@/shared/utils/businessAccess';
import { defaultCurrencies, formatWithCurrency } from '@/shared/utils/formatters';
import {
  calculateEffectiveRent,
  extractAmount,
  normalizePhoneNumber,
  safeParseJSON,
} from '@/shared/utils/helper';

describe('Performance Benchmark & Stress Test Suite', () => {
  // ---------------------------------------------------------------------------
  // 1. Currency Formatting Throughput & Edge Cases
  // ---------------------------------------------------------------------------
  it('benchmarks currency formatting throughput with negative, decimal, and zero values', () => {
    const iterations = 10000;
    const testAmounts = [0, -1500.75, 12500.5, 999999.99, 10000000];
    const currencies = defaultCurrencies; // KES, USD, EUR, GBP

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const amount = testAmounts[i % testAmounts.length] + i;
      const currency = currencies[i % currencies.length];
      formatWithCurrency(amount, currency);
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `\n[BENCHMARK] Multi-Currency Formatting: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  // ---------------------------------------------------------------------------
  // 2. Tough Edge Case: Deeply Nested & Malformed JSON Fuzz Parsing
  // ---------------------------------------------------------------------------
  it('benchmarks resilient JSON parsing with deeply nested trees, unicode, and malformed strings', () => {
    const iterations = 5000;

    // Build a 10-level deep nested object with mixed types, unicode, and special chars
    const deepPayload = {
      level1: {
        title: 'Tenant Contract 🏢 #1234',
        emoji: '🔑 🇰🇪 💰',
        specialChars: '<script>alert("xss")</script> & "quotes" \'single\' \\backslashes\\',
        level2: {
          contacts: Array.from({ length: 20 }, (_, idx) => ({
            id: `c-${idx}`,
            phone: `+254700${idx.toString().padStart(6, '0')}`,
            valid: idx % 2 === 0,
          })),
          level3: {
            metadata: {
              active: true,
              balance: -4500.25,
              tags: ['vip', 'verified', 'residential'],
              level4: {
                nestedHistory: Array.from({ length: 12 }, (_, m) => ({
                  month: m + 1,
                  paid: true,
                  amount: 35000,
                  breakdown: { rent: 30000, water: 3000, parking: 2000 },
                })),
              },
            },
          },
        },
      },
    };

    const validJsonString = JSON.stringify(deepPayload);
    const corruptedTestCases = [
      validJsonString,
      '{"incomplete": [1, 2, 3, {"unclosed": true',
      'not a json string at all',
      '{"nullValue": null, "boolean": false, "emptyArr": []}',
      '{"badUnicode": "\uD800"}',
      '',
      'null',
      '{}',
    ];

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const raw = corruptedTestCases[i % corruptedTestCases.length];
      safeParseJSON(raw, { fallback: true, index: i });
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Deep/Malformed JSON Parsing: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(opsPerSec).toBeGreaterThan(2000);
  });

  // ---------------------------------------------------------------------------
  // 3. Tough Edge Case: Massive Multi-Tenant Access Control Resolution (2,000 businesses)
  // ---------------------------------------------------------------------------
  it('benchmarks access control resolution across 2,000 businesses with corrupted shares and mixed casings', () => {
    const user = { id: 'user-main', email: 'Owner.Admin@Example.com' };

    // 2,000 businesses
    const businesses: Business[] = Array.from({ length: 2000 }, (_, i) => ({
      id: `biz-${i}`,
      name: `Commercial Property ${i}`,
      user_id: i % 10 === 0 ? 'user-main' : `user-other-${i}`,
      deleted: i % 50 === 0,
    })) as any;

    // 300 shares with corrupted JSON, uppercase emails, and revoked statuses
    const shares: BusinessShare[] = Array.from({ length: 300 }, (_, i) => ({
      id: `share-${i}`,
      business_id: `biz-${i * 6}`,
      shared_with: i % 2 === 0 ? 'owner.admin@example.com' : 'OTHER.USER@EXAMPLE.COM',
      status: i % 3 === 0 ? 'active' : i % 3 === 1 ? 'pending' : 'revoked',
      roles:
        i % 4 === 0
          ? '["manager", "staff"]'
          : i % 4 === 1
            ? '{"corrupted_json'
            : i % 4 === 2
              ? '["viewer"]'
              : '[]',
    })) as any;

    // 200 tenants
    const tenants: Tenant[] = Array.from({ length: 200 }, (_, i) => ({
      id: `tenant-${i}`,
      business_id: `biz-${i * 8}`,
      email: i % 4 === 0 ? 'owner.admin@example.com' : `tenant-${i}@domain.com`,
      deleted: i % 5 === 0,
    })) as any;

    const iterations = 300;
    const start = performance.now();

    let accessibleCount = 0;
    for (let i = 0; i < iterations; i++) {
      const result = accessibleBusinesses(businesses, shares, tenants, user, 'offline');
      accessibleCount = result.length;
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Access Control (2,000 businesses, 300 shares): ${iterations} evaluations in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec, resolved ${accessibleCount} accessible businesses)`,
    );
    expect(opsPerSec).toBeGreaterThan(50);
    expect(accessibleCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Tough Edge Case: Complex Overlapping Prorated Rent Breaks in Leap Years
  // ---------------------------------------------------------------------------
  it('benchmarks rent calculation with multiple overlapping partial breaks across leap & non-leap years', () => {
    const iterations = 3000;

    // Edge-case break structures:
    // 1. Partial break 1: 5th to 15th
    // 2. Partial break 2: 10th to 20th (overlaps with break 1)
    // 3. Partial break 3: 25th to 28th (non-overlapping)
    // 4. Multi-month break spanning out of bounds
    const complexBreaks = [
      { start_date: '2024-02-05', end_date: '2024-02-15', is_partial: true },
      { start_date: '2024-02-10', end_date: '2024-02-20', is_partial: true },
      { start_date: '2024-02-25', end_date: '2024-02-28', is_partial: true },
      { start_date: '2023-12-01', end_date: '2024-01-10', is_partial: true }, // Out of target month
      { start_date: '2024-02-01', end_date: '2099-12-31', is_partial: false }, // Will be toggled
    ];

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const isLeapYear = i % 2 === 0;
      const year = isLeapYear ? 2024 : 2025; // 2024 is leap (29 days), 2025 has 28 days
      const month = 2; // February
      const activeBreaks =
        i % 5 === 0
          ? complexBreaks // includes full waiver
          : complexBreaks.slice(0, 3); // partial overlapping breaks only

      calculateEffectiveRent(36000 + (i % 10) * 1000, month, year, activeBreaks);
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Overlapping Prorated Rent Calculations: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`,
    );
    expect(opsPerSec).toBeGreaterThan(1000);
  });

  // ---------------------------------------------------------------------------
  // 5. Tough Edge Case: Transaction SMS Extraction (Regex Throughput)
  // ---------------------------------------------------------------------------
  it('benchmarks payment SMS transaction amount parsing regex across messy real-world formats', () => {
    const iterations = 10000;
    const smsMessages = [
      'QA12BC345D Confirmed. Ksh15,500.00 received from JOHN DOE 0712345678 on 15/10/26 at 2:30 PM. New balance: Ksh1,200.00.',
      'You have sent KES 4,500.50 to JANE SMITH 0722000000 on 14/10/26. Transaction cost Ksh 0.00.',
      'Paid to KPLC PREPAID Ksh. 2,000 for token 1234-5678. Token: 9988-7766.',
      'Confirmed. You have received USD 1,250.00 from GLOBAL CLIENT.',
      'Promotion alert: Get 50% extra data bundle today only! Dial *544# to activate.',
      'Total Amt: 85,000.00 KES via mobile money.',
      'Ref: XYZ999. Ksh 0.00 refunded.',
      'Invalid text with no currency numbers here.',
    ];

    const start = performance.now();
    let extractedCount = 0;
    for (let i = 0; i < iterations; i++) {
      const msg = smsMessages[i % smsMessages.length];
      const amt = extractAmount(msg);
      if (amt !== undefined) extractedCount++;
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] SMS Payment Extraction: ${iterations.toLocaleString()} parses in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec, extracted ${extractedCount.toLocaleString()} amounts)`,
    );
    expect(opsPerSec).toBeGreaterThan(2000);
    expect(extractedCount).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Tough Edge Case: Phone Number International Normalization
  // ---------------------------------------------------------------------------
  it('benchmarks phone number normalization across erratic inputs, formats, and garbage strings', () => {
    const iterations = 5000;
    const samplePhones = [
      '0712345678', // standard Kenyan mobile
      '0110123456', // 01x series Kenyan mobile
      '+254 712 345 678', // formatted with spaces
      '254712345678', // without plus sign
      '+1 (415) 555-2671', // US number
      '0712-345-678', // with dashes
      '0712 345678 ext 12', // with extension
      'not-a-phone-number', // invalid alphanumeric
      '', // empty string
      '   0722112233   ', // whitespace padded
    ];

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const phone = samplePhones[i % samplePhones.length];
      normalizePhoneNumber(phone, 'KE');
    }

    const durationMs = Math.max(1, performance.now() - start);
    const opsPerSec = Math.round((iterations / durationMs) * 1000);

    console.log(
      `[BENCHMARK] Phone Number Normalization: ${iterations.toLocaleString()} ops in ${durationMs.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)\n`,
    );
    expect(opsPerSec).toBeGreaterThan(1000);
  });
});
