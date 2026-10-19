import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import SlightPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';
import DraggableItem from './layout/DraggableItem';
import LayoutSettingsModal from './layout/LayoutSettingsModal';
import {
  CANVAS_PADDING,
  getColOffset,
  getColWidth,
  type LayoutItem,
  type PropertyLayoutData,
} from './layout/layoutHelpers';

export {
  CANVAS_PADDING,
  getColOffset,
  getColWidth,
  type LayoutItem,
  type PropertyLayoutData,
};

const { width } = Dimensions.get('window');

export interface PropertyLayoutHandle {
  getLayout: () => PropertyLayoutData;
}

export interface PropertyLayoutProps {
  propertyId?: string;
  propertyName?: string;
  initialData?: any;
  houses?: any[];
  onNext?: (data: PropertyLayoutData) => void;
  onBack?: () => void;
  onChange?: (data: PropertyLayoutData) => void;
  onDirty?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  showScrollHint?: boolean;
  readOnly?: boolean;
  hideFooter?: boolean;
  overrideWidth?: number;
  overrideHeight?: number;
}

const PropertyLayout = forwardRef<PropertyLayoutHandle, PropertyLayoutProps>(
  function PropertyLayout(
    {
      propertyName = 'Grid Layout Builder',
      initialData,
      houses,
      onNext,
      onBack,
      onChange,
      onDirty,
      onMoveLeft,
      onMoveRight,
      canMoveLeft,
      canMoveRight,
      isFirst,
      isLast,
      showScrollHint = false,
      readOnly = false,
      hideFooter = false,
      overrideWidth,
      overrideHeight,
    },
    ref,
  ) {
    const colors = useThemeColors();
    const styles = getStyles(colors);

    const [cols, setCols] = useState(initialData?.cols || 3);
    const [rows, setRows] = useState(initialData?.rows || 8);
    const [hasFence, setHasFence] = useState(initialData?.hasFence || false);
    const [hasGate, setHasGate] = useState(initialData?.hasGate || false);
    const [gatePosition, setGatePosition] = useState(
      initialData?.gatePosition || 'bottom',
    );

    const [containerDims, setContainerDims] = useState<any>(null);

    const FENCE_THICKNESS = 6;

    // Create a 16px buffer on both sides (32px total) so the fence never touches phone edges
    const safeAreaMargin = 16;
    const absoluteCanvasWidth = overrideWidth
      ? Math.max(0, overrideWidth - safeAreaMargin)
      : containerDims
        ? containerDims.width - safeAreaMargin
        : width - CANVAS_PADDING * 2;

    const canvasWidth = hasFence
      ? absoluteCanvasWidth - FENCE_THICKNESS
      : absoluteCanvasWidth - 4;

    const cellHeight = containerDims
      ? Math.max(
          1,
          (containerDims.height - (hasFence ? FENCE_THICKNESS : 4) - CANVAS_PADDING * 2) /
            rows,
        )
      : overrideHeight
        ? overrideHeight / rows
        : 50; // Use override or fallback safe height

    const [items, setItems] = useState<LayoutItem[]>(() => {
      if (initialData?.items) return initialData.items;

      const initialItems: LayoutItem[] = [
        {
          id: 'walkway',
          label: 'Walkway',
          col: 1,
          row: 0,
          colsSpan: 1,
          rowsSpan: initialData?.rows || 8, // dynamically scale initially
        },
      ];

      (houses || []).forEach((house: any, index: number) => {
        initialItems.push({
          id: house.id,
          label: house.name || house.house_number || `Unit ${index + 1}`,
          col: index % 2 === 0 ? 0 : 2,
          row: Math.min(Math.floor(index / 2), 7),
          colsSpan: 1,
          rowsSpan: 1,
        });
      });

      return initialItems;
    });

    const hasHydrated = useRef(false);

    useEffect(() => {
      if (
        !hasHydrated.current &&
        items.length === 1 &&
        items[0].id === 'walkway' &&
        houses &&
        houses.length > 0 &&
        !initialData?.items
      ) {
        hasHydrated.current = true;
        const newItems = [...items];
        houses.forEach((house: any, index: number) => {
          newItems.push({
            id: house.id,
            label: house.name || house.house_number || `Unit ${index + 1}`,
            col: index % 2 === 0 ? 0 : 2,
            row: Math.min(Math.floor(index / 2), 7),
            colsSpan: 1,
          rowsSpan: 1,
        });
      });
      setItems(newItems);
      if (onChange) {
        onChange({ cols, rows, items: newItems, hasFence, hasGate, gatePosition });
      }
    }
  }, [
    houses,
    items,
    initialData?.items,
    cols,
    rows,
    hasFence,
    hasGate,
    onChange,
    gatePosition,
  ]);

  const triggerUpdate = (
    c: number,
    r: number,
    its: LayoutItem[],
    f: boolean,
    g: boolean,
    gp: string,
  ) => {
    if (onChange) {
      onChange({
        cols: c,
        rows: r,
        items: its,
        hasFence: f,
        hasGate: g,
        gatePosition: gp,
      });
    }
  };

  const updateCols = (val: number) => {
    setCols(val);
    triggerUpdate(val, rows, items, hasFence, hasGate, gatePosition);
  };

  const updateRows = (val: number) => {
    setRows(val);
    const nextSequence = items.map((item: LayoutItem) =>
      item.id === 'walkway' ? { ...item, rowsSpan: val } : item,
    );
    setItems(nextSequence);
    triggerUpdate(cols, val, nextSequence, hasFence, hasGate, gatePosition);
  };

  const updateItemGridPosition = (id: string, newCol: number, newRow: number) => {
    // If it's a house and trying to drop on a 3-col walkway (col 1), block it
    if (id !== 'walkway' && cols === 3 && newCol === 1) {
      return;
    }

    // Only update local state — do NOT call onChange/triggerUpdate here.
    // The parent will read the layout imperatively via the exposed getLayout() ref method on submit.
    const updated = items.map((item: LayoutItem) =>
      item.id === id ? { ...item, col: newCol, row: newRow } : item,
    );
    setItems(updated);
    // Notify parent that a change was made (pure boolean signal, no data = no re-render cascade)
    if (onDirty) onDirty();
  };

  const toggleFence = () => {
    const newState = !hasFence;
    setHasFence(newState);
    triggerUpdate(cols, rows, items, newState, hasGate, gatePosition);
  };

  const toggleGate = () => {
    const newState = !hasGate;
    setHasGate(newState);
    triggerUpdate(cols, rows, items, hasFence, newState, gatePosition);
  };

  const updateGatePosition = (pos: string) => {
    setGatePosition(pos);
    triggerUpdate(cols, rows, items, hasFence, hasGate, pos);
  };

  const [modalVisible, setModalVisible] = useState(false);
  const openSettings = () => setModalVisible(true);

  // Expose getLayout() so the parent can imperatively read the current state on save.
  // This eliminates the need for onChange callbacks during drag, preventing parent re-renders.
  useImperativeHandle(
    ref,
    () => ({
      getLayout: () => ({ cols, rows, items, hasFence, hasGate, gatePosition }),
    }),
    [cols, rows, items, hasFence, hasGate, gatePosition],
  );

  return (
    <View style={[styles.container, readOnly && { flex: 0 }]}>
      <View
        style={[
          styles.toolbar,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            elevation: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 4,
          },
        ]}
      >
        <View style={styles.toolbarHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {propertyName}
            </Text>
            {showScrollHint && (
              <Text
                style={{
                  color: colors.onSurfaceVariant,
                  opacity: 0.6,
                  fontSize: 11,
                  marginTop: 1,
                }}
              >
                Swipe {isFirst ? 'right' : isLast ? 'left' : 'left or right'} to view more
                properties
              </Text>
            )}
          </View>

          {!readOnly && (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <SlightPressable style={styles.addButton} onPress={openSettings}>
                <MaterialCommunityIcons
                  name="cogs"
                  size={16}
                  color={colors.onSecondaryContainer}
                />
                <Text style={styles.addButtonText}>Configurations</Text>
              </SlightPressable>
            </View>
          )}
        </View>
      </View>

      {/* Adjust content to sit below sticky header */}
      <View style={{ flex: 1, marginTop: 50, paddingHorizontal: 10, paddingBottom: 20 }}>
        {(() => {
          const canvasGrid = (
            <View
              style={{
                position: 'relative',
                width: absoluteCanvasWidth,
                height: rows * cellHeight + (hasFence ? FENCE_THICKNESS : 4),
                padding: hasFence ? FENCE_THICKNESS / 2 : 0,
                borderRadius: 8,
                backgroundColor: 'transparent',
              }}
            >
              {hasFence && (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { borderRadius: 8, overflow: 'hidden' },
                  ]}
                  pointerEvents="none"
                >
                  {(['top', 'bottom', 'left', 'right'] as const).map(side => {
                    const isGate = hasGate && gatePosition === side;
                    const isVertical = side === 'left' || side === 'right';
                    const sideStyle = {
                      position: 'absolute' as const,
                      backgroundColor: colors.outline,
                      zIndex: 10,
                      [isVertical ? 'width' : 'height']: FENCE_THICKNESS,
                      [side]: 0,
                      [isVertical ? 'top' : 'left']: 0,
                      [isVertical ? 'height' : 'width']: isGate ? '40%' : '100%',
                    };

                    return (
                      <React.Fragment key={side}>
                        <View style={sideStyle} />
                        {isGate && (
                          <View
                            style={[
                              sideStyle,
                              {
                                [isVertical ? 'top' : 'left']: undefined,
                                [isVertical ? 'bottom' : 'right']: 0,
                              },
                            ]}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </View>
              )}

              <View
                style={[
                  styles.canvasArea,
                  {
                    width: canvasWidth,
                    height: rows * cellHeight,
                    backgroundColor: colors.surface,
                    borderColor: colors.outlineVariant,
                    borderWidth: 1,
                    borderStyle: hasFence ? 'solid' : 'dashed',
                    elevation: 1,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.1,
                    shadowRadius: 2,
                  },
                ]}
              >
                <View style={StyleSheet.absoluteFill} pointerEvents="none">
                  {Array.from({ length: cols + 1 }).map((_, i) => (
                    <View
                      key={`col-${i}`}
                      style={[
                        styles.gridLine,
                        {
                          width: 0.5,
                          left: getColOffset(i, cols, canvasWidth),
                          height: '100%',
                          backgroundColor: colors.outlineVariant,
                          opacity: 0.15,
                        },
                      ]}
                    />
                  ))}

                  {Array.from({ length: rows + 1 }).map((_, i) => (
                    <View
                      key={`row-${i}`}
                      style={[
                        styles.gridLine,
                        {
                          height: 0.5,
                          top: i * cellHeight,
                          width: '100%',
                          backgroundColor: colors.outlineVariant,
                          opacity: 0.15,
                        },
                      ]}
                    />
                  ))}
                </View>

                {items.map((item: LayoutItem) => (
                  <DraggableItem
                    key={item.id}
                    item={item}
                    cellHeight={cellHeight}
                    maxCols={cols}
                    maxRows={rows}
                    canvasWidth={canvasWidth}
                    readOnly={readOnly}
                    onUpdatePosition={updateItemGridPosition}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          );

          if (readOnly) {
            return (
              <View
                style={{
                  flex: 1,
                  padding: CANVAS_PADDING / 2,
                  paddingHorizontal: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onLayout={e => {
                  const { width: layoutW, height: layoutH } = e.nativeEvent.layout;
                  setContainerDims({ width: layoutW, height: layoutH });
                }}
              >
                {canvasGrid}
              </View>
            );
          }

          return (
            <View
              style={{
                flex: 1,
                padding: CANVAS_PADDING,
                paddingTop: 10,
                paddingHorizontal: 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onLayout={e => {
                const { width: layoutW, height: layoutH } = e.nativeEvent.layout;
                setContainerDims({ width: layoutW, height: layoutH });
              }}
            >
              {canvasGrid}
            </View>
          );
        })()}
      </View>

      {!readOnly && !hideFooter && (
        <View
          style={{
            padding: 6,
            borderTopWidth: 1,
            borderColor: colors.outline,
            backgroundColor: colors.surface,
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <Button mode="outlined" style={{ flex: 1 }} onPress={onBack}>
            {isFirst ? 'Cancel' : 'Back'}
          </Button>
          <Button
            mode="contained"
            style={{ flex: 1 }}
            onPress={() => onNext?.({ cols, rows, items, hasFence, hasGate, gatePosition })}
          >
            {isLast ? 'Save Layouts' : 'Next Property'}
          </Button>
        </View>
      )}

      <LayoutSettingsModal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        cols={cols}
        rows={rows}
        hasFence={hasFence}
        hasGate={hasGate}
        gatePosition={gatePosition}
        updateCols={updateCols}
        updateRows={updateRows}
        toggleFence={toggleFence}
        toggleGate={toggleGate}
        updateGatePosition={updateGatePosition}
        onMoveLeft={onMoveLeft}
        onMoveRight={onMoveRight}
        canMoveLeft={canMoveLeft}
        canMoveRight={canMoveRight}
        colors={colors}
        styles={styles}
      />
    </View>
  );
});

export default PropertyLayout;

const getStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    toolbar: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      backgroundColor: colors.surface,
    },
    toolbarHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.onSurface,
      letterSpacing: 0.5,
    },
    addButton: {
      backgroundColor: colors.secondaryContainer,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    addButtonText: {
      color: colors.onSecondaryContainer,
      fontWeight: '700',
      fontSize: 13,
    },
    controlText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.onSurfaceVariant,
      marginRight: 5,
    },
    stepper: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      alignItems: 'center',
      overflow: 'hidden',
    },
    stepBtn: {
      width: 44,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceVariant,
      flexGrow: 0,
      flexShrink: 0,
    },
    stepValue: {
      width: 36,
      textAlign: 'center',
      fontWeight: 'bold',
      fontSize: 14,
      color: colors.onSurface,
    },
    canvasArea: {
      backgroundColor: colors.surface,
      position: 'relative',
      borderWidth: 2,
      borderColor: colors.outline,
      borderRadius: 8,
      overflow: 'hidden',
    },
    gridLine: {
      position: 'absolute',
      backgroundColor: colors.outlineVariant,
    },
    box: {
      position: 'absolute',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1.5,
      borderRadius: 0,
      margin: -0.75, // Overlap borders for "stuck together" look
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 4,
      overflow: 'visible',
    },
    walkwayBox: {
      elevation: 0,
      shadowOpacity: 0,
      zIndex: -1,
    },
    boxText: {
      fontWeight: '700',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
    },
  });
