import { normalizePhoneNumber } from '@/shared/utils/helper';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';

export interface MatchResult {
  tenantId: string;
  confidence: number; // 0 to 1
  reason: string;
  matchedSource?: string | null;
  matchedValue?: string | null;
}

function normalizePhone(phone: string): string {
  if (!phone) return '';
  const e164 = normalizePhoneNumber(phone);
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

function calculateNameMatch(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  if (n1 === n2) return 1;

  const words1 = n1.split(/\s+/).filter(w => w.length > 2);
  const words2 = n2.split(/\s+/).filter(w => w.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  let matches = 0;
  for (const w1 of words1) {
    if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
      matches++;
    }
  }

  return matches / Math.max(words1.length, words2.length);
}

export function findSuggestedTenants(
  message: string,
  tenants: any[],
  contracts: any[],
  allMessages: any[] = [],
  messageReceipts: any[] = [],
  receipts: any[] = [],
): MatchResult[] {
  const results: MatchResult[] = [];

  if (!message || typeof message !== 'string') {
    return results;
  }

  const phoneMatch = message.match(/\b(\+?254|0[17]|[\d*]{7,})\b/);
  const msgPhone = phoneMatch ? normalizePhone(phoneMatch[0]) : null;

  let msgName = '';
  const nameMatch = message.match(/from\s+(.*?)\s+(?:Phone|No\.|received|via)/i);
  if (nameMatch) {
    msgName = nameMatch[1].trim();
  }

  const historyMap = new Map<
    string,
    { count: number; lastUsed: string; source?: string }
  >();

  const phoneToTenants = new Map<string, Set<string>>();

  if (allMessages.length > 0 && messageReceipts.length > 0) {
    allMessages.forEach(oldMsg => {
      const links = messageReceipts.filter(r => r.payment_message_id === oldMsg.id);
      links.forEach(link => {
        const receipt = receipts.find(r => r.id === link.receipt_id);
        if (receipt?.tenant_id) {
          const tenantId = receipt.tenant_id;

          const oldPhoneMatch = oldMsg.message_content?.match(
            /\b(\+?254|0[17]|[\d*]{7,})\b/,
          );
          const oldPhone = oldPhoneMatch ? normalizePhone(oldPhoneMatch[0]) : null;

          if (oldPhone) {
            const tenantsForPhone = phoneToTenants.get(oldPhone) || new Set<string>();
            tenantsForPhone.add(tenantId);
            phoneToTenants.set(oldPhone, tenantsForPhone);

            if (msgPhone && oldPhone === msgPhone) {
              const entry = historyMap.get(tenantId) || {
                count: 0,
                lastUsed: '',
                source: oldMsg.message_content,
              };
              entry.count += 10;
              historyMap.set(tenantId, entry);
            }
          }

          const oldNameMatch = oldMsg.message_content?.match(
            /from\s+(.*?)\s+(?:Phone|No\.|received|via)/i,
          );
          const oldName = oldNameMatch ? oldNameMatch[1].trim() : '';

          if (msgName && oldName === msgName) {
            const entry = historyMap.get(tenantId) || {
              count: 0,
              lastUsed: '',
              source: oldMsg.message_content,
            };
            entry.count += 5;
            historyMap.set(tenantId, entry);
          }
        }
      });
    });

    if (msgPhone) {
      const tenantsForCurrentPhone = phoneToTenants.get(msgPhone);
      if (tenantsForCurrentPhone && tenantsForCurrentPhone.size > 1) {
        tenantsForCurrentPhone.forEach(tId => {
          const entry = historyMap.get(tId);
          if (entry && entry.count >= 10) {
            historyMap.delete(tId);
          }
        });
      }
    }
  }

  for (const tenant of tenants) {
    let confidence = 0;
    let reason = '';
    let matchedSource;
    let matchedValue;

    // A. History match
    const history = historyMap.get(tenant.id);
    if (history) {
      matchedSource = history.source;
      if (history.count >= 10) {
        confidence = 0.98;
        reason = 'Recurring phone';
        matchedValue = msgPhone;
      } else if (history.count >= 5) {
        confidence = 0.95;
        reason = 'Recurring name';
        matchedValue = msgName;
      }
    }

    // B. Phone match
    if (confidence < 0.9 && msgPhone && tenant.phone) {
      if (normalizePhone(tenant.phone) === msgPhone) {
        confidence = Math.max(confidence, 0.9);
        reason = 'Phone number match';
        matchedValue = msgPhone;
      }
    }

    // C. Name match
    if (confidence < 0.7 && msgName && tenant.name) {
      const nameScore = calculateNameMatch(msgName, tenant.name);
      if (nameScore > 0.5) {
        const newConfidence = 0.5 + nameScore * 0.3; // Scale to 0.5 - 0.8
        if (newConfidence > confidence) {
          confidence = newConfidence;
          reason = `Name match (${Math.round(nameScore * 100)}%)`;
          matchedValue = msgName;
        }
      }
    }

    if (confidence > 0.3) {
      const hasActiveContract = contracts.some(
        c => c.tenant_id === tenant.id && isActiveContractStatus(c.status),
      );

      if (hasActiveContract) {
        confidence = Math.min(0.99, confidence + 0.1);
      } else {
        if (confidence < 0.9) confidence *= 0.5;
      }

      if (confidence > 0.2) {
        results.push({
          tenantId: tenant.id,
          confidence,
          reason,
          matchedSource,
          matchedValue,
        });
      }
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
