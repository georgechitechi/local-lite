import MaterialCommunityIcons from '@react-native-vector-icons/material-design-icons';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  type PanResponderInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, List, Switch } from 'react-native-paper';
import BaseModal from '@/shared/components/BaseModal';
import SlightPressable from '@/shared/components/SlightPressable';
import { useThemeColors } from '@/shared/hooks/useThemeProvider';

const { width } = Dimensions.get('window');

const CANVAS_PADDING = 20;

const getColWidth = (colIndex: number, totalCols: number, canvasWidth: number) => {
  if (totalCols === 3) {
    const walkwayWidth = canvasWidth < 300 ? 30 : 60; // Scale central walkway if rendered tightly
    if (colIndex === 1) return walkwayWidth;
    return (canvasWidth - walkwayWidth) / 2; // Split the rest evenly between Col 0 and 2
  }
  // Fallback for uniform columns
  return canvasWidth / totalCols;
};

const getColOffset = (colIndex: number, totalCols: number, canvasWidth: number) => {
  let offset = 0;
  for (let i = 0; i < colIndex; i++) {
    offset += getColWidth(i, totalCols, canvasWidth);
  }
  return offset;
};

// --- Draggable Grid Item Component ---
const DraggableItem = ({
  item,
  onUpdatePosition,
  cellHeight,
  maxCols,
  maxRows,
  canvasWidth,
  readOnly,
  colors,
  styles,
}: any) => {
  const initialX = getColOffset(item.col, maxCols, canvasWidth);
  const initialY = item.row * cellHeight;

  // Track dynamic dimensions inside a ref to avoid stale closures in PanResponder after users increment rows/cols
  const latestBounds = useRef({
    maxCols,
    maxRows,
    cellHeight,
    item,
    canvasWidth,
    readOnly,
    onUpdatePosition,
  });
  useEffect(() => {
    latestBounds.current = {
      maxCols,
      maxRows,
      cellHeight,
      item,
      canvasWidth,
      readOnly,
      onUpdatePosition,
    };
  }, [maxCols, maxRows, cellHeight, item, canvasWidth, readOnly, onUpdatePosition]);

  // Track absolute position on screen instead of relative transform to eliminate React state flicker
  const panX = React.useMemo(() => new Animated.Value(initialX), [initialX]);
  const panY = React.useMemo(() => new Animated.Value(initialY), [initialY]);

  const opacity = React.useMemo(() => new Animated.Value(1), []);
  const scale = React.useMemo(() => new Animated.Value(1), []);

  // We use both state (for render/zIndex) and ref (for stable PanResponder access)
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);

  const pressTimer = useRef<any>(null);

  // Synchronize absolute native position if the grid externally changes (e.g. KV hydration)
  useLayoutEffect(() => {
    panX.setValue(getColOffset(item.col, maxCols, canvasWidth));
    panY.setValue(item.row * cellHeight);
  }, [item.col, item.row, maxCols, cellHeight, canvasWidth, panX, panY]);

  // Calculate width depending on how many columns it spans
  let widthPx = 0;
  for (let i = 0; i < item.colsSpan; i++) {
    widthPx += getColWidth(item.col + i, maxCols, canvasWidth);
  }
  const heightPx = item.rowsSpan * cellHeight;

  // Persist the absolute position internally since Animated.Value cannot be read synchronously during gesture tracking
  const absolutePos = useRef({ x: initialX, y: initialY });
  useEffect(() => {
    const listenerX = panX.addListener(v => {
      absolutePos.current.x = v.value;
    });
    const listenerY = panY.addListener(v => {
      absolutePos.current.y = v.value;
    });
    return () => {
      panX.removeListener(listenerX);
      panY.removeListener(listenerY);
    };
  }, [panX, panY]);

  const [panResponder, setPanResponder] = useState<PanResponderInstance | null>(null);

  // Initialize PanResponder in effect to avoid reading refs during render
  useEffect(() => {
    setPanResponder(
      PanResponder.create({
        onStartShouldSetPanResponder: () => {
          const { readOnly, item } = latestBounds.current;
          return !readOnly && item.id !== 'walkway';
        },
        onPanResponderGrant: () => {
          isDraggingRef.current = false;
          setIsDragging(false);
          pressTimer.current = setTimeout(() => {
            isDraggingRef.current = true;
            setIsDragging(true);
            Animated.parallel([
              Animated.timing(opacity, {
                toValue: 0.8,
                duration: 150,
                useNativeDriver: false,
              }),
              Animated.spring(scale, {
                toValue: 1.05,
                friction: 8,
                useNativeDriver: false,
              }),
            ]).start();
            // Freeze at current spot exactly
            panX.setOffset(absolutePos.current.x);
            panX.setValue(0);
            panY.setOffset(absolutePos.current.y);
            panY.setValue(0);
          }, 400); // 400ms long press delay
        },
        onPanResponderMove: (_e, gestureState) => {
          if (!isDraggingRef.current) {
            // If we move too much horizontally or vertically during the delay, it's a scroll, not a long press
            if (Math.abs(gestureState.dx) > 10 || Math.abs(gestureState.dy) > 10) {
              if (pressTimer.current) {
                clearTimeout(pressTimer.current);
                pressTimer.current = null;
              }
            }
            return;
          }

          // Only update position if we have "activated" the drag via long press
          panX.setValue(gestureState.dx);
          panY.setValue(gestureState.dy);
        },
        onPanResponderRelease: (_e, _gestureState) => {
          if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
          }

          if (!isDraggingRef.current) return;
          isDraggingRef.current = false;
          setIsDragging(false);

          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 1,
              duration: 150,
              useNativeDriver: false,
            }),
            Animated.spring(scale, {
              toValue: 1,
              friction: 8,
              useNativeDriver: false,
            }),
          ]).start();

          // Combine offset into standard value
          panX.flattenOffset();
          panY.flattenOffset();

          const bounds = latestBounds.current;
          const currentX = absolutePos.current.x;
          const currentY = absolutePos.current.y;

          // Snapping logic: Dynamically compute bounds utilizing newest max dimensions
          let dynamicWidthPx = 0;
          for (let i = 0; i < bounds.item.colsSpan; i++) {
            dynamicWidthPx += getColWidth(
              bounds.item.col + i,
              bounds.maxCols,
              bounds.canvasWidth,
            );
          }

          const centerX = currentX + dynamicWidthPx / 2;
          let newCol = 0;
          let cumulative = 0;
          for (let i = 0; i < bounds.maxCols; i++) {
            cumulative += getColWidth(i, bounds.maxCols, bounds.canvasWidth);
            if (centerX < cumulative) {
              newCol = i;
              break;
            }
          }
          // Fallback max
          if (centerX >= cumulative) newCol = bounds.maxCols - 1;

          let newRow = Math.round(currentY / bounds.cellHeight);

          // Constrain bounding targets securely avoiding stale limits
          newCol = Math.max(0, Math.min(newCol, bounds.maxCols - bounds.item.colsSpan));
          newRow = Math.max(0, Math.min(newRow, bounds.maxRows - bounds.item.rowsSpan));

          // Get the structural grid target point
          const snapPixelX = getColOffset(newCol, bounds.maxCols, bounds.canvasWidth);
          const snapPixelY = newRow * bounds.cellHeight;

          // Animate visually first
          Animated.parallel([
            Animated.spring(panX, {
              toValue: snapPixelX,
              friction: 6,
              useNativeDriver: false,
            }),
            Animated.spring(panY, {
              toValue: snapPixelY,
              friction: 6,
              useNativeDriver: false,
            }),
          ]).start(() => {
            // Use latestBounds.onUpdatePosition (not the closure-captured prop) to always get fresh items state
            latestBounds.current.onUpdatePosition(bounds.item.id, newCol, newRow);
          });
        },
      }),
    );
  }, [panX, panY, opacity, scale]);

  const dragZIndex = isDragging ? 100 : 1;

  return (
    <Animated.View
      {...(panResponder ? panResponder.panHandlers : {})}
      style={[
        styles.box,
        item.id === 'walkway' && styles.walkwayBox,
        {
          left: panX,
          top: panY,
          width: widthPx,
          height: heightPx,
          backgroundColor:
            item.id === 'walkway' ? colors.surfaceVariant : colors.primaryContainer,
          borderColor: item.id === 'walkway' ? colors.outlineVariant : colors.primary,
          borderWidth: item.id === 'walkway' ? 1 : 1.5,
          borderStyle: item.id === 'walkway' ? 'dashed' : 'solid',
          opacity: opacity,
          zIndex: dragZIndex,
          transform: [{ scale: scale }],
        },
      ]}
    >
      {item.id === 'walkway' && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: 0.05,
              backgroundColor: colors.onSurfaceVariant,
            },
          ]}
        />
      )}
      <Text
        style={[
          styles.boxText,
          {
            color:
              item.id === 'walkway' ? colors.onSurfaceVariant : colors.onPrimaryContainer,
            letterSpacing: 2,
            fontWeight: '900',
          },
          // Special styling for the Walkway to make it vertical and smaller
          item.id === 'walkway' && {
            transform: [{ rotate: '-90deg' }],
            width: heightPx, // allow text to spread out vertically
            textAlign: 'center',
            letterSpacing: 6,
            fontSize: 11,
            fontWeight: '700',
            opacity: 0.4,
            color: colors.onSurfaceVariant,
          },
          readOnly && {
            fontSize: item.id === 'walkway' ? 8 : 9,
            letterSpacing: item.id === 'walkway' ? 1 : 0,
            fontWeight: '600',
          },
        ]}
        numberOfLines={1}
      >
        {item.label.toUpperCase()}
      </Text>
    </Animated.View>
  );
};
const PropertyLayout = forwardRef(function PropertyLayout(
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
  }: any,
  ref: any,
) {
  const colors = useThemeColors();
  const styles = getStyles(colors);

  const [cols, setCols] = useState(initialData?.cols || 3);
  const [rows, setRows] = useState(initialData?.rows || 8);
  const [hasFence, setHasFence] = useState(initialData?.hasFence || false);
  const [hasGate, setHasGate] = useState(initialData?.hasGate || false);
  const [gatePosition, setGatePosition] = useState(initialData?.gatePosition || 'bottom');

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

  const [items, setItems] = useState(() => {
    if (initialData?.items) return initialData.items;

    const initialItems: any[] = [
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
    its: any[],
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
    const nextSequence = items.map((item: any) =>
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
    const updated = items.map((item: any) =>
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

                {items.map((item: any) => (
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
                  const { width, height } = e.nativeEvent.layout;
                  setContainerDims({ width, height });
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
                const { width, height } = e.nativeEvent.layout;
                setContainerDims({ width, height });
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
            onPress={() => onNext({ cols, rows, items, hasFence, hasGate, gatePosition })}
          >
            {isLast ? 'Save Layouts' : 'Next Property'}
          </Button>
        </View>
      )}

      <BaseModal
        visible={modalVisible}
        onDismiss={() => setModalVisible(false)}
        title="Layout Settings"
        subtitle="Configure grid dimensions and outer perimeters"
        scrollable={true}
        actions={[
          {
            label: 'Done',
            onPress: () => setModalVisible(false),
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
