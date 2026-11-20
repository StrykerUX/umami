'use client';
import { Column, Row, Text } from '@umami/react-zen';
import type { CSSProperties, ReactNode } from 'react';
import { deltaText, deltaTone } from './format';

export const AURORA_COLORS = {
  primary: '#6d5ef6',
  accent: '#22c7d6',
  up: '#16a34a',
  down: '#dc2626',
  muted: '#6b7280',
};

export function Delta({
  value,
  inverse,
  points,
}: {
  value: number | null;
  inverse?: boolean;
  points?: boolean;
}) {
  const tone = deltaTone(value, inverse);
  const color =
    tone === 'up'
      ? AURORA_COLORS.up
      : tone === 'down'
        ? AURORA_COLORS.down
        : tone === 'new'
          ? AURORA_COLORS.accent
          : AURORA_COLORS.muted;
  const arrow = tone === 'neutral' || tone === 'new' ? '' : (value ?? 0) > 0 ? '▲ ' : '▼ ';

  return (
    <span data-test="delta" data-tone={tone} style={{ color, fontSize: 12, fontWeight: 600 }}>
      {arrow}
      {deltaText(value, points)}
    </span>
  );
}

export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
}) {
  return (
    <Column
      border
      borderRadius
      padding="4"
      gap="1"
      backgroundColor="surface"
      style={{ minWidth: 150 }}
    >
      <Text size="sm" color="muted">
        {label}
      </Text>
      <Text size="xl" weight="bold">
        {value}
      </Text>
      {delta}
    </Column>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <Column gap="1">
      <Text size="sm" weight="bold">
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="xs" color="muted">
          {hint}
        </Text>
      )}
    </Column>
  );
}

export function ErrorText({ error }: { error?: any }) {
  if (!error) return null;
  return (
    <Text size="sm" style={{ color: AURORA_COLORS.down }} data-test="aurora-error">
      {typeof error === 'string' ? error : error?.message || 'Ocurrió un error.'}
    </Text>
  );
}

export function StatusDot({ status }: { status?: string | null }) {
  const color =
    status === 'up'
      ? AURORA_COLORS.up
      : status === 'down'
        ? AURORA_COLORS.down
        : AURORA_COLORS.muted;
  const label = status === 'up' ? 'Arriba' : status === 'down' ? 'Caído' : 'Sin datos';

  return (
    <Row alignItems="center" gap="2">
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
          display: 'inline-block',
        }}
      />
      <Text size="sm">{label}</Text>
    </Row>
  );
}

export function Pill({ children, color }: { children: ReactNode; color?: string | null }) {
  const style: CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    background: `${color || AURORA_COLORS.primary}1f`,
    color: color || AURORA_COLORS.primary,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };

  return <span style={style}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Column alignItems="center" justifyContent="center" padding="8" gap="3" textAlign="center">
      <Text weight="bold">{title}</Text>
      {description && <Text color="muted">{description}</Text>}
      {action}
    </Column>
  );
}

export function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
  testId,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <select
      data-test={testId}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      style={{
        height: 36,
        borderRadius: 8,
        border: '1px solid var(--border-color, #d9d9d9)',
        padding: '0 10px',
        background: 'var(--surface-color, transparent)',
        color: 'inherit',
        minWidth: 160,
      }}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
