'use client';
import { Button, Column, Loading, Row, Text } from '@umami/react-zen';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApi, useLoginQuery } from '@/components/hooks';
import { setReturnUrl } from '@/lib/return-url';
import { ROLE_LABELS } from '../format';
import { PublicShell } from '../PublicShell';
import { AURORA_COLORS } from '../ui';

interface Details {
  client: { id: string; name: string; uri: string | null; registeredAt: string };
  redirectHost: string;
  redirectUri: string;
  user: { username: string; role: keyof typeof ROLE_LABELS };
}

function errorText(error: any) {
  if (error?.code === 'password-change-required') {
    return 'Cambia tu contraseña (Perfil → Contraseña) antes de conectar aplicaciones.';
  }

  return error?.error_description || error?.message || 'Solicitud de autorización inválida.';
}

function registeredAgo(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));

  if (minutes < 1) return 'hace un momento';
  if (minutes < 120) return `hace ${minutes} min`;
  if (minutes < 48 * 60) return `hace ${Math.round(minutes / 60)} h`;

  return `hace ${Math.round(minutes / 1440)} días`;
}

export function OAuthConsentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams]);
  const { user, isLoading, isFetched } = useLoginQuery();
  const { get, post, useQuery, useMutation } = useApi();
  const [redirecting, setRedirecting] = useState(false);
  // Clickjacking defence in depth (CSP frame-ancestors also applies).
  const framed = typeof window !== 'undefined' && window.top !== window.self;

  useEffect(() => {
    if (!isLoading && isFetched && !user) {
      setReturnUrl(`/oauth/authorize?${searchParams.toString()}`);
      router.replace('/login');
    }
  }, [isLoading, isFetched, user, router, searchParams]);

  const details = useQuery<Details>({
    queryKey: ['aurora-oauth-authorize', params],
    queryFn: () => get('/aurora/oauth/authorize', params),
    enabled: !!user && !framed,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'deny') =>
      post('/aurora/oauth/authorize', { ...params, decision }) as Promise<{ redirectUrl: string }>,
    onSuccess: ({ redirectUrl }) => {
      setRedirecting(true);
      window.location.assign(redirectUrl);
    },
  });

  if (framed) {
    return (
      <PublicShell title="Autorización bloqueada">
        <Text>Esta página no puede mostrarse dentro de otra.</Text>
      </PublicShell>
    );
  }

  if (!user || details.isLoading) {
    return <Loading placement="absolute" />;
  }

  if (details.error || !details.data) {
    return (
      <PublicShell title="No se pudo autorizar">
        <Text data-test="oauth-error">{errorText(details.error)}</Text>
      </PublicShell>
    );
  }

  const { client, redirectHost, user: who } = details.data;
  const busy = decide.isPending || redirecting;

  return (
    <PublicShell title="Conectar aplicación">
      <Column gap="4" data-test="oauth-consent">
        <Text size="lg">
          <strong>{client.name}</strong> quiere acceder a Aurora Analytics con tu cuenta.
        </Text>
        <Column gap="2" padding="3" border borderRadius>
          <Text>Podrá, en tu nombre:</Text>
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            <li>
              <Text>Consultar analytics, sitios, clientes, reportes y uptime.</Text>
            </li>
            <li>
              <Text>
                Usar las herramientas MCP con tus permisos actuales (
                {ROLE_LABELS[who.role] ?? who.role}).
              </Text>
            </li>
          </ul>
        </Column>
        <Text color="muted" size="sm" data-test="oauth-client-age">
          Aplicación registrada {registeredAgo(client.registeredAt)} · ID {client.id.slice(0, 8)}
        </Text>
        <Text color="muted" size="sm">
          Al permitir, se te enviará a <strong>{redirectHost}</strong>. El nombre de la aplicación
          lo declara ella misma: continúa solo si tú iniciaste esta conexión.
        </Text>
        <Text color="muted" size="sm">
          Sesión: {who.username}. Puedes revocar el acceso en Aurora → Conexiones.
        </Text>
        {decide.error && (
          <Text style={{ color: AURORA_COLORS.down }}>{errorText(decide.error)}</Text>
        )}
        <Row gap="3" justifyContent="flex-end">
          <Button data-test="oauth-deny" onPress={() => decide.mutate('deny')} isDisabled={busy}>
            Denegar
          </Button>
          <Button
            data-test="oauth-approve"
            variant="primary"
            onPress={() => decide.mutate('approve')}
            isDisabled={busy}
          >
            Permitir
          </Button>
        </Row>
        {redirecting && <Text color="muted">Redirigiendo…</Text>}
      </Column>
    </PublicShell>
  );
}
