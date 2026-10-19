import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  type PanResponderInstance,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getColOffset, getColWidth, type LayoutItem } from './layoutHelpers';

interface DraggableItemProps {
  item: LayoutItem;
  onUpdatePosition: (id: string, newCol: number, newRow: number) => void;
  cellHeight: number;
  maxCols: number;
  maxRows: number;
  canvasWidth: number;
  readOnly?: boolean;
  colors: any;
  styles: any;
}

export const DraggableItem: React.FC<DraggableItemProps> = ({
  item,
  onUpdatePosition,
  cellHeight,
  maxCols,
  maxRows,
  canvasWidth,
  readOnly,
  colors,
  styles,
}) => {
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
  const panX = useMemo(() => new Animated.Value(initialX), [initialX]);
  const panY = useMemo(() => new Animated.Value(initialY), [initialY]);

  const opacity = useMemo(() => new Animated.Value(1), []);
  const scale = useMemo(() => new Animated.Value(1), []);

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
          const { readOnly: isReadOnly, item: targetItem } = latestBounds.current;
          return !isReadOnly && targetItem.id !== 'walkway';
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

export default DraggableItem;
