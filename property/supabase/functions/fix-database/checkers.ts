import { formatDateForDB } from '../_shared/date-utils.ts';
import type { AnomaliesList, DBData, Fix } from './types.ts';

const isActiveTenant = (s: string) => s === 'active' || s === 'expiring_soon';
const isActiveContract = (s: string) =>
  s === 'active' || s === 'expiring_soon' || s === 'renewed';
const isFormerContract = (s: string) => s === 'terminated' || s === 'expired';

export async function checkStatusAnomalies(
  data: DBData,
  anomalies: AnomaliesList,
  fixes: Fix[],
  action: string,
  supabaseClient: any,
) {
  const { tenants, contracts, receipts, houses } = data;
  const todayStr = formatDateForDB(new Date());
  const currentPeriod = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // 1. Tenants without contracts
  for (const t of tenants) {
    if (isActiveTenant(t.status)) {
      const hasActive = contracts.some(
        (c: any) => c.tenant_id === t.id && isActiveContract(c.status),
      );
      if (!hasActive) {
        anomalies.tenantsWithoutContracts.push({
          id: t.id,
          name: t.name,
          issue: 'Active but no active contract',
        });
        if (action === 'fix') {
          const tContracts = contracts.filter((c: any) => c.tenant_id === t.id);
          const lastC = [...tContracts].sort((a: any, b: any) =>
            (b.end_date || '').localeCompare(a.end_date || ''),
          )[0];
          await supabaseClient
            .from('tenants')
            .update({ status: 'former' })
            .eq('id', t.id);
          if (lastC) {
            await supabaseClient
              .from('contracts')
              .update({ status: 'terminated', end_date: todayStr })
              .eq('id', lastC.id);
            if (lastC.house_id) {
              await supabaseClient
                .from('houses')
                .update({ status: 'available' })
                .eq('id', lastC.house_id);
            }
          }
          fixes.push({
            type: 'Tenant',
            id: t.id,
            action: 'Marked former (missing contract)',
          });
        }
      }
    }
  }

  // 2. Paid Tenants with Status Issues
  for (const t of tenants) {
    const hasRecentPayment = receipts.some(r => {
      if (r.tenant_id !== t.id || !r.payment_period) return false;
      const pDate = new Date(String(r.payment_period));
      return !Number.isNaN(pDate.getTime()) && pDate >= currentPeriod;
    });
    if (hasRecentPayment) {
      const isActive =
        isActiveTenant(t.status) &&
        contracts.some((c: any) => c.tenant_id === t.id && isActiveContract(c.status));
      if (!isActive) {
        anomalies.paidTenantsWithoutStatus.push({
          id: t.id,
          name: t.name,
          issue: 'Paid for future but inactive',
        });
      }
    }
  }

  // 3. House Status Mismatch
  for (const h of houses) {
    const hasActiveContract = contracts.some(
      (c: any) => c.house_id === h.id && isActiveContract(c.status),
    );
    let issue = '';
    if (h.status === 'available' && hasActiveContract) {
      issue = 'Marked Available but has Active Contract';
    } else if (
      h.status !== 'available' &&
      !hasActiveContract &&
      h.is_serviceable &&
      h.status !== 'property_deleted'
    ) {
      issue = 'Marked Occupied but has No Active Contract';
    }
    if (issue) {
      anomalies.houseStatusMismatches.push({ id: h.id, name: h.house_number, issue });
      if (action === 'fix') {
        const newStatus = hasActiveContract ? 'occupied' : 'available';
        await supabaseClient.from('houses').update({ status: newStatus }).eq('id', h.id);
        fixes.push({ type: 'House', id: h.id, action: `Set status to ${newStatus}` });
      }
    }
  }
}

export async function checkLogicalAnomalies(
  data: DBData,
  anomalies: AnomaliesList,
  fixes: Fix[],
  action: string,
  supabaseClient: any,
) {
  const { houses, contracts, maintenanceReqs, promotionList, bookings } = data;
  const today = new Date();
  const todayStr = formatDateForDB(today);

  for (const h of houses) {
    const active = contracts
      .filter((c: any) => c.house_id === h.id && isActiveContract(c.status))
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
    if (active.length > 1) {
      for (let i = 0; i < active.length - 1; i++) {
        const c1 = active[i];
        const c2 = active[i + 1];
        if (c1.end_date && c2.start_date && c1.end_date >= c2.start_date) {
          anomalies.overlappingContracts.push({
            id: h.id,
            name: h.house_number,
            issue: `Overlapping contracts: ${c1.id.substring(0, 8)} & ${c2.id.substring(0, 8)}`,
          });
        }
      }
    }
  }

  for (const c of contracts) {
    if (c.start_date && c.end_date && new Date(c.start_date) > new Date(c.end_date)) {
      anomalies.invalidContractDates.push({
        id: c.id,
        issue: 'Start date after end date',
      });
    }
    if (
      isFormerContract(c.status) &&
      c.end_date &&
      new Date(c.end_date).getTime() > today.getTime()
    ) {
      anomalies.formerFutureContracts.push({
        id: c.id,
        issue: 'Former but future end date',
      });
      if (action === 'fix') {
        await supabaseClient
          .from('contracts')
          .update({ end_date: todayStr })
          .eq('id', c.id);
        fixes.push({ type: 'Contract', id: c.id, action: 'Set end_date to today' });
      }
    }
  }

  for (const m of maintenanceReqs) {
    if (m.status === 'completed' && !m.event_date) {
      anomalies.missingMaintDates.push({ id: m.id, issue: 'Completed but missing date' });
    }
  }

  for (const p of promotionList) {
    if (
      p.valid_from &&
      p.valid_until &&
      new Date(p.valid_from) > new Date(p.valid_until)
    ) {
      anomalies.invalidPromoDates.push({ id: p.id, issue: 'From date after until date' });
    }
  }

  const propHouseMap: Record<string, Record<string, any[]>> = {};
  for (const h of houses) {
    if (!h.property_id || !h.house_number || h.status === 'property_deleted') continue;
    if (!propHouseMap[h.property_id]) propHouseMap[h.property_id] = {};
    const hn = h.house_number.trim();
    if (!propHouseMap[h.property_id][hn]) propHouseMap[h.property_id][hn] = [];
    propHouseMap[h.property_id][hn].push(h);
  }
  for (const houseMap of Object.values(propHouseMap)) {
    for (const list of Object.values(houseMap)) {
      if (list.length > 1) {
        for (const h of list)
          anomalies.duplicateHouses.push({ id: h.id, name: h.house_number });
      }
    }
  }

  for (const b of bookings) {
    if (['pending', 'approved', 'reserved'].includes(b.status) && !b.deleted) {
      anomalies.unconvertedBookings.push({
        id: b.id,
        name: b.name,
        issue: `Status: ${b.status}`,
      });
    }
  }
}

export async function checkRelationshipAnomalies(
  data: DBData,
  anomalies: AnomaliesList,
  fixes: Fix[],
  action: string,
  supabaseClient: any,
) {
  const {
    houses,
    receipts,
    contracts,
    tenants,
    maintenanceReqs,
    promotionList,
    bookings,
  } = data;

  for (const h of houses) {
    if (!h.property_id && h.status !== 'property_deleted') {
      anomalies.orphanedHouses.push({ id: h.id, name: h.house_number });
    }
  }

  for (const r of receipts) {
    const hasC = contracts.some((c: any) => c.id === r.contract_id);
    const hasT = tenants.some((t: any) => t.id === r.tenant_id);
    if (!hasC && !hasT) {
      anomalies.orphanedReceipts.push({ id: r.id, issue: 'No valid link' });
      if (action === 'fix') {
        await supabaseClient.from('receipts').update({ deleted: true }).eq('id', r.id);
        fixes.push({ type: 'Receipt', id: r.id, action: 'Soft-deleted (orphaned)' });
      }
    }
  }

  for (const m of maintenanceReqs) {
    if (m.house_id && !houses.some((h: any) => h.id === m.house_id)) {
      anomalies.brokenMaintenance.push({ id: m.id, issue: 'Invalid house reference' });
    }
  }

  for (const c of contracts) {
    if (!c.house_id || !c.tenant_id) {
      anomalies.brokenContracts.push({ id: c.id, issue: 'Missing house or tenant' });
      if (action === 'fix') {
        await supabaseClient.from('contracts').update({ deleted: true }).eq('id', c.id);
        fixes.push({ type: 'Contract', id: c.id, action: 'Soft-deleted (broken)' });
      }
    }
  }

  for (const p of promotionList) {
    if (
      p.scope === 'tenant' &&
      p.tenant_id &&
      !tenants.some((t: any) => t.id === p.tenant_id)
    ) {
      anomalies.orphanedPromos.push({ id: p.id, issue: 'Linked tenant deleted' });
    }
  }

  for (const b of bookings) {
    if (
      b.status === 'converted' &&
      b.converted_tenant_id &&
      !tenants.some((t: any) => t.id === b.converted_tenant_id)
    ) {
      anomalies.orphanedBookings.push({
        id: b.id,
        name: b.name,
        issue: 'Converted tenant deleted',
      });
      if (action === 'fix') {
        await supabaseClient
          .from('bookings')
          .update({ status: 'pending', converted_tenant_id: null })
          .eq('id', b.id);
        fixes.push({ type: 'Booking', id: b.id, action: 'Reset to pending (orphaned)' });
      }
    }
  }
}

export async function checkFinancialAnomalies(
  data: DBData,
  anomalies: AnomaliesList,
  fixes: Fix[],
  action: string,
  supabaseClient: any,
) {
  const { paymentMessages, receipts, contracts, expenses } = data;

  const msgLog: Record<string, string[]> = {};
  for (const m of paymentMessages) {
    const key = (m.message_content || '').trim();
    if (!key) continue;
    if (!msgLog[key]) msgLog[key] = [];
    msgLog[key].push(m.id);
  }
  for (const ids of Object.values(msgLog)) {
    if (ids.length > 1) {
      for (let i = 1; i < ids.length; i++) {
        anomalies.duplicateDetection.push({ id: ids[i], type: 'Payment Message' });
      }
    }
  }

  for (const r of receipts) {
    const c = contracts.find((con: any) => con.id === r.contract_id);
    if (!c?.start_date || !c.end_date) continue;
    const pTime = new Date(r.payment_date).getTime();
    const sTime = new Date(c.start_date).getTime();
    const eTime = new Date(c.end_date).getTime();
    const buff = 30 * 24 * 60 * 60 * 1000;
    if (pTime < sTime - buff || pTime > eTime + buff) {
      anomalies.receiptDateMismatches.push({ id: r.id, issue: 'Out of contract range' });
      if (action === 'fix') {
        const betterC = contracts.find((con: any) => {
          if (con.tenant_id !== r.tenant_id || !con.start_date || !con.end_date)
            return false;
          const t = new Date(r.payment_date).getTime();
          return (
            t >= new Date(con.start_date).getTime() &&
            t <= new Date(con.end_date).getTime()
          );
        });
        if (betterC) {
          await supabaseClient
            .from('receipts')
            .update({ contract_id: betterC.id })
            .eq('id', r.id);
          fixes.push({
            type: 'Receipt',
            id: r.id,
            action: `Re-linked to ${betterC.id.substring(0, 8)}`,
          });
        } else {
          const nStart = pTime < sTime ? r.payment_date : c.start_date;
          const nEnd = pTime > eTime ? r.payment_date : c.end_date;
          await supabaseClient
            .from('contracts')
            .update({ start_date: nStart, end_date: nEnd })
            .eq('id', c.id);
          fixes.push({
            type: 'Contract',
            id: c.id,
            action: 'Expanded dates to cover receipt',
          });
        }
      }
    }
  }

  for (const c of contracts) {
    if (Number(c.rent_amount) <= 0) anomalies.invalidRent.push({ id: c.id });
  }
  for (const r of receipts) {
    if (Number(r.amount) <= 0) anomalies.invalidReceipts.push({ id: r.id });
    if (Number(r.refunded_amount) > Number(r.amount))
      anomalies.overRefundedReceipts.push({ id: r.id });
  }
  for (const e of expenses) {
    if (Number(e.amount) <= 0) anomalies.invalidExpenses.push({ id: e.id });
  }
}

export function checkQualityAnomalies(data: DBData, anomalies: AnomaliesList) {
  const { tenants, houses, properties } = data;

  const phMap: Record<string, string[]> = {};
  for (const t of tenants) {
    if (t.phone) {
      const p = t.phone.trim();
      if (!phMap[p]) phMap[p] = [];
      phMap[p].push(t.id);
    }
  }
  for (const ids of Object.values(phMap)) {
    if (ids.length > 1) {
      for (const id of ids) anomalies.duplicateTenants.push({ id });
    }
  }

  for (const h of houses) {
    if (!h.house_number?.trim() && h.status !== 'property_deleted') {
      anomalies.missingHouseNumbers.push({ id: h.id });
    }
  }

  for (const t of tenants) {
    if (isActiveTenant(t.status) && !t.phone?.trim() && !t.email?.trim()) {
      anomalies.uncontactableTenants.push({ id: t.id, name: t.name });
    }
  }

  for (const p of properties) {
    if (!houses.some((h: any) => h.property_id === p.id)) {
      anomalies.emptyProperties.push({ id: p.id, name: p.name });
    }
  }
}
