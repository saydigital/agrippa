import { ensureEnv, getConfig } from '@config/env';
import fetch from 'node-fetch';
import { ConnectError } from './error';
import { CrmPhase, CrmWorkflow } from './types';
import SimpleCache from '@lib/cache';

const cache = new SimpleCache();

export async function getWorkflows() {
  return makeRequest<CrmWorkflow[]>('GET', '/symple.workflow/*', {
    cache: true,
  });
}

export async function getPhases(
  workflowId: string | number,
  { fromCodeOnly }: { fromCodeOnly?: boolean } = {},
) {
  const phases = await makeRequest<CrmPhase[]>(
    'GET',
    `/symple.triplet.phase/*?_filter_=[('workflow_id', '=', ${workflowId})]`,
  );
  if (fromCodeOnly) {
    return phases.filter(
      (phase) => phase.set_result_automatically === 'from_code',
    );
  }
  return phases;
}

export function updatePhase(id: number, body: any) {
  return makeRequest<any>('PUT', `/symple.triplet.phase/${id}`, { body });
}

export async function makeRequest<T>(
  method: string,
  path: string,
  args: { body?: any; cache?: boolean } = {},
): Promise<T> {
  const { body, cache: doCache } = args;

  const cacheKey = path;

  if (doCache) {
    const cachedValue = await cache.get(cacheKey);
    if (cachedValue) {
      return cachedValue;
    }
  }

  ensureEnv(['authToken', 'odooRipBaseUrl']);

  const { authToken, odooRipBaseUrl } = getConfig();
  const headers = {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${odooRipBaseUrl}${path}`, {
    method,
    headers,
    body: body && JSON.stringify(body),
  });
  if (res.status === 200) {
    const json = await res.json();
    if (doCache) {
      cache.set(cacheKey, json);
    }
    return json as T;
  } else {
    throw new ConnectError(res, await res.text());
  }
}
