import dayjs from 'dayjs';
import { CrmPhase } from './types';
import {
  getWorkflowConfig,
  getWorkflowPaths,
  writeWorkflowConfig,
} from './workspace';
import { readFileSync } from 'fs';
import utc from 'dayjs/plugin/utc.js'; // Import UTC plugin

import path from 'path';
import { updatePhase } from './api';

dayjs.extend(utc);

export type PhaseStatus = {
  name: string;
  id: number;
  status: 'stale' | 'noop' | 'safe' | 'missing';
};

export function computePhaseStatus(
  slug: string,
  newPhases: CrmPhase[],
): PhaseStatus[] {
  const { lastSyncAt, phases } = getWorkflowConfig(slug);
  const { dirPath } = getWorkflowPaths(slug);
  const localDate = dayjs.utc(lastSyncAt);

  return phases.map((phase) => {
    const remotePhase = newPhases.find((rp) => rp.id === phase.id);
    if (!remotePhase) {
      return {
        name: phase.name,
        id: phase.id,
        status: 'missing',
      };
    }

    const isStale = dayjs.utc(remotePhase.write_date).isAfter(localDate);

    const isNoop =
      remotePhase.code.trim() ===
      readFileSync(path.join(dirPath, phase.filename)).toString('utf-8').trim();

    if (isStale) {
      return {
        name: phase.name,
        id: phase.id,
        status: 'stale',
      };
    }
    if (isNoop) {
      return {
        name: phase.name,
        id: phase.id,
        status: 'noop',
      };
    }

    return {
      name: phase.name,
      id: phase.id,
      status: 'safe',
    };
  });
}

export async function performUpsync(
  workflowSlug: string,
  phases: PhaseStatus[],
) {
  const { dirPath } = getWorkflowPaths(workflowSlug);
  const config = getWorkflowConfig(workflowSlug);

  for (const phase of phases) {
    const { id, status } = phase;
    if (status === 'missing' || status === 'noop') {
      continue;
    }
    const { filename } = config.phases.find((p) => p.id === id)!;
    const code = readFileSync(path.join(dirPath, filename))
      .toString('utf-8')
      .trim();
    await updatePhase(id, { code });
  }

  writeWorkflowConfig(workflowSlug, {
    ...config,
    lastSyncAt: dayjs().toISOString(),
  });
}
