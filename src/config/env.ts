import { ConfigError } from '@lib/error';
import fs from 'fs';

export const DOTFILE = '.sorge';
export const DOTFILE_WF = '.sorge.wf';

export type Config = {
  keycloakUser?: string;
  keycloakPassword?: string;
  keycloakClientId?: string;
  keycloakClientSecret?: string;
  odooRipBaseUrl?: string;
  keycloakUrl?: string;
  authToken?: string;
};

export function getConfig(): Config {
  try {
    const handle = fs.readFileSync(DOTFILE);
    return JSON.parse(handle.toString('utf-8'));
  } catch {
    return {};
  }
}

export function updateConfig(update: Config) {
  let config = getConfig();
  config = { ...config, ...update };
  fs.writeFileSync(DOTFILE, JSON.stringify(config, null, 2));
}

export function ensureEnv(fields: (keyof Config)[]) {
  const config = getConfig();
  const missing = fields.filter((field) => !config[field]);
  if (missing.length > 0) {
    throw new ConfigError(missing);
  }
}
