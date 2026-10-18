import React, { useMemo, useState } from 'react';
import { Divider, List, Portal, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import BaseModal from '@/shared/components/BaseModal';
import { useProperties } from '@/shared/hooks/useStore';

export interface SelectedProperty {
  id: string;
  name: string;
}

interface PropertySelectModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (property: SelectedProperty) => void;
  selectedId?: string | null;
}

export default function PropertySelectModal({
  visible,
  onDismiss,
  onSelect,
  selectedId,
}: PropertySelectModalProps) {
  const { selectedBusiness } = useBusiness();
  const properties = useProperties(selectedBusiness?.id);
  const [search, setSearch] = useState('');

  const filteredProperties = useMemo(
    () =>
      properties.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [properties, search],
  );

  const handleDismiss = () => {
    setSearch('');
    onDismiss();
  };

  const handleSelect = (property: SelectedProperty) => {
    onSelect(property);
    setSearch('');
    onDismiss();
  };

  return (
    <Portal>
      <BaseModal
        visible={visible}
        onDismiss={handleDismiss}
        title="Select Property"
        subtitle="Choose which property to add units to"
        edgeToEdge
        maxHeight="80%"
        scrollable
        search={{
          value: search,
          onChangeText: setSearch,
          placeholder: 'Search properties...',
          onClear: () => setSearch(''),
        }}
      >
        {filteredProperties.length === 0 ? (
          <Text variant="bodyMedium" style={{ padding: 16, textAlign: 'center' }}>
            No properties found
          </Text>
        ) : (
          filteredProperties.map(property => (
            <React.Fragment key={property.id}>
              <List.Item
                title={property.name}
                description={property.location || 'No location'}
                onPress={() => handleSelect({ id: property.id, name: property.name })}
                right={
                  selectedId === property.id
                    ? props => <List.Icon {...props} icon="check" />
                    : undefined
                }
              />
              <Divider />
            </React.Fragment>
          ))
        )}
      </BaseModal>
    </Portal>
  );
}
