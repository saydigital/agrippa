import { getConfig, updateConfig } from '@config/env';
import inquirer from 'inquirer';

export function initWorkspace() {
  const config = getConfig();
  return inquirer
    .prompt([
      {
        name: 'keycloakUser',
        message: 'Keycloak username',
        type: 'input',
        default: config.keycloakUser || '',
      },
      {
        name: 'keycloakPassword',
        message: 'Keycloak password',
        type: 'input',
        default: config.keycloakPassword || '',
      },
      {
        name: 'keycloakClientId',
        message: 'Keycloak client id',
        type: 'input',
        default: config.keycloakClientId || '',
      },
      {
        name: 'keycloakClientSecret',
        message: 'Keycloak client secret',
        type: 'input',
        default: config.keycloakClientSecret || '',
      },
      {
        name: 'odooRipBaseUrl',
        message: 'Base URL RIP',
        type: 'input',
        default:
          config.odooRipBaseUrl ||
          'https://odoo.sorgenia-test-02.symple.cloud/rip/v3/api',
      },
      {
        name: 'keycloakUrl',
        message: 'URL keycloak',
        type: 'input',
        default:
          config.keycloakUrl ||
          'https://login-test.symple.cloud/auth/realms/sorgenia-test-02/protocol/openid-connect/token',
      },
    ])
    .then((answers) => {
      updateConfig(answers);
    })
    .catch(() => {});
}
