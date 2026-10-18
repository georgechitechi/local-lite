import { getEffectiveDate } from '@/features/reports/utils/helpers';
import { formatDateForDB, formatDisplayDate } from '@/shared/utils/formatters';
import { findDuplicateGroups, hasUnformattedAmount } from '@/shared/utils/helper';
import {
  isActiveContractStatus,
  isActiveTenantStatus,
  isFormerContractStatus,
} from '@/shared/utils/statusHelper';
import { IntegrityRuleEngine } from './integrity';
import { statusRules } from './integrity/rules/StatusRules';
import type { IntegrityIssue, IntegrityScanData } from './integrity/types';

export type { IntegrityIssue, IntegrityScanData };

export const performIntegrityScan = (data: IntegrityScanData): IntegrityIssue[] => {
  const {
    allTenants,
    allContracts,
    allHouses,
    allReceipts,
    allProperties,
    allExpenses,
    allPaymentMessages,
    allPaymentMessageReceipts,
    allBookings,
    allMaintenance,
    allPromos,
  } = data;

  const results: IntegrityIssue[] = [];
  const today = new Date();

  const getContractName = (c: any) => {
    const tenant = allTenants.find(t => t.id === c.tenant_id);
    const house = allHouses.find(h => h.id === c.house_id);
    return `${tenant?.name || 'Unknown Tenant'} - ${house?.house_number || 'Unknown House'}`;
  };

  // 1. Run Modularized Rule Engine for Extracted Rules
  const engine = new IntegrityRuleEngine();
  engine.registerRules(statusRules);
  const modularResults = engine.evaluateAll(data);
  results.push(...modularResults);

  // 4. Unlinked Payment Messages
  const unlinkedPaymentMessages = allPaymentMessages
    .filter(msg => {
      const junctionRecords = allPaymentMessageReceipts.filter(
        j => j.payment_message_id === msg.id,
      );
      const hasValidReceipts = junctionRecords.some(j =>
        allReceipts.some(r => r.id === j.receipt_id),
      );
      return !hasValidReceipts;
    })
    .map(msg => {
      const junctionRecords = allPaymentMessageReceipts.filter(
        j => j.payment_message_id === msg.id,
      );
      const hasJunctionButNoReceipt = junctionRecords.length > 0;

      const content = msg.message_content || '';
      const preview = content.length > 30 ? `${content.substring(0, 30)}...` : content;
      return {
        ...msg,
        name: `Message: ${preview}`,
        status: hasJunctionButNoReceipt
          ? 'Orphaned (Receipt deleted/dropped)'
          : 'Unlinked (Never processed)',
        payment_date: msg.transaction_date,
        hasJunctionButNoReceipt,
      };
    });

  results.push({
    id: 'unlinkedPaymentMessages',
    title: 'Unlinked Payment Messages',
    description:
      'Payment messages that are not linked to any valid receipts. If orphaned, navigate to Receipts > "+", select the tenant, and search for the transaction code to relink the payment.',
    category: 'Financial',
    severity: 'warning',
    items: unlinkedPaymentMessages,
  });

  // --- CATEGORY: LOGICAL ERRORS ---

  // 4. Overlapping House Contracts
  const overlaps: any[] = [];
  const housesWithMultiple = allHouses.filter(
    h =>
      allContracts.filter(c => c.house_id === h.id && isActiveContractStatus(c.status))
        .length > 1,
  );
  housesWithMultiple.forEach(h => {
    const active = allContracts
      .filter(c => c.house_id === h.id && isActiveContractStatus(c.status))
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    for (let i = 0; i < active.length - 1; i++) {
      const c1 = active[i];
      const c2 = active[i + 1];
      if (c1.end_date && c2.start_date && c1.end_date >= c2.start_date) {
        overlaps.push({
          id: h.id,
          house: h,
          c1,
          c2,
          name: `${h.house_number}: ${getContractName(c1)} & ${getContractName(c2)}`,
        });
      }
    }
  });
  results.push({
    id: 'overlappingContracts',
    title: 'Overlapping House Contracts',
    description: 'Multiple active contracts covering the same dates for a single house.',
    category: 'Logical',
    severity: 'critical',
    items: overlaps,
  });

  // 5. Occupied Before Built
  const occupiedBeforeBuilt = allHouses
    .filter(h => {
      let meta = h.metadata;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {}
      }
      if (meta?.ignore_occupied_before_built) return false;

      const property = allProperties.find(p => p.id === h.property_id);
      const houseWithProp = { ...h, property };
      const effectiveDate = getEffectiveDate(houseWithProp);
      if (!effectiveDate) return false;
      const effectiveTime = effectiveDate.getTime();

      return allContracts.some(c => {
        if (c.house_id !== h.id || !c.start_date) return false;
        return new Date(c.start_date).getTime() < effectiveTime;
      });
    })
    .map(h => {
      const property = allProperties.find(p => p.id === h.property_id);
      const houseWithProp = { ...h, property };
      const effectiveDate = getEffectiveDate(houseWithProp);
      const effectiveTime = effectiveDate?.getTime() ?? 0;

      const earlyContractObjs = allContracts
        .filter(c => {
          if (c.house_id !== h.id || !c.start_date) return false;
          return new Date(c.start_date).getTime() < effectiveTime;
        })
        .sort(
          (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
        );

      const earlyContracts = earlyContractObjs.map(
        c => `${getContractName(c)} (Started: ${formatDisplayDate(c.start_date)})`,
      );

      return {
        id: h.id,
        name: `${h.house_number}`,
        issue: `Commissioned on ${formatDisplayDate(effectiveDate?.toISOString())},\nFirst contracts: ${earlyContracts.join(', ')}`,
        house: h,
        property,
        contracts: earlyContractObjs,
        effectiveDate: effectiveDate ? formatDateForDB(effectiveDate) : null,
      };
    });

  results.push({
    id: 'occupiedBeforeBuilt',
    title: 'Occupied Before Built',
    description:
      'Houses that have tenant contracts starting before their specified commissioning date.',
    category: 'Logical',
    severity: 'warning',
    items: occupiedBeforeBuilt,
  });

  // --- CATEGORY: RELATIONSHIP (ORPHANS) ---

  // 6. Orphaned Houses
  const orphanedHousesList = allHouses.filter(
    h => !h.property_id && h.status !== 'property_deleted',
  );
  results.push({
    id: 'orphanedHouses',
    title: 'Orphaned Houses',
    description: 'Houses that are not assigned to any property.',
    category: 'Relationship',
    severity: 'warning',
    items: orphanedHousesList,
  });

  // 7. Orphaned Receipts
  const orphanedReceipts = allReceipts.filter(r => {
    const hasContract = allContracts.some(c => c.id === r.contract_id);
    const hasTenant = allTenants.some(t => t.id === r.tenant_id);
    return !hasContract && !hasTenant;
  });
  results.push({
    id: 'orphanedReceipts',
    title: 'Orphaned Receipts',
    description: 'Receipts that are not linked to any valid contract or tenant.',
    category: 'Relationship',
    severity: 'warning',
    items: orphanedReceipts,
  });

  // 8. Broken Maintenance Links
  const brokenMaint = allMaintenance.filter(m => {
    if (m.house_id && !allHouses.some(h => h.id === m.house_id)) return true;
    if (m.property_id && !allProperties.some(p => p.id === m.property_id)) return true;
    return false;
  });
  results.push({
    id: 'brokenMaintenance',
    title: 'Broken Maintenance Links',
    description: 'Maintenance requests referencing non-existent houses or properties.',
    category: 'Relationship',
    severity: 'info',
    items: brokenMaint,
  });

  // 28. Relationship: Orphaned Converted Bookings
  const orphanedBookings = allBookings
    .filter(b => {
      if (b.status !== 'converted') return false;
      if (!b.converted_tenant_id) return true; // Converted but no ID is also an issue
      return !allTenants.some(t => t.id === b.converted_tenant_id);
    })
    .map(b => ({
      ...b,
      name: b.name || `Booking ${b.id.substring(0, 8)}`,
      issue: 'Linked tenant not found or deleted',
      event_date: b.created_at,
    }));
  results.push({
    id: 'orphanedBookings',
    title: 'Orphaned Converted Bookings',
    description: 'Bookings marked as converted but referencing a non-existent tenant.',
    category: 'Relationship',
    severity: 'warning',
    items: orphanedBookings,
  });

  // --- CATEGORY: FINANCIAL RED FLAGS ---

  // 9. Duplicate Records (Grouped by M-Pesa Reference)
  const msgDups = findDuplicateGroups(allPaymentMessages, m => {
    let key = (m.message_content || '').trim();
    const match = key.match(/\b([a-zA-Z0-9]{10})\b/);
    if (match) {
      const ref = match[1].toUpperCase();
      if (/^[A-Z]/.test(ref) && /[0-9]/.test(ref)) {
        key = ref;
      }
    }
    return key || null;
  });

  const expDups = findDuplicateGroups(allExpenses, e =>
    `${e.amount}_${e.date}_${e.category}_${e.remarks}`.toLowerCase(),
  );

  results.push({
    id: 'duplicateDetection',
    title: 'Duplicate Records',
    description: 'Identical payment messages or expense entries found in the system.',
    category: 'Financial',
    severity: 'warning',
    items: [...msgDups, ...expDups],
    actionLabel: 'Clean Up',
  });

  // 10. Receipt Date Mismatches
  const dateMismatches = allReceipts
    .filter(r => {
      let meta = r.metadata;
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta);
        } catch {}
      }
      if (meta?.ignore_date_mismatch) return false;

      const c = allContracts.find(con => con.id === r.contract_id);
      if (!c?.start_date || !c.end_date) return false;
      const pDate = new Date(r.payment_date).getTime();
      const start = new Date(c.start_date).getTime();
      const end = new Date(c.end_date).getTime();
      const buffer = 30 * 24 * 60 * 60 * 1000;
      return pDate < start - buffer || pDate > end + buffer;
    })
    .map(r => {
      const tenant = allTenants.find(t => t.id === r.tenant_id);
      const contract = allContracts.find(c => c.id === r.contract_id);

      // Find a contract that actually covers this date
      const pDate = new Date(r.payment_date).getTime();
      const betterContract = allContracts.find(c => {
        if (c.tenant_id !== r.tenant_id) return false;
        if (!c.start_date || !c.end_date) return false;
        return (
          pDate >= new Date(c.start_date).getTime() &&
          pDate <= new Date(c.end_date).getTime()
        );
      });

      return {
        ...r,
        name: tenant?.name || `Receipt ${r.id.substring(0, 8)}`,
        contract_start: contract?.start_date,
        contract_end: contract?.end_date,
        better_contract_id: betterContract?.id,
        better_contract_label: betterContract
          ? `${formatDisplayDate(betterContract.start_date)} - ${formatDisplayDate(
              betterContract.end_date,
            )}`
          : null,
      };
    });
  results.push({
    id: 'receiptDateMismatches',
    title: 'Receipt Date Out-of-Range',
    description:
      'Receipts with payment dates significantly outside their contract dates.',
    category: 'Financial',
    severity: 'info',
    items: dateMismatches,
  });

  // --- CATEGORY: DATA QUALITY ---

  // 11. Duplicate Tenant Info
  const dupTenants = findDuplicateGroups(allTenants, t => t.phone?.trim() || null).map(
    list => {
      const val = list[0].phone?.trim();
      return {
        id: val,
        name: `Phone: ${val}`,
        type: 'Phone',
        val,
        list,
      };
    },
  );
  results.push({
    id: 'duplicateTenants',
    title: 'Duplicate Tenant Contacts',
    description: 'Multiple tenants sharing the same phone number.',
    category: 'Quality',
    severity: 'info',
    items: dupTenants,
  });

  // 12. Missing House Numbers
  const missingNumbers = allHouses.filter(
    h => !h.house_number?.trim() && h.status !== 'property_deleted',
  );
  results.push({
    id: 'missingHouseNumbers',
    title: 'Missing House Numbers',
    description: 'Houses with empty or missing house identification numbers.',
    category: 'Quality',
    severity: 'info',
    items: missingNumbers,
  });

  // --- NEW CHECKS ---

  // 13. Logical: Contract Date Sanity
  const invalidContractDates = allContracts
    .filter(c => {
      if (!c.start_date || !c.end_date) return false;
      return new Date(c.start_date) > new Date(c.end_date);
    })
    .map(c => ({ ...c, name: getContractName(c) }));
  results.push({
    id: 'invalidContractDates',
    title: 'Invalid Contract Dates',
    description: 'Contracts where the start date is later than the end date.',
    category: 'Logical',
    severity: 'critical',
    items: invalidContractDates,
  });

  // 14. Financial: Zero/Negative Rent
  const invalidRent = allContracts
    .filter(c => Number(c.rent_amount) <= 0)
    .map(c => ({ ...c, name: getContractName(c) }));
  results.push({
    id: 'invalidRent',
    title: 'Zero or Negative Rent',
    description: 'Contracts with a rent amount that is zero or negative.',
    category: 'Financial',
    severity: 'warning',
    items: invalidRent,
  });

  // 15. Financial: Zero/Negative Receipts
  const invalidReceipts = allReceipts.filter(r => Number(r.amount) <= 0);
  results.push({
    id: 'invalidReceipts',
    title: 'Zero or Negative Receipts',
    description: 'Receipts with an amount that is zero or negative.',
    category: 'Financial',
    severity: 'warning',
    items: invalidReceipts,
  });

  // 16. Financial: Zero/Negative Expenses
  const invalidExpenses = allExpenses.filter(e => Number(e.amount) <= 0);
  results.push({
    id: 'invalidExpenses',
    title: 'Zero or Negative Expenses',
    description: 'Expense records with an amount that is zero or negative.',
    category: 'Financial',
    severity: 'warning',
    items: invalidExpenses,
  });

  // 17. Quality: Uncontactable Tenants
  const uncontactable = allTenants.filter(
    t => !t.phone?.trim() && !t.email?.trim() && isActiveTenantStatus(t.status),
  );
  results.push({
    id: 'uncontactableTenants',
    title: 'Uncontactable Tenants',
    description: 'Active tenants who have neither a phone number nor an email address.',
    category: 'Quality',
    severity: 'warning',
    items: uncontactable,
  });

  // 18. Relationship: Contracts missing House or Tenant
  const brokenContracts = allContracts
    .filter(c => !c.house_id || !c.tenant_id)
    .map(c => ({ ...c, name: `Contract ID: ${c.id.substring(0, 8)}` }));
  results.push({
    id: 'brokenContracts',
    title: 'Broken Contract Links',
    description: 'Contracts that are missing either a house or a tenant reference.',
    category: 'Relationship',
    severity: 'critical',
    items: brokenContracts,
  });

  // 19. Quality: Empty Properties
  const emptyProperties = allProperties.filter(
    p => !allHouses.some(h => h.property_id === p.id),
  );
  results.push({
    id: 'emptyProperties',
    title: 'Empty Properties',
    description: 'Properties that have no houses or units assigned to them.',
    category: 'Quality',
    severity: 'info',
    items: emptyProperties,
  });

  // 21. Logical: Completed Maintenance without Date
  const missingMaintDates = allMaintenance.filter(
    m => m.status === 'completed' && !m.event_date,
  );
  results.push({
    id: 'missingMaintDates',
    title: 'Undated Completed Maintenance',
    description:
      'Maintenance requests marked as completed but missing the actual event date.',
    category: 'Logical',
    severity: 'info',
    items: missingMaintDates,
  });

  // 22. Logical: Promotion Date Sanity
  const invalidPromoDates = allPromos.filter((p: any) => {
    if (!p.valid_from || !p.valid_until) return false;
    return new Date(p.valid_from) > new Date(p.valid_until);
  });
  results.push({
    id: 'invalidPromoDates',
    title: 'Invalid Promotion Dates',
    description:
      'Promotions where the valid-from date is later than the valid-until date.',
    category: 'Logical',
    severity: 'warning',
    items: invalidPromoDates,
  });

  // 23. Financial: Over-Refunded Receipts
  const overRefunded = allReceipts.filter(
    r =>
      parseFloat(String((r as any).refunded_amount || 0)) >
      parseFloat(String(r.amount || 0)),
  );
  results.push({
    id: 'overRefundedReceipts',
    title: 'Over-Refunded Receipts',
    description:
      'Receipts where the total refunded amount exceeds the original payment amount.',
    category: 'Financial',
    severity: 'critical',
    items: overRefunded,
  });

  // 24. Logical: Duplicate House Numbers
  const duplicateHouses = findDuplicateGroups(allHouses, h => {
    if (!h.property_id || !h.house_number?.trim()) return null;
    return `${h.property_id}_${h.house_number.trim()}`;
  })
    .flat()
    .map(h => {
      const prop = allProperties.find(p => p.id === h.property_id);
      return {
        ...h,
        name: `${prop?.name || 'Unknown Property'} - ${h.house_number}`,
      };
    });
  results.push({
    id: 'duplicateHouses',
    title: 'Duplicate House Numbers',
    description:
      'Multiple houses sharing the same identification number within the same property.',
    category: 'Logical',
    severity: 'warning',
    items: duplicateHouses,
  });

  // 25. Relationship: Orphaned Promotions
  const orphanedPromos = allPromos.filter((p: any) => {
    if (
      p.scope === 'tenant' &&
      p.tenant_id &&
      !allTenants.some(t => t.id === p.tenant_id)
    )
      return true;
    if (
      p.scope === 'property' &&
      p.property_id &&
      !allProperties.some(prop => prop.id === p.property_id)
    )
      return true;
    return false;
  });
  results.push({
    id: 'orphanedPromos',
    title: 'Orphaned Promotions',
    description: 'Promotions linked to tenants or properties that no longer exist.',
    category: 'Relationship',
    severity: 'warning',
    items: orphanedPromos,
  });

  // 26. Logical: Former Contracts with Future End Date
  const formerFuture = allContracts
    .filter(c => {
      if (!isFormerContractStatus(c.status) || !c.end_date) return false;
      return new Date(c.end_date).getTime() > today.getTime();
    })
    .map(c => ({ ...c, name: getContractName(c) }));
  results.push({
    id: 'formerFutureContracts',
    title: 'Contracts with Future Dates',
    description:
      'Contracts marked as terminated or expired but having an end date in the future.',
    category: 'Logical',
    severity: 'warning',
    items: formerFuture,
  });

  // 27. Logical: Unconverted Bookings
  const unconvertedBookings = allBookings
    .filter(
      b =>
        b.status !== 'converted' && b.status !== 'rejected' && b.status !== 'cancelled',
    )
    .map(b => ({
      ...b,
      name: b.name || `Booking ${b.id.substring(0, 8)}`,
      issue: `Status: ${String(b.status || 'pending').toUpperCase()}`,
      event_date: b.created_at,
    }));
  results.push({
    id: 'unconvertedBookings',
    title: 'Unconverted Bookings',
    description: 'Bookings that are still in pending, approved, or reserved status.',
    category: 'Logical',
    severity: 'info',
    items: unconvertedBookings,
  });

  // 28. Quality: Unformatted Amounts in Payment Messages
  const unformattedMsgAmounts = allPaymentMessages.filter(m =>
    hasUnformattedAmount(m.message_content),
  );
  results.push({
    id: 'unformattedMsgAmounts',
    title: 'Unformatted Message Amounts',
    description: 'Payment messages containing amounts missing thousands separators.',
    category: 'Quality',
    severity: 'info',
    items: unformattedMsgAmounts,
  });

  // 29. Quality: Unformatted Amounts in Receipts
  const unformattedReceiptAmounts = allReceipts.filter(r =>
    hasUnformattedAmount(r.notes),
  );
  results.push({
    id: 'unformattedReceiptAmounts',
    title: 'Unformatted Receipt Amounts',
    description: 'Receipts containing amounts missing thousands separators in notes.',
    category: 'Quality',
    severity: 'info',
    items: unformattedReceiptAmounts,
  });

  // 30. Quality: Unmasked Phone Numbers in Payment Messages
  const phoneRegex = /\b(?:\+?254[17]\d{3}|0[17]\d{3})(\d{3})(\d{2})\b/;
  const unmaskedMsgPhones = allPaymentMessages.filter(
    m => m.message_content && phoneRegex.test(m.message_content),
  );
  results.push({
    id: 'unmaskedMsgPhones',
    title: 'Unmasked Message Phone Numbers',
    description: 'Payment messages containing unmasked customer phone numbers.',
    category: 'Quality',
    severity: 'warning',
    items: unmaskedMsgPhones,
  });

  // 31. Quality: Unmasked Phone Numbers in Receipts
  const unmaskedReceiptPhones = allReceipts.filter(
    r => r.notes && phoneRegex.test(r.notes),
  );
  results.push({
    id: 'unmaskedReceiptPhones',
    title: 'Unmasked Receipt Phone Numbers',
    description: 'Receipts containing unmasked customer phone numbers in notes.',
    category: 'Quality',
    severity: 'warning',
    items: unmaskedReceiptPhones,
  });

  // 32. Quality: Lowercase References in Receipts
  const lowercaseReceiptRefs = allReceipts.filter(r => {
    if (!r.notes) return false;
    const matches = r.notes.match(/\b([a-zA-Z0-9]{10})\b/g);
    if (!matches) return false;
    return matches.some(
      (m: string) => /[a-zA-Z]/.test(m) && /[0-9]/.test(m) && m !== m.toUpperCase(),
    );
  });
  results.push({
    id: 'lowercaseReceiptRefs',
    title: 'Lowercase Receipt References',
    description:
      'Receipts containing 10-character references that are not fully uppercase.',
    category: 'Quality',
    severity: 'info',
    items: lowercaseReceiptRefs,
  });

  return results;
};

export const extractDuplicateGroups = (
  table: 'payment_messages' | 'expenses',
  allPaymentMessages: any[],
  allExpenses: any[],
): any[] => {
  const groupsMap: Record<string, any[]> = {};
  if (table === 'payment_messages') {
    allPaymentMessages.forEach(msg => {
      let key = (msg.message_content || '').trim();
      const match = key.match(/\b([a-zA-Z0-9]{10})\b/);
      if (match) {
        const ref = match[1].toUpperCase();
        if (/^[A-Z]/.test(ref) && /[0-9]/.test(ref)) {
          key = ref;
        }
      }
      if (key) {
        if (!groupsMap[key]) groupsMap[key] = [];
        groupsMap[key].push(msg);
      }
    });
  } else {
    allExpenses.forEach(exp => {
      const key =
        `${exp.amount}_${exp.date}_${exp.category}_${exp.remarks}`.toLowerCase();
      if (!groupsMap[key]) groupsMap[key] = [];
      groupsMap[key].push(exp);
    });
  }

  return Object.entries(groupsMap)
    .filter(([_, list]) => list.length > 1)
    .map(([key, list], index) => ({
      id: `group-${table}-${index}`,
      key,
      title:
        table === 'payment_messages'
          ? /^[A-Z0-9]{10}$/.test(key)
            ? `Ref: ${key}`
            : (list[0].message_content || '').substring(0, 50)
          : `${list[0].category} - ${list[0].amount}`,
      records: list,
    }));
};
