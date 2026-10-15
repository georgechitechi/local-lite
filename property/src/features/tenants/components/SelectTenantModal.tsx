import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Checkbox, Divider, List } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import { isActiveContractStatus } from '@/shared/utils/statusHelper';
import type { Contract, House, Property, Tenant } from '@/stores/types';

interface SelectTenantModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (selection: Tenant | Tenant[]) => void;
  selectedId?: string | string[];
  multiple?: boolean;
  tenants: Tenant[];
  contracts: Contract[];
  houses: House[];
  properties: Property[];
  includeNone?: boolean;
  title?: string;
  showAllTenants?: boolean;
  showPhone?: boolean;
  zIndex?: number;
}

export default function SelectTenantModal({
  visible,
  onDismiss,
  onSelect,
  selectedId,
  multiple = false,
  tenants,
  contracts,
  houses,
  properties,
  includeNone = false,
  title = 'Select Tenant',
  showAllTenants = false,
  showPhone = false,
  zIndex,
}: SelectTenantModalProps) {
  const [search, setSearch] = useState('');
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>([]);

  const [initializedKey, setInitializedKey] = useState<string | null>(null);

  const handleDismiss = () => {
    setSearch('');
    setLocalSelectedIds([]);
    setInitializedKey(null);
    onDismiss();
  };

  // Reset local state when modal opens (once per open)
  useEffect(() => {
    if (!visible) return;
    if (initializedKey === 'open') return;

    setSearch('');
    if (multiple) {
      setLocalSelectedIds(Array.isArray(selectedId) ? selectedId : []);
    }
    setInitializedKey('open');
  }, [visible, multiple, selectedId, initializedKey]);

  const filteredTenants = useMemo(() => {
    return tenants
      .filter(t => {
        if (t.deleted) return false;
        const searchLower = search.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(searchLower);
        const matchesPhone = showPhone && t.phone?.includes(search);
        return matchesName || matchesPhone;
      })
      .map(tenant => {
        const contract = contracts.find(
          c => c.tenant_id === tenant.id && isActiveContractStatus(c.status),
        );

        const house = contract ? houses.find(h => h.id === contract.house_id) : null;
        const property = house ? properties.find(p => p.id === house.property_id) : null;

        const contractInfo =
          property && house
            ? `${property.name} • ${house.house_number}`
            : 'No active contract';

        let description = contractInfo;
        if (showPhone && tenant.phone) {
          description = `${tenant.phone}${contractInfo !== 'No active contract' ? ` • ${contractInfo}` : ''}`;
        }

        return { tenant, description, hasContract: !!contract };
      })
      .filter(item => showAllTenants || item.hasContract)
      .sort((a, b) => {
        if (a.hasContract && !b.hasContract) return -1;
        if (!a.hasContract && b.hasContract) return 1;
        return a.tenant.name.localeCompare(b.tenant.name);
      });
  }, [tenants, search, contracts, houses, properties, showAllTenants, showPhone]);

  const toggleTenant = (tenant: Tenant) => {
    if (multiple) {
      setLocalSelectedIds(prev =>
        prev.includes(tenant.id)
          ? prev.filter(id => id !== tenant.id)
          : [...prev, tenant.id],
      );
    } else {
      onSelect(tenant);
      handleDismiss();
    }
  };

  const handleConfirm = () => {
    if (multiple) {
      const selectedTenants = tenants.filter(t => localSelectedIds.includes(t.id));
      onSelect(selectedTenants);
      handleDismiss();
    }
  };

  const handleSelectAll = () => {
    const visibleIds = filteredTenants.map(item => item.tenant.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every(id => localSelectedIds.includes(id));

    if (allVisibleSelected) {
      setLocalSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setLocalSelectedIds(prev => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return Array.from(next);
      });
    }
  };

  const actions = multiple
    ? [
        { label: 'Cancel', onPress: handleDismiss },
        {
          label:
            localSelectedIds.length > 0
              ? `Select (${localSelectedIds.length})`
              : 'Select',
          onPress: handleConfirm,
          mode: 'contained' as const,
          disabled: localSelectedIds.length === 0,
        },
      ]
    : [];

  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title={multiple ? 'Select Tenants' : title}
      subtitle="Manage your tenants"
      edgeToEdge
      actions={actions}
      scrollable
      search={{
        value: search,
        onChangeText: setSearch,
        placeholder: 'Search tenants...',
      }}
      zIndex={zIndex}
    >
      <View>
        {multiple && filteredTenants.length > 0 && (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              paddingHorizontal: 8,
              marginBottom: 8,
            }}
          >
            <Button compact onPress={handleSelectAll}>
              {filteredTenants.length > 0 &&
              filteredTenants.every(item => localSelectedIds.includes(item.tenant.id))
                ? 'Deselect All'
                : 'Select All'}
            </Button>
          </View>
        )}

        {includeNone && !multiple && (
          <>
            <List.Item
              title="None / General"
              left={props => <List.Icon {...props} icon="account-off-outline" />}
              onPress={() => {
                onSelect(null as any);
                onDismiss();
              }}
            />
            <Divider />
          </>
        )}

        {filteredTenants.length === 0 ? (
          <EmptyState icon="account-search-outline" title="No tenants found" />
        ) : (
          filteredTenants.map(({ tenant, description }, index) => {
            const isSelected = multiple
              ? localSelectedIds.includes(tenant.id)
              : selectedId === tenant.id;

            return (
              <React.Fragment key={tenant.id}>
                <List.Item
                  title={tenant.name}
                  description={description}
                  left={props =>
                    multiple ? (
                      <Checkbox.Android
                        status={isSelected ? 'checked' : 'unchecked'}
                        onPress={() => toggleTenant(tenant)}
                      />
                    ) : (
                      <List.Icon
                        {...props}
                        icon={isSelected ? 'account-check' : 'account-outline'}
                      />
                    )
                  }
                  onPress={() => toggleTenant(tenant)}
                />
                {index < filteredTenants.length - 1 && <Divider />}
              </React.Fragment>
            );
          })
        )}
      </View>
    </BaseModal>
  );
}
