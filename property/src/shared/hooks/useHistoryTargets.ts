import { useMemo } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import type { AuditLogTarget } from '@/shared/hooks/useAuditLog';
import {
  useContractsByHouseId,
  useContractsByTenantId,
  useHousesById,
  useHousesByPropertyId,
  useReceiptsByContractId,
  useReceiptsByTenantId,
  useTenantsById,
} from '@/shared/hooks/useStore';

export function useHistoryTargets(
  entityType: string,
  entityId: string | null | undefined,
): AuditLogTarget[] {
  const { selectedBusiness } = useBusiness();
  const bid = selectedBusiness?.id;

  const housesById = useHousesById(bid);
  const tenantsById = useTenantsById(bid);
  const housesByProperty = useHousesByPropertyId(bid);
  const contractsByHouse = useContractsByHouseId(bid);
  const contractsByTenant = useContractsByTenantId(bid);
  const receiptsByContract = useReceiptsByContractId(bid);
  const receiptsByTenant = useReceiptsByTenantId(bid);

  return useMemo(() => {
    if (!entityId) return [];

    const targets: AuditLogTarget[] = [];

    const pushTarget = (type: string, id: string, label?: string) => {
      targets.push({ entityType: type, entityId: id, label });
    };

    const getHouseStr = (houseId: string | null | undefined) => {
      if (!houseId) return 'Unknown House';
      const h = housesById.get(houseId);
      return h ? `House ${h.house_number}` : 'Unknown House';
    };

    const getTenantStr = (tenantId: string | null | undefined) => {
      if (!tenantId) return 'Unknown Tenant';
      const t = tenantsById.get(tenantId);
      return t ? t.name : 'Unknown Tenant';
    };

    const getReceiptHouseStr = (receipt: any) => {
      let houseId = receipt.house_id;
      if (!houseId && receipt.contract_id) {
        const tenantContracts = contractsByTenant.get(receipt.tenant_id) || [];
        const c = tenantContracts.find((x: any) => x.id === receipt.contract_id);
        if (c) houseId = c.house_id;
      }
      return getHouseStr(houseId);
    };

    switch (entityType) {
      case 'properties': {
        const propertyHouses = housesByProperty.get(entityId) || [];
        for (const h of propertyHouses) {
          pushTarget('houses', h.id, h.house_number);
          const houseContracts = contractsByHouse.get(h.id) || [];
          for (const c of houseContracts) {
            pushTarget('contracts', c.id, getHouseStr(c.house_id));
          }
        }
        break;
      }
      case 'houses': {
        const houseContracts = contractsByHouse.get(entityId) || [];
        for (const c of houseContracts) {
          pushTarget('contracts', c.id, getTenantStr(c.tenant_id));
        }
        break;
      }
      case 'tenants': {
        const tenantContracts = contractsByTenant.get(entityId) || [];
        for (const c of tenantContracts) {
          pushTarget('contracts', c.id, getHouseStr(c.house_id));
        }
        const tenantReceipts = receiptsByTenant.get(entityId) || [];
        for (const r of tenantReceipts) {
          pushTarget('receipts', r.id, getReceiptHouseStr(r));
        }
        break;
      }
      case 'contracts': {
        const contractReceipts = receiptsByContract.get(entityId) || [];
        for (const r of contractReceipts) {
          pushTarget('receipts', r.id, `(${r.id.slice(-6).toUpperCase()})`);
        }
        break;
      }
      default:
        break;
    }

    return targets;
  }, [
    entityType,
    entityId,
    housesById,
    tenantsById,
    housesByProperty,
    contractsByHouse,
    contractsByTenant,
    receiptsByContract,
    receiptsByTenant,
  ]);
}
