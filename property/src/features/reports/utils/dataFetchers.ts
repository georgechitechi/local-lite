import { getSyncClient } from '@/shared/services/sync/client';
import type { ReportType } from './types';

export const getJoinedReportData = async (
  type: ReportType,
  businessId: string,
): Promise<unknown[]> => {
  const client = await getSyncClient().catch(() => null);

  // On-demand table fetcher with local-lite SQLite
  const getTable = async (tableName: string): Promise<any[]> => {
    if (client) {
      try {
        const rows = await client.findMany(tableName, {
          where: { business_id: businessId },
        });
        if (rows && rows.length > 0) {
          return rows.filter((r: any) => !r.deleted);
        }
      } catch (_e) {
        return [];
      }
    }
    return [];
  };

  const toMap = (items: any[]) => {
    const map: Record<string, any> = {};
    for (const item of items) {
      if (item?.id) map[item.id] = item;
    }
    return map;
  };

  switch (type) {
    case 'expenses':
    case 'expenses_analysis': {
      return await getTable('expenses');
    }

    case 'pending_rent': {
      const receipts = await getTable('receipts');
      return receipts.filter((r: any) => r.status === 'pending');
    }

    case 'houses': {
      const [houses, properties, contracts, tenants] = await Promise.all([
        getTable('houses'),
        getTable('properties'),
        getTable('contracts'),
        getTable('tenants'),
      ]);
      const propertiesById = toMap(properties);
      const tenantsById = toMap(tenants);

      return houses.map((h: any) => {
        const hContracts = contracts
          .filter((c: any) => c.house_id === h.id)
          .map((c: any) => ({
            ...c,
            tenant: tenantsById[c.tenant_id],
          }));

        return {
          ...h,
          property: propertiesById[h.property_id],
          contracts: hContracts,
        };
      });
    }

    case 'tenants': {
      const [tenants, contracts, houses, properties] = await Promise.all([
        getTable('tenants'),
        getTable('contracts'),
        getTable('houses'),
        getTable('properties'),
      ]);
      const housesById = toMap(houses);
      const propertiesById = toMap(properties);

      return tenants.map((t: any) => {
        const tContracts = contracts
          .filter((c: any) => c.tenant_id === t.id)
          .map((c: any) => {
            const h = housesById[c.house_id];
            return {
              ...c,
              house: h ? { ...h, property: propertiesById[h.property_id] } : null,
            };
          });

        return {
          ...t,
          contracts: tContracts,
        };
      });
    }

    case 'contracts':
    case 'expiring_contracts': {
      const [contracts, tenants, houses, properties] = await Promise.all([
        getTable('contracts'),
        getTable('tenants'),
        getTable('houses'),
        getTable('properties'),
      ]);
      const housesById = toMap(houses);
      const propertiesById = toMap(properties);
      const tenantsById = toMap(tenants);

      return contracts.map((c: any) => {
        const h = housesById[c.house_id];
        return {
          ...c,
          tenant: tenantsById[c.tenant_id],
          house: h ? { ...h, property: propertiesById[h.property_id] } : null,
        };
      });
    }

    case 'receipts':
    case 'rent_collection':
    case 'refunds': {
      const [receipts, contracts, houses, properties, tenants] = await Promise.all([
        getTable('receipts'),
        getTable('contracts'),
        getTable('houses'),
        getTable('properties'),
        getTable('tenants'),
      ]);
      const contractsById = toMap(contracts);
      const housesById = toMap(houses);
      const propertiesById = toMap(properties);
      const tenantsById = toMap(tenants);

      const filteredReceipts =
        type === 'refunds'
          ? receipts.filter(
              (r: any) => parseFloat(String(r.refunded_amount || 0)) > 0 || r.is_refunded,
            )
          : receipts;

      return filteredReceipts
        .map((r: any) => {
          const c = contractsById[r.contract_id];
          if (!c && type === 'receipts') return null;

          const h = c ? housesById[c.house_id] : null;
          if (!h && type === 'receipts') return null;

          return {
            ...r,
            contract: c
              ? {
                  ...c,
                  tenant: tenantsById[c.tenant_id],
                  house: h ? { ...h, property: propertiesById[h.property_id] } : null,
                }
              : null,
          };
        })
        .filter(Boolean);
    }

    case 'vacant_rooms': {
      const [houses, properties, contracts] = await Promise.all([
        getTable('houses'),
        getTable('properties'),
        getTable('contracts'),
      ]);
      const propertiesById = toMap(properties);
      const vacantHouses = houses.filter((h: any) => h.status === 'available');

      return vacantHouses.map((h: any) => ({
        ...h,
        property: propertiesById[h.property_id],
        lastContract:
          contracts
            .filter((c: any) => c.house_id === h.id)
            .sort(
              (a: any, b: any) =>
                new Date(b.end_date || 0).getTime() - new Date(a.end_date || 0).getTime(),
            )[0] || null,
      }));
    }

    case 'occupancy_rate': {
      const [houses, properties, contracts] = await Promise.all([
        getTable('houses'),
        getTable('properties'),
        getTable('contracts'),
      ]);
      const propertiesById = toMap(properties);

      return houses.map((h: any) => ({
        ...h,
        property: propertiesById[h.property_id],
        contracts: contracts.filter((c: any) => c.house_id === h.id),
      }));
    }

    case 'maintenance': {
      const maintenanceReqs = await getTable('maintenance_requests');
      const [properties, houses, tenants] = await Promise.all([
        getTable('properties'),
        getTable('houses'),
        getTable('tenants'),
      ]);
      const propertiesById = toMap(properties);
      const housesById = toMap(houses);
      const tenantsById = toMap(tenants);

      return maintenanceReqs.map((m: any) => ({
        ...m,
        property: m.property_id ? propertiesById[m.property_id] : null,
        house: m.house_id ? housesById[m.house_id] : null,
        tenant: m.tenant_id ? tenantsById[m.tenant_id] : null,
      }));
    }

    case 'stay_history': {
      const bookings = await getTable('bookings');
      const contracts = await getTable('contracts');

      return bookings.map((b: any) => ({
        ...b,
        contracts: contracts.filter((c: any) => c.tenant_id === b.converted_tenant_id),
      }));
    }

    case 'holidays': {
      const [contracts, tenants, houses, properties] = await Promise.all([
        getTable('contracts'),
        getTable('tenants'),
        getTable('houses'),
        getTable('properties'),
      ]);
      const tenantsById = toMap(tenants);
      const housesById = toMap(houses);
      const propertiesById = toMap(properties);

      const allHolidays: any[] = [];
      contracts.forEach((c: any) => {
        const breaks = c.metadata?.breaks || [];
        if (breaks.length > 0) {
          const tenant = tenantsById[c.tenant_id];
          const house = housesById[c.house_id];
          const property = house ? propertiesById[house.property_id] : null;

          breaks.forEach((b: any) => {
            allHolidays.push({
              ...b,
              contractId: c.id,
              tenantName: tenant?.name || 'Unknown',
              propertyName: property?.name || 'Unknown',
              houseNumber: house?.house_number || 'Unknown',
              propertyId: property?.id,
            });
          });
        }
      });
      return allHolidays;
    }

    case 'promotions': {
      const promotions = await getTable('promotions');
      const [properties, tenants] = await Promise.all([
        getTable('properties'),
        getTable('tenants'),
      ]);
      const propertiesById = toMap(properties);
      const tenantsById = toMap(tenants);

      return promotions.map((p: any) => ({
        ...p,
        propertyName: p.property_id ? propertiesById[p.property_id]?.name : null,
        tenantName: p.tenant_id ? tenantsById[p.tenant_id]?.name : null,
      }));
    }

    default:
      return [];
  }
};
