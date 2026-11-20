'use client';
import type { ReactNode } from 'react';

const cell = {
  padding: '10px 8px',
  borderBottom: '1px solid var(--border-color, #e6e8ef)',
  verticalAlign: 'top' as const,
};

export function SimpleTable({
  columns,
  rows,
  testId,
}: {
  columns: { key: string; label: string; align?: 'left' | 'right'; width?: number | string }[];
  rows: { key: string; cells: Record<string, ReactNode> }[];
  testId?: string;
}) {
  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table data-test={testId} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                style={{
                  ...cell,
                  textAlign: c.align ?? 'left',
                  fontWeight: 600,
                  fontSize: 12,
                  opacity: 0.7,
                  width: c.width,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} data-test="row">
              {columns.map(c => (
                <td key={c.key} style={{ ...cell, textAlign: c.align ?? 'left' }}>
                  {r.cells[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
