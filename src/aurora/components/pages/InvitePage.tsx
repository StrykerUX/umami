'use client';
import { Button, Column, Loading, PasswordField, Text, TextField } from '@umami/react-zen';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/api-url';
import { setClientAuthToken } from '@/lib/client';
import { setUser } from '@/store/app';
import { ROLE_LABELS } from '../format';
import { PublicShell } from '../PublicShell';
import { ErrorText, Field } from '../ui';

export async function publicFetch(path: string, init?: RequestInit) {
  const res = await fetch(getApiUrl(path), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'Ocurrió un error.');
  return data;
}

export function InvitePage({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    publicFetch(`/aurora/invites/accept?token=${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(e => setLoadError(e.message));
  }, [token]);

  const submit = async () => {
    setError(null);
    if (form.password.length < 8)
      return setError('La contraseña debe tener al menos 8 caracteres.');
    if (form.password !== form.confirm) return setError('Las contraseñas no coinciden.');
    setBusy(true);
    try {
      const result = await publicFetch('/aurora/invites/accept', {
        method: 'POST',
        body: JSON.stringify({
          token,
          username: form.username,
          password: form.password,
          displayName: form.displayName || undefined,
          email: invite?.email ? undefined : form.email || undefined,
        }),
      });
      setClientAuthToken(result.token);
      setUser(result.user);
      router.replace('/');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <PublicShell title="Invitación no válida">
        <Text data-test="invite-invalid">{loadError}</Text>
        <a href="/login">Ir a iniciar sesión</a>
      </PublicShell>
    );
  }

  if (!invite) {
    return <Loading placement="absolute" />;
  }

  return (
    <PublicShell title="Crea tu cuenta">
      <Text color="muted">
        Te uniste como <b>{ROLE_LABELS[invite.role as keyof typeof ROLE_LABELS] ?? invite.role}</b>
        {invite.email ? ` con ${invite.email}` : ''}.
      </Text>
      <Column gap="3">
        {!invite.email && (
          <Field label="Email" hint="Para recuperar tu contraseña.">
            <TextField
              data-test="signup-email"
              value={form.email}
              onChange={set('email')}
              autoComplete="email"
            />
          </Field>
        )}
        <Field label="Nombre visible">
          <TextField
            data-test="signup-display"
            value={form.displayName}
            onChange={set('displayName')}
          />
        </Field>
        <Field label="Usuario" hint="Con este entras. Letras, números, punto, guion o @.">
          <TextField
            data-test="signup-username"
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
          />
        </Field>
        <Field label="Contraseña">
          <PasswordField
            data-test="signup-password"
            value={form.password}
            onChange={e => set('password')(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirmar contraseña">
          <PasswordField
            data-test="signup-confirm"
            value={form.confirm}
            onChange={e => set('confirm')(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <ErrorText error={error} />
        <Button
          data-test="signup-submit"
          variant="primary"
          isDisabled={busy || !form.username || !form.password}
          onPress={submit}
        >
          Crear cuenta y entrar
        </Button>
      </Column>
    </PublicShell>
  );
}
