import type { AnomaliesList, Fix } from './types.ts';

export function buildIntegrityEmail(
  businessName: string,
  anomalies: AnomaliesList,
  fixes: Fix[],
  action: string,
): string {
  const anomaliesCount = Object.values(anomalies).reduce(
    (acc, curr) => acc + curr.length,
    0,
  );

  const emailLines: string[] = [
    `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.4;">`,
    `  <p>Hello ${businessName},</p>`,
    `  <p>The scheduled integrity check for your business database has completed. We found <strong>${anomaliesCount}</strong> potential issues.</p>`,
  ];

  if (anomaliesCount > 0) {
    emailLines.push(`  <h4 style="margin-bottom: 4px;">Detected Anomalies:</h4>`);
    emailLines.push(`  <ul style="margin-top: 0; padding-left: 20px;">`);

    const addCategory = (title: string, list: any[]) => {
      if (list.length === 0) return;
      const count = list.length;
      let example = list[0].issue || list[0].name || list[0].type || 'Unknown issue';
      if (list[0].id) {
        example += ` (e.g. ID: ${list[0].id.substring(0, 8)})`;
      }
      emailLines.push(
        `    <li><strong>${title}:</strong> ${count} found - <em>${example}</em></li>`,
      );
    };

    addCategory('Tenants without Contracts', anomalies.tenantsWithoutContracts);
    addCategory('Paid Tenants Inactive', anomalies.paidTenantsWithoutStatus);
    addCategory('House Status Mismatches', anomalies.houseStatusMismatches);
    addCategory('Overlapping Contracts', anomalies.overlappingContracts);
    addCategory('Invalid Contract Dates', anomalies.invalidContractDates);
    addCategory('Missing Maintenance Dates', anomalies.missingMaintDates);
    addCategory('Invalid Promo Dates', anomalies.invalidPromoDates);
    addCategory('Duplicate Houses', anomalies.duplicateHouses);
    addCategory('Former but Future Contracts', anomalies.formerFutureContracts);
    addCategory('Unconverted Bookings', anomalies.unconvertedBookings);
    addCategory('Orphaned Houses', anomalies.orphanedHouses);
    addCategory('Orphaned Receipts', anomalies.orphanedReceipts);
    addCategory('Broken Maintenance', anomalies.brokenMaintenance);
    addCategory('Broken Contracts', anomalies.brokenContracts);
    addCategory('Orphaned Promos', anomalies.orphanedPromos);
    addCategory('Orphaned Bookings', anomalies.orphanedBookings);
    addCategory('Duplicate Transactions', anomalies.duplicateDetection);
    addCategory('Receipt Date Mismatches', anomalies.receiptDateMismatches);
    addCategory('Invalid Rent Amounts', anomalies.invalidRent);
    addCategory('Invalid Receipt Amounts', anomalies.invalidReceipts);
    addCategory('Invalid Expense Amounts', anomalies.invalidExpenses);
    addCategory('Over-refunded Receipts', anomalies.overRefundedReceipts);
    addCategory('Duplicate Tenants', anomalies.duplicateTenants);
    addCategory('Missing House Numbers', anomalies.missingHouseNumbers);
    addCategory('Uncontactable Tenants', anomalies.uncontactableTenants);
    addCategory('Empty Properties', anomalies.emptyProperties);

    emailLines.push(`  </ul>`);
  }

  if (action === 'fix' && fixes.length > 0) {
    emailLines.push(
      `  <h4 style="margin-bottom: 4px;">Fixes Applied (${fixes.length}):</h4>`,
    );
    emailLines.push(`  <ul style="margin-top: 0; padding-left: 20px;">`);

    const groupedFixes: Record<string, number> = {};
    for (const f of fixes) {
      const key = `${f.type}: ${f.action}`;
      groupedFixes[key] = (groupedFixes[key] || 0) + 1;
    }

    for (const [actionLabel, count] of Object.entries(groupedFixes)) {
      emailLines.push(`    <li>${actionLabel} (Count: ${count})</li>`);
    }

    emailLines.push(`  </ul>`);
  }

  emailLines.push(
    `  <p>You can view full details and manage your properties directly from your application dashboard.</p>`,
    `  <p>Best regards,<br><strong>The ${businessName} Team</strong></p>`,
    `</div>`,
  );

  return emailLines.join('\n');
}
