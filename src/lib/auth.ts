import { ensureEnv, getConfig, updateConfig } from '@config/env';
import { ConnectError } from './error';
import fetch from 'node-fetch';

export async function getToken(): Promise<string> {
  ensureEnv([
    'keycloakUrl',
    'keycloakPassword',
    'keycloakUser',
    'keycloakClientId',
    'keycloakClientSecret',
  ]);
  const {
    keycloakPassword,
    keycloakUser,
    keycloakUrl,
    keycloakClientId,
    keycloakClientSecret,
  } = getConfig();

  const response = await fetch(keycloakUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeQs({
      username: keycloakUser,
      password: keycloakPassword,
      client_id: keycloakClientId,
      client_secret: keycloakClientSecret,
      grant_type: 'password',
    }),
  });

  if (response.status === 200) {
    const json = (await response.json()) as { access_token: string };
    return json.access_token;
  } else {
    throw new ConnectError(response, await response.text());
  }
}

export async function refreshToken() {
  const token = await getToken();
  updateConfig({
    authToken: token,
  });
}

function encodeQs(body: any) {
  const searchParams = new URLSearchParams();
  Object.entries(body).forEach(([key, value]) => {
    searchParams.append(key, value as string);
  });
  return searchParams.toString();
}
