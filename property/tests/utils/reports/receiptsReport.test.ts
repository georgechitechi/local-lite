import { processReportData } from '@/features/reports/utils/dataProcessors';
import {
  generatePDFContent,
  getPDFPrintOptions,
} from '@/features/reports/utils/pdfGenerators';

describe('Receipts Report - Waived Months', () => {
  const baseContract = {
    id: 'contract-1',
    tenant_id: 'tenant-1',
    house_id: 'house-1',
    rent_amount: 15000,
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    tenant: { name: 'John Doe' },
    house: {
      house_number: '101',
      property: { name: 'Sunset Apartments' },
    },
    metadata: {
      breaks: [
        {
          id: 'break-1',
          start_date: '2026-02-01',
          end_date: '2026-02-28',
          reason: 'Holiday Break',
          is_partial: false,
        },
      ],
    },
  };

  const sampleReceipts = [
    // Paid in Jan 2026
    {
      id: 'r-1',
      contract_id: 'contract-1',
      amount: 15000,
      payment_date: '2026-01-05',
      payment_period: { month: 1, year: 2026 },
      status: 'paid',
      contract: baseContract,
    },
    // Another tenant paid in Feb 2026
    {
      id: 'r-other-feb',
      contract_id: 'contract-2',
      amount: 12000,
      payment_date: '2026-02-05',
      payment_period: { month: 2, year: 2026 },
      status: 'paid',
      contract: {
        id: 'contract-2',
        rent_amount: 12000,
        status: 'active',
        tenant: { name: 'Alice' },
        house: { house_number: '102', property: { name: 'Sunset Apartments' } },
      },
    },
    // Paid in Mar 2026
    {
      id: 'r-2',
      contract_id: 'contract-1',
      amount: 15000,
      payment_date: '2026-03-05',
      payment_period: { month: 3, year: 2026 },
      status: 'paid',
      contract: baseContract,
    },
  ];

  it('marks waived month as "Waived" in processReportData', () => {
    const result = processReportData('receipts', sampleReceipts);
    expect(result.headers).toContain('Jan 2026');
    expect(result.headers).toContain('Feb 2026');
    expect(result.headers).toContain('Mar 2026');

    const row = result.data.find(
      (r: any) => r.tenant === 'John Doe' && r.house_number === '101',
    ) as any;
    expect(row).toBeDefined();
    expect(row['Jan 2026']).toBe('15,000');
    expect(row['Feb 2026']).toBe('Waived');
    expect(row['Feb 2026_status']).toEqual(['waived']);
    expect(row['Mar 2026']).toBe('15,000');
  });

  it('renders "Waived" in generatePDFContent with left-aligned waived cell and without insufficient payment warning', () => {
    const { data, headers } = processReportData('receipts', sampleReceipts);
    const html = generatePDFContent(data, 'receipts', null, headers);

    // Should include the waived CSS class with text-align: left
    expect(html).toContain(
      '.waived-payment-cell { background-color: #ede9fe !important; color: #6d28d9; font-weight: bold; text-align: left; }',
    );
    expect(html).not.toContain('waived-badge');

    // The waived cell should have waived-payment-cell, plain Waived text, and NOT insufficient-payment-cell
    const waivedTdMatch = html.match(/<td class="([^"]*)"[^>]*>Waived<\/td>/);
    expect(waivedTdMatch).toBeTruthy();
    expect(waivedTdMatch?.[1]).toContain('waived-payment-cell');
    expect(waivedTdMatch?.[1]).not.toContain('insufficient-payment-cell');
  });

  it('handles receipt with status "waived"', () => {
    const receiptWithWaivedStatus = [
      {
        id: 'r-3',
        contract_id: 'contract-2',
        amount: 0,
        payment_date: '2026-04-05',
        payment_period: { month: 4, year: 2026 },
        status: 'waived',
        contract: {
          ...baseContract,
          id: 'contract-2',
          metadata: {},
          tenant: { name: 'Jane Smith' },
          house: { house_number: '102', property: { name: 'Sunset Apartments' } },
        },
      },
    ];

    const result = processReportData('receipts', receiptWithWaivedStatus);
    const row = result.data[0] as any;
    expect(row['Apr 2026']).toBe('Waived');
    expect(row['Apr 2026_status']).toEqual(['waived']);
  });

  it('leaves unpaid non-waived month as "-"', () => {
    const nonWaivedContract = {
      ...baseContract,
      id: 'contract-3',
      metadata: {}, // No breaks
      tenant: { name: 'Bob Wilson' },
      house: { house_number: '103', property: { name: 'Sunset Apartments' } },
    };

    const receipts = [
      {
        id: 'r-4',
        contract_id: 'contract-3',
        amount: 15000,
        payment_date: '2026-01-05',
        payment_period: { month: 1, year: 2026 },
        status: 'paid',
        contract: nonWaivedContract,
      },
      // Another tenant paid in Feb 2026, so Feb 2026 column exists in the report
      {
        id: 'r-other',
        contract_id: 'contract-other',
        amount: 12000,
        payment_date: '2026-02-05',
        payment_period: { month: 2, year: 2026 },
        status: 'paid',
        contract: {
          ...baseContract,
          id: 'contract-other',
          metadata: {},
          tenant: { name: 'Other Tenant' },
          house: { house_number: '104', property: { name: 'Sunset Apartments' } },
        },
      },
      // Bob paid Mar, skipped Feb with no waiver
      {
        id: 'r-5',
        contract_id: 'contract-3',
        amount: 15000,
        payment_date: '2026-03-05',
        payment_period: { month: 3, year: 2026 },
        status: 'paid',
        contract: nonWaivedContract,
      },
    ];

    const result = processReportData('receipts', receipts);
    const row = result.data.find((r: any) => r.tenant === 'Bob Wilson') as any;
    expect(row).toBeDefined();
    expect(row['Jan 2026']).toBe('15,000');
    expect(row['Feb 2026']).toBe('-');
    expect(row['Mar 2026']).toBe('15,000');
  });

  describe('Report Orientation Selection', () => {
    it('returns correct print dimensions for portrait and landscape', () => {
      const portraitOpts = getPDFPrintOptions('receipts', 'portrait');
      expect(portraitOpts).toEqual({ width: 612, height: 792 });

      const landscapeOpts = getPDFPrintOptions('receipts', 'landscape');
      expect(landscapeOpts).toEqual({ width: 792, height: 612 });

      const defaultReceiptsOpts = getPDFPrintOptions('receipts');
      expect(defaultReceiptsOpts).toEqual({ width: 612, height: 792 });

      const defaultOtherOpts = getPDFPrintOptions('tenants');
      expect(defaultOtherOpts).toEqual({ width: 612, height: 792 });
    });

    it('generates HTML with correct @page orientation', () => {
      const { data, headers } = processReportData('receipts', sampleReceipts);

      const portraitHtml = generatePDFContent(data, 'receipts', null, headers, {
        orientation: 'portrait',
      });
      expect(portraitHtml).toContain('size: A4 portrait;');

      const landscapeHtml = generatePDFContent(data, 'receipts', null, headers, {
        orientation: 'landscape',
      });
      expect(landscapeHtml).toContain('size: A4 landscape;');
    });
  });

  describe('Indefinite Break Handling', () => {
    it('marks past months as Waived and current/future months as Out for indefinite breaks', () => {
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth() + 1;

      // Calculate past month period
      const pastDate = new Date(curYear, curMonth - 3, 1);
      const pastPeriod = pastDate.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });

      // Calculate current month period
      const curPeriod = now.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });

      // Calculate future month period
      const futDate = new Date(curYear, curMonth + 2, 1);
      const futPeriod = futDate.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });

      const indefiniteContract = {
        id: 'contract-indef',
        rent_amount: 10000,
        status: 'active',
        metadata: {
          breaks: [
            {
              id: 'break-indef',
              start_date: `${pastDate.getFullYear()}-01-01`,
              end_date: '2099-12-31',
              is_partial: true,
              reason: 'Contract Paused',
            },
          ],
        },
        tenant: { name: 'Indefinite Tenant' },
        house: { house_number: '105', property: { name: 'Sunset Apartments' } },
      };

      const receipts = [
        {
          id: 'r-indef-past',
          contract_id: 'contract-indef',
          amount: 0,
          payment_date: `${pastDate.getFullYear()}-${String(pastDate.getMonth() + 1).padStart(2, '0')}-01`,
          payment_period: {
            month: pastDate.getMonth() + 1,
            year: pastDate.getFullYear(),
          },
          status: 'pending',
          contract: indefiniteContract,
        },
        {
          id: 'r-indef-cur',
          contract_id: 'contract-indef',
          amount: 0,
          payment_date: `${curYear}-${String(curMonth).padStart(2, '0')}-01`,
          payment_period: { month: curMonth, year: curYear },
          status: 'pending',
          contract: indefiniteContract,
        },
        {
          id: 'r-indef-fut',
          contract_id: 'contract-indef',
          amount: 0,
          payment_date: `${futDate.getFullYear()}-${String(futDate.getMonth() + 1).padStart(2, '0')}-01`,
          payment_period: { month: futDate.getMonth() + 1, year: futDate.getFullYear() },
          status: 'pending',
          contract: indefiniteContract,
        },
      ];

      const { data, headers } = processReportData('receipts', receipts);
      const row = data.find((r: any) => r.tenant === 'Indefinite Tenant') as any;
      expect(row).toBeDefined();

      // Past month should be Waived
      expect(row[pastPeriod]).toBe('Waived');
      expect(row[`${pastPeriod}_status`]).toEqual(['waived']);

      // Current month should be Holiday
      expect(row[curPeriod]).toBe('Holiday');
      expect(row[`${curPeriod}_status`]).toEqual(['holiday']);

      // Future month should be Holiday
      expect(row[futPeriod]).toBe('Holiday');
      expect(row[`${futPeriod}_status`]).toEqual(['holiday']);

      // PDF generation should render .holiday-payment-cell and not mark as insufficient
      const html = generatePDFContent(data, 'receipts', null, headers);
      expect(html).toContain('holiday-payment-cell');
      expect(html).toContain('>Holiday</td>');
      expect(html).toContain('waived-payment-cell');
      expect(html).toContain('>Waived</td>');
    });

    it('renders refunded payment as Refunded without amount', () => {
      const receipts = [
        {
          id: 'r-ref',
          contract_id: 'contract-ref',
          amount: 2000,
          is_refunded: true,
          payment_date: '2026-09-01',
          payment_period: { month: 9, year: 2026 },
          status: 'refunded',
          contract: {
            id: 'contract-ref',
            rent_amount: 2000,
            status: 'active',
            tenant: { name: 'Refunded Tenant' },
            house: { house_number: '106', property: { name: 'Sunset Apartments' } },
          },
        },
      ];

      const { data, headers } = processReportData('receipts', receipts);
      const row = data.find((r: any) => r.tenant === 'Refunded Tenant') as any;
      expect(row).toBeDefined();
      expect(row['Sep 2026']).toBe('Refunded');

      const html = generatePDFContent(data, 'receipts', null, headers);
      expect(html).toContain('refunded-payment-cell');
      expect(html).toContain('>Refunded</td>');
    });
  });
});
