import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TableSummary } from '../api';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  tables: TableSummary[];
  commands: CommandItem[];
  onSelectTable: (tableName: string) => void;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  tables,
  commands,
  onSelectTable,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items = useMemo(() => {
    const tableItems: CommandItem[] = tables.map((t) => ({
      id: `table:${t.name}`,
      label: t.name,
      group: t.internal ? 'System Tables' : 'Tables',
      hint: `${t.rowCount} rows`,
      action: () => onSelectTable(t.name),
    }));
    const all = [...commands, ...tableItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 14);
    return all
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q),
      )
      .slice(0, 14);
  }, [commands, tables, query, onSelectTable]);

  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(0);
  }, [items.length, activeIdx]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="cmd-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => (items.length ? (i + 1) % items.length : 0));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) =>
              items.length ? (i - 1 + items.length) % items.length : 0,
            );
          } else if (e.key === 'Enter' && items[activeIdx]) {
            e.preventDefault();
            items[activeIdx].action();
            onClose();
          }
        }}
      >
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Jump to table, view, or action..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
        />
        <div className="cmd-list">
          {items.length === 0 ? (
            <div className="empty" style={{ padding: 20 }}>
              No matching commands
            </div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                className={`cmd-item ${idx === activeIdx ? 'active' : ''}`}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => {
                  item.action();
                  onClose();
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="badge">{item.group}</span>
                  <span>{item.label}</span>
                </span>
                {item.hint && (
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                    {item.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
