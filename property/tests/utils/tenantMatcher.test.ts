import { findSuggestedTenants } from '@/features/tenants/utils/tenantMatcher';

describe('tenantMatcher Utility', () => {
  const tenants = [
    { id: '1', name: 'John Doe', phone: '0712345678' },
    { id: '2', name: 'Jane Smith', phone: '+254799999999' },
    { id: '3', name: 'Alice Doe', phone: '0733333333' },
  ];

  const contracts = [
    { tenant_id: '1', status: 'active' },
    { tenant_id: '2', status: 'expired' },
  ];

  describe('findSuggestedTenants', () => {
    it('returns empty array when no match is found', () => {
      const message = 'Some random message without any identifying info';
      const results = findSuggestedTenants(message, tenants, contracts);
      expect(results.length).toBe(0);
    });

    it('matches by exact phone number in message', () => {
      // Message containing Jane's phone number
      const message = 'Received Ksh 5000 from 254799999999 for rent';
      const results = findSuggestedTenants(message, tenants, contracts);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tenantId).toBe('2');
      expect(results[0].reason).toContain('Phone number match');
    });

    it('matches by exact name in message (M-PESA format)', () => {
      const message =
        'QW123456 Confirmed. You have received Ksh 1,500 from JOHN DOE Phone 254711111111';
      const results = findSuggestedTenants(message, tenants, contracts);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tenantId).toBe('1');
      // Should boost confidence because John has an active contract
      expect(results[0].confidence).toBeGreaterThan(0.5);
    });

    it('penalizes confidence if matched tenant has no active contract', () => {
      // Message containing Jane's name. She has an expired contract
      const message =
        'QW123456 Confirmed. You have received Ksh 1,500 from JANE SMITH Phone 254711111111';
      const results = findSuggestedTenants(message, tenants, contracts);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tenantId).toBe('2');
      // Confidence should be heavily penalized (halved)
      expect(results[0].confidence).toBeLessThan(0.6);
    });

    it('matches using historical data', () => {
      const message =
        'QW123456 Confirmed. You have received Ksh 1,500 from UNKNOWN Phone 254733333333';

      const allMessages = [
        {
          id: 'msg1',
          message_content:
            'QW000000 Confirmed. You have received Ksh 1,500 from UNKNOWN Phone 254733333333',
        },
      ];

      const messageReceipts = [{ payment_message_id: 'msg1', receipt_id: 'receipt1' }];

      const receipts = [
        { id: 'receipt1', tenant_id: '3' }, // Alice Doe historically paid with this number
      ];

      const results = findSuggestedTenants(
        message,
        tenants,
        contracts,
        allMessages,
        messageReceipts,
        receipts,
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].tenantId).toBe('3');
      expect(results[0].reason).toContain('Recurring phone');
      expect(results[0].confidence).toBeGreaterThan(0.9);
    });

    it('ignores historical matching for common payers (caretaker scenario)', () => {
      const message =
        'QW123456 Confirmed. You have received Ksh 1,500 from CARETAKER Phone 254788888888';

      const allMessages = [
        {
          id: 'msg1',
          message_content:
            'QW000001 Confirmed. You have received Ksh 1,500 from CARETAKER Phone 254788888888',
        },
        {
          id: 'msg2',
          message_content:
            'QW000002 Confirmed. You have received Ksh 1,500 from CARETAKER Phone 254788888888',
        },
      ];

      const messageReceipts = [
        { payment_message_id: 'msg1', receipt_id: 'receipt1' },
        { payment_message_id: 'msg2', receipt_id: 'receipt2' },
      ];

      const receipts = [
        { id: 'receipt1', tenant_id: '1' }, // Paid for John
        { id: 'receipt2', tenant_id: '2' }, // Paid for Jane
      ];

      // Since the phone number 254788888888 has historically paid for MULTIPLE unique tenants (1 and 2),
      // the algorithm should invalidate historical suggestions to avoid confidently suggesting the wrong person.
      const results = findSuggestedTenants(
        message,
        tenants,
        contracts,
        allMessages,
        messageReceipts,
        receipts,
      );

      // Should find no results based on history since it was invalidated
      expect(results.length).toBe(0);
    });
  });
});
