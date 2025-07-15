import dayjs from 'dayjs';
import { CrmPhase } from './types';
import { getWorkflowConfig, writeWorkflowConfig } from './workspace';
import { getPhases, updatePhase } from './api';

export type Backup = {
  name: string;
  ts: string;
  phases: { id: number; code: string }[];
};

export async function backupWorkflow(
  workflowSlug: string,
  { name, phases }: { name?: string; phases?: CrmPhase[] } = {},
) {
  const ts = dayjs().toISOString();
  const config = getWorkflowConfig(workflowSlug);
  phases = phases || (await getPhases(config.id, { fromCodeOnly: true }));
  config.backups = [
    {
      name: name || 'AUTO',
      ts,
      phases: phases.map(({ id, code }) => ({ id, code })),
    },
    ...config.backups,
  ].slice(0, 50);
  writeWorkflowConfig(workflowSlug, config);
}

export async function restoreWorkflowBackup(backup: Backup) {
  for (const { id, code } of backup.phases) {
    await updatePhase(id, { code });
  }
}
