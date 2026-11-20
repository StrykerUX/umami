'use client';
import { Button, Column, PasswordField, Text } from '@umami/react-zen';
import { useState } from 'react';
import { PublicShell } from '../PublicShell';
import { ErrorText, Field } from '../ui';
import { publicFetch } from './InvitePage';

export function ResetPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<any>(null);

  const submit = async () => {
    setError(null);
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    try {
      await publicFetch('/aurora/password/reset', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <PublicShell title="Nueva contraseña">
      {done ? (
        <Column gap="3">
          <Text data-test="reset-done">
            Listo. Tu contraseña se actualizó y se cerraron las sesiones anteriores.
          </Text>
          <a href="/login">Iniciar sesión</a>
        </Column>
      ) : (
        <Column gap="3">
          <Field label="Nueva contraseña">
            <PasswordField
              data-test="reset-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirmar">
            <PasswordField
              data-test="reset-confirm"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <ErrorText error={error} />
          <Button data-test="reset-submit" variant="primary" onPress={submit}>
            Guardar contraseña
          </Button>
        </Column>
      )}
    </PublicShell>
  );
}
