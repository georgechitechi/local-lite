export const CANVAS_PADDING = 20;

export interface LayoutItem {
  id: string;
  label: string;
  col: number;
  row: number;
  colsSpan: number;
  rowsSpan: number;
}

export interface PropertyLayoutData {
  cols: number;
  rows: number;
  items: LayoutItem[];
  hasFence: boolean;
  hasGate: boolean;
  gatePosition: 'top' | 'bottom' | 'left' | 'right' | string;
}

export const getColWidth = (
  colIndex: number,
  totalCols: number,
  canvasWidth: number,
): number => {
  if (totalCols === 3) {
    const walkwayWidth = canvasWidth < 300 ? 30 : 60; // Scale central walkway if rendered tightly
    if (colIndex === 1) return walkwayWidth;
    return (canvasWidth - walkwayWidth) / 2; // Split the rest evenly between Col 0 and 2
  }
  // Fallback for uniform columns
  return canvasWidth / totalCols;
};

export const getColOffset = (
  colIndex: number,
  totalCols: number,
  canvasWidth: number,
): number => {
  let offset = 0;
  for (let i = 0; i < colIndex; i++) {
    offset += getColWidth(i, totalCols, canvasWidth);
  }
  return offset;
};
