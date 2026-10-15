import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { useBusiness } from '@/context/BusinessContext';
import { useSnackbar } from '@/context/SnackbarContext';
import PropertyLayout from '@/features/properties/components/PropertyLayout';
import { useCoreMutations, useHouses, useProperties } from '@/shared/hooks/useStore';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

export default function LayoutBuilderWizard() {
  const colors = useThemeColors();
  const router = useRouter();

  // Screen dimensions for layout mapping
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const cardWidth = screenWidth;
  const cardHeight = screenHeight - 160; // Leave space for header/tabs/footer
  const sideInset = 0;

  // 1. Fetch live data from Database Context
  const { selectedBusiness } = useBusiness();
  const properties = useProperties(selectedBusiness?.id);
  const houses = useHouses(selectedBusiness?.id);
  const { batch } = useCoreMutations();
  const { showSnackbar } = useSnackbar();

  // Sort properties based on metadata.display_order defaulting to their natural DB insertion age
  const [orderedProperties, setOrderedProperties] = React.useState<any[]>([]);

  // Track initial IDs order to detect reordering
  const [initialOrderIds, setInitialOrderIds] = React.useState<string[]>([]);

  // Stable snapshot: once a layout_config is captured we never overwrite it mid-session.
  const [initialLayouts, setInitialLayouts] = React.useState<Record<string, any>>({});
  const snapshotRef = React.useRef<Record<string, any>>({});

  // Ref map: one ref per property card. Used to imperatively call getLayout() on save.
  const layoutRefs = useRef<Record<string, any>>({});

  // Track whether there are unsaved reorderings
  const [hasReorder, setHasReorder] = React.useState(false);

  // Track whether any house layout was edited (drag-drop positions)
  // This is a pure boolean flag — no layout data is passed to avoid re-renders
  const [hasEdits, setHasEdits] = React.useState(false);

  // Keep it sync'd if DB loads late
  useEffect(() => {
    if (properties && properties.length > 0) {
      const sorted = [...properties].sort((a: any, b: any) => {
        const orderA = a.metadata?.display_order ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.metadata?.display_order ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      });

      // Capture snapshots in effect, not render
      const newSnapshots: Record<string, any> = {};
      properties.forEach((prop: any) => {
        if (!snapshotRef.current[prop.id]) {
          snapshotRef.current[prop.id] =
            prop.metadata?.layout_config || prop.layout_config || null;
        }
        newSnapshots[prop.id] = snapshotRef.current[prop.id];
      });

      setInitialLayouts(prev => ({ ...prev, ...newSnapshots }));
      if (orderedProperties.length === 0) {
        setOrderedProperties(sorted);
        setInitialOrderIds(sorted.map(p => p.id));
      } else if (initialOrderIds.length === 0) {
        setInitialOrderIds(sorted.map(p => p.id));
      }
    }
  }, [properties, orderedProperties.length, initialOrderIds.length]);

  const moveProperty = (index: number, direction: 'left' | 'right') => {
    const newIndex = direction === 'left' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= orderedProperties.length) return;

    const copy = [...orderedProperties];
    const temp = copy[index];
    copy[index] = copy[newIndex];
    copy[newIndex] = temp;
    setOrderedProperties(copy);
    setHasReorder(true);
  };

  const saveAllDataToDatabase = async () => {
    const mutations = orderedProperties.map((prop, idx) => {
      // Read the current layout imperatively from the ref — ZERO re-renders during editing
      const refLayout = layoutRefs.current[prop.id]?.getLayout();
      const layoutData =
        refLayout ||
        snapshotRef.current[prop.id] ||
        prop.metadata?.layout_config ||
        prop.layout_config;

      const currentMetadata = (prop.metadata || {}) as Record<string, any>;

      return {
        tableName: 'properties',
        operation: 'UPDATE' as const,
        rowId: prop.id,
        payload: {
          metadata: {
            ...currentMetadata,
            display_order: idx,
            layout_config: layoutData,
          },
        },
      };
    });

    if (mutations.length > 0 && batch) {
      await batch(mutations);
    }

    // Reset tracking states to hide the footer after save
    setInitialOrderIds(orderedProperties.map(p => p.id));
    setHasReorder(false);
    setHasEdits(false);
    // Clear snapshot so freshly-saved data is used as the next session's baseline
    snapshotRef.current = {};

    showSnackbar(
      `Architectural floor plans and display orders for all ${orderedProperties.length} active properties belonging to ${selectedBusiness?.name} have been secured.`,
      'success',
    );
  };

  const renderCurrentStep = () => {
    // Edge Case: No business Context
    if (!selectedBusiness) {
      return (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium" style={{ color: colors.error }}>
                No Business Assigned
              </Text>
              <Text variant="bodyMedium">
                Please navigate back and select a business workspace from the dashboard to
                design its property schemas.
              </Text>
              <Button
                mode="contained"
                onPress={() => router.back()}
                style={{ marginTop: 20 }}
              >
                Go Back
              </Button>
            </Card.Content>
          </Card>
        </ScrollView>
      );
    }

    const totalLayouts = orderedProperties.length;

    // Edge Case: Business has 0 properties registered in Database
    if (totalLayouts === 0) {
      return (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Card style={styles.card}>
            <Card.Content>
              <Text variant="titleMedium">No Properties Detected</Text>
              <Text variant="bodyMedium">
                Your business {selectedBusiness.name} does not have any physical
                properties registered in the database yet. Please add a property first so
                you can configure its floor plan!
              </Text>
              <Button
                mode="contained"
                onPress={() => router.back()}
                style={{ marginTop: 20 }}
              >
                Go Back
              </Button>
            </Card.Content>
          </Card>
        </ScrollView>
      );
    }

    // Detector for changes to trigger Save Bar appearance
    const hasChanges = hasReorder || hasEdits;

    // Unified Side-By-Side Property Mapping and Execution Editor
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          horizontal
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: sideInset,
            paddingVertical: 0, // Remove vertical padding
            gap: 0, // No gap between full-width cards
            flexGrow: 1,
            alignItems: 'stretch',
          }}
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth} // Snap directly to width
          decelerationRate="fast"
          snapToAlignment="start"
        >
          {orderedProperties.map((prop: any, idx: number) => {
            const propertyHouses = (houses || []).filter(
              (h: any) => h.property_id === prop.id,
            );

            return (
              <View
                key={prop.id}
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  backgroundColor: colors.surface,
                  borderRadius: 0, // Remove radius for full width
                  borderWidth: 0, // Remove border
                  overflow: 'hidden',
                }}
              >
                <PropertyLayout
                  ref={(r: any) => {
                    layoutRefs.current[prop.id] = r;
                  }}
                  propertyId={prop.id}
                  propertyName={prop.name || `Building ${idx + 1}`}
                  initialData={initialLayouts[prop.id]}
                  houses={propertyHouses}
                  readOnly={false}
                  hideFooter={true}
                  overrideWidth={cardWidth}
                  overrideHeight={cardHeight - 30}
                  showScrollHint={orderedProperties.length > 1}
                  onDirty={() => setHasEdits(true)}
                  onMoveLeft={() => moveProperty(idx, 'left')}
                  onMoveRight={() => moveProperty(idx, 'right')}
                  canMoveLeft={idx > 0}
                  canMoveRight={idx < orderedProperties.length - 1}
                  isFirst={idx === 0}
                  isLast={idx === orderedProperties.length - 1}
                />
              </View>
            );
          })}
        </ScrollView>
        {hasChanges && (
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 6,
              borderTopWidth: 1,
              borderColor: colors.outlineVariant,
              backgroundColor: colors.surface,
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.05,
              shadowRadius: 8,
              elevation: 10,
            }}
          >
            <Button
              mode="outlined"
              style={{ flex: 1, borderRadius: 12 }}
              onPress={() => {
                setHasReorder(false);
                setHasEdits(false);
                // Clear snapshots so items re-hydrate from saved DB state
                snapshotRef.current = {};
                setOrderedProperties(
                  [...properties].sort((a: any, b: any) => {
                    const orderA = a.metadata?.display_order ?? Number.MAX_SAFE_INTEGER;
                    const orderB = b.metadata?.display_order ?? Number.MAX_SAFE_INTEGER;
                    return orderA - orderB;
                  }),
                );
              }}
              contentStyle={{ height: 48 }}
            >
              Reset Changes
            </Button>
            <Button
              mode="contained"
              style={{ flex: 1, borderRadius: 12 }}
              onPress={saveAllDataToDatabase}
              contentStyle={{ height: 48 }}
            >
              Confirm & Save
            </Button>
          </View>
        )}
      </View>
    );
  };

  return <>{renderCurrentStep()}</>;
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
  },
  card: {
    paddingBottom: 10,
    borderRadius: 12,
    elevation: 2,
  },
});
