import React from 'react';
import { Divider, List } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import EmptyState from '@/shared/components/EmptyState';
import type { Property } from './ContractsForm';

interface SelectPropertyModalProps {
  visible: boolean;
  onDismiss: () => void;
  properties: Property[];
  onSelectProperty: (property: Property) => void;
}

export default function SelectPropertyModal({
  visible,
  onDismiss,
  properties,
  onSelectProperty,
}: SelectPropertyModalProps) {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Select Property"
      subtitle="Manage your properties"
      edgeToEdge
      maxHeight="80%"
      scrollable
    >
      {properties.length === 0 ? (
        <EmptyState icon="home-city-outline" title="No properties found" />
      ) : (
        properties.map(property => (
          <React.Fragment key={property.id}>
            <List.Item
              title={property.name}
              description={property.location || undefined}
              onPress={() => onSelectProperty(property)}
            />
            <Divider />
          </React.Fragment>
        ))
      )}
    </BaseModal>
  );
}
