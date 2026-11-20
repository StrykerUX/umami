'use client';
import { Button, Column, Text, TextField } from '@umami/react-zen';
import { useState } from 'react';
import { PublicShell } from '../PublicShell';
import { ErrorText, Field } from '../ui';
import { publicFetch } from './InvitePage';

export function ForgotPage() {
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<any>(null);

  const submit = async () => {
    setError(null);
    try {
      await publicFetch('/aurora/password/forgot', {
        method: 'POST',
        body: JSON.stringify({ identifier }),
      });
      setSent(true);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <PublicShell title="Recuperar contraseña">
      {sent ? (
        <Text data-test="forgot-sent">
          Si existe una cuenta con ese dato, te enviamos un link para restablecer la contraseña.
          Revisa tu correo.
        </Text>
      ) : (
        <Column gap="3">
          <Field label="Email o usuario">
            <TextField
              data-test="forgot-identifier"
              value={identifier}
              onChange={setIdentifier}
              autoComplete="email"
            />
          </Field>
          <ErrorText error={error} />
          <Button
            data-test="forgot-submit"
            variant="primary"
            isDisabled={identifier.trim().length < 3}
            onPress={submit}
          >
            Enviar link
          </Button>
        </Column>
      )}
      <a href="/login">Volver a iniciar sesión</a>
    </PublicShell>
  );
}
