import React from 'react';
import { Text, View } from 'react-native';
import { Button, List, Switch } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import SlightPressable from '@/shared/components/SlightPressable';

interface LayoutSettingsModalProps {
  visible: boolean;
  onDismiss: () => void;
  cols: number;
  rows: number;
  hasFence: boolean;
  hasGate: boolean;
  gatePosition: string;
  updateCols: (val: number) => void;
  updateRows: (val: number) => void;
  toggleFence: () => void;
  toggleGate: () => void;
  updateGatePosition: (pos: string) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  colors: any;
  styles: any;
}

export const LayoutSettingsModal: React.FC<LayoutSettingsModalProps> = ({
  visible,
  onDismiss,
  cols,
  rows,
  hasFence,
  hasGate,
  gatePosition,
  updateCols,
  updateRows,
  toggleFence,
  toggleGate,
  updateGatePosition,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  colors,
  styles,
}) => {
  return (
    <BaseModal
      visible={visible}
      onDismiss={onDismiss}
      title="Layout Settings"
      subtitle="Configure grid dimensions and outer perimeters"
      scrollable={true}
      actions={[
        {
          label: 'Done',
          onPress: onDismiss,
          mode: 'contained',
          buttonColor: colors.primary,
        },
      ]}
    >
      <View
        style={{
          paddingVertical: 20,
          borderBottomWidth: 1,
          borderColor: colors.outlineVariant,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <Text style={[styles.controlText, { color: colors.onSurface }]}>
            Grid Columns
          </Text>
          <View style={styles.stepper}>
            <SlightPressable
              onPress={() => updateCols(Math.max(1, cols - 1))}
              style={styles.stepBtn}
            >
              <Text style={{ color: colors.onSurface, fontWeight: 'bold' }}>—</Text>
            </SlightPressable>
            <Text style={styles.stepValue}>{cols}</Text>
            <SlightPressable
              onPress={() => updateCols(cols + 1)}
              style={styles.stepBtn}
            >
              <Text style={{ color: colors.onSurface, fontWeight: 'bold' }}>+</Text>
            </SlightPressable>
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={[styles.controlText, { color: colors.onSurface }]}>
            Grid Rows
          </Text>
          <View style={styles.stepper}>
            <SlightPressable
              onPress={() => updateRows(Math.max(1, rows - 1))}
              style={styles.stepBtn}
            >
              <Text style={{ color: colors.onSurface, fontWeight: 'bold' }}>—</Text>
            </SlightPressable>
            <Text style={styles.stepValue}>{rows}</Text>
            <SlightPressable
              onPress={() => updateRows(rows + 1)}
              style={styles.stepBtn}
            >
              <Text style={{ color: colors.onSurface, fontWeight: 'bold' }}>+</Text>
            </SlightPressable>
          </View>
        </View>
      </View>

      <List.Item
        title="Security Fence"
        description="Wrap the property in an external boundary"
        right={() => (
          <Switch value={hasFence} onValueChange={toggleFence} color={colors.primary} />
        )}
      />
      <List.Item
        title="Entry Gate"
        description="Create an access gap in the outer perimeter"
        titleStyle={{ fontWeight: '600' }}
        right={() => (
          <Switch
            value={hasGate}
            onValueChange={toggleGate}
            color={colors.primary}
            disabled={!hasFence}
          />
        )}
      />

      {hasGate && (
        <View style={{ padding: 16, paddingTop: 0 }}>
          <Text
            style={{
              fontSize: 13,
              color: colors.onSurfaceVariant,
              marginBottom: 8,
              fontWeight: '500',
            }}
          >
            GATE ENTRANCE POSITION
          </Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['top', 'bottom', 'left', 'right'].map(pos => (
              <SlightPressable
                key={pos}
                onPress={() => updateGatePosition(pos)}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor:
                    gatePosition === pos ? colors.primary : colors.outlineVariant,
                  backgroundColor:
                    gatePosition === pos ? colors.primaryContainer : colors.surface,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: 'bold',
                    color:
                      gatePosition === pos ? colors.primary : colors.onSurfaceVariant,
                    textTransform: 'uppercase',
                  }}
                >
                  {pos}
                </Text>
              </SlightPressable>
            ))}
          </View>
        </View>
      )}

      {/* Priority Reordering Block */}
      {(onMoveLeft || onMoveRight) && (
        <View
          style={{
            paddingVertical: 20,
            borderTopWidth: 1,
            borderColor: colors.outlineVariant,
            marginTop: 10,
          }}
        >
          <Text
            style={[styles.controlText, { marginBottom: 16, color: colors.onSurface }]}
          >
            Layout Sequence Order
          </Text>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
          >
            <Button
              mode="outlined"
              disabled={!canMoveLeft}
              icon="arrow-left"
              onPress={onMoveLeft}
              style={{ flex: 1, borderRadius: 10 }}
            >
              Shift Left
            </Button>
            <Button
              mode="outlined"
              disabled={!canMoveRight}
              icon="arrow-right"
              onPress={onMoveRight}
              contentStyle={{ flexDirection: 'row-reverse' }}
              style={{ flex: 1, borderRadius: 10 }}
            >
              Shift Right
            </Button>
          </View>
        </View>
      )}
    </BaseModal>
  );
};

export default LayoutSettingsModal;
