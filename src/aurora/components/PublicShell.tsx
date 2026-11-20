'use client';
import { Column, Heading, Row } from '@umami/react-zen';
import type { ReactNode } from 'react';
import { AuroraLogo } from './AuroraLogo';

export function PublicShell({
  title,
  children,
  wide,
}: {
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Column
      alignItems="center"
      minHeight="100vh"
      backgroundColor="surface-raised"
      padding="6"
      style={{ paddingTop: wide ? 32 : '12vh' }}
    >
      <Column gap="6" style={{ width: '100%', maxWidth: wide ? 1100 : 380 }}>
        <Row gap="3" alignItems="center" justifyContent={wide ? 'flex-start' : 'center'}>
          <AuroraLogo size={32} />
          <Heading size="lg">Aurora Analytics</Heading>
        </Row>
        {title && <Heading size="base">{title}</Heading>}
        {children}
      </Column>
    </Column>
  );
}
