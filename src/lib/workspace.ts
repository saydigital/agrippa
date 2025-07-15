import { DOTFILE_WF } from '@config/env';
import slugify from 'slugify';
import fs, { readFileSync } from 'fs';
import { CrmPhase, CrmWorkflow } from './types';
import dayjs from 'dayjs';
import path from 'path';
import { Backup } from './backup';
import { LocalWorkflowNotFound } from './error';

export type WorkflowConfig = {
  slug: string;
  id: number;
  lastSyncAt: string;
  name: string;
  phases: {
    name: string;
    id: number;
    slug: string;
    filename: string;
  }[];
  backups: Backup[];
};

function toSlug(str: string) {
  return slugify(str, {
    lower: true,
    trim: true,
    replacement: '-',
  });
}

export function isWorkflowTracked(slug: string) {
  try {
    getWorkflowConfig(slug);
    return true;
  } catch {
    return false;
  }
}

export function getWorkflowPaths(slug: string) {
  const dirPath = path.join('.', slug);
  const dotfilePath = path.join('.', dirPath, DOTFILE_WF);
  return { dirPath, dotfilePath };
}

export function getWorkflowDirectoryMetaData(workflowName: string) {
  const slug = toSlug(workflowName);

  const { dirPath, dotfilePath } = getWorkflowPaths(slug);

  const existsDir = fs.existsSync(dirPath);
  const existsDotFile = fs.existsSync(dotfilePath);

  return {
    slug,
    dirPath,
    dotfilePath,
    existsDotFile,
    existsDir,
  };
}

export function computeChangedPhases(
  slug: string,
  newPhases: CrmPhase[],
): string[] {
  const { dirPath } = getWorkflowPaths(slug);
  const config = getWorkflowConfig(slug);
  const changed = [];

  for (const oldPhase of config.phases) {
    const { filename, name } = oldPhase;
    const newPhase = newPhases.find((ph) => ph.id === oldPhase.id);
    if (!newPhase) {
      continue;
    }
    const currentCode = fs
      .readFileSync(path.join(dirPath, filename))
      .toString('utf-8');

    if (currentCode.trim() !== newPhase.code.trim()) {
      changed.push(name);
    }
  }

  return changed;
}

export function getWorkflowConfig(slug: string): WorkflowConfig {
  const { dotfilePath } = getWorkflowPaths(slug);
  const handle = readFileSync(dotfilePath);
  const config = JSON.parse(handle.toString('utf-8'));
  return config;
}

export function writeWorkflowConfig(slug: string, config: WorkflowConfig) {
  const { dotfilePath } = getWorkflowPaths(slug);
  fs.writeFileSync(dotfilePath, JSON.stringify(config, null, 2));
}

export function generateWorkflowDir(
  slug: string,
  wf: CrmWorkflow,
  phases: CrmPhase[],
  { preserveBackups }: { preserveBackups?: boolean } = {},
) {
  const { dirPath, dotfilePath } = getWorkflowPaths(slug);
  const { existsDotFile } = getWorkflowDirectoryMetaData(wf.name);
  let backups: Backup[] = [];
  if (existsDotFile && preserveBackups) {
    const config = getWorkflowConfig(slug);
    backups = config.backups;
  }
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { force: true, recursive: true });
  }
  fs.mkdirSync(dirPath);
  const config: WorkflowConfig = {
    slug,
    id: wf.id,
    lastSyncAt: dayjs().toISOString(),
    name: wf.name,
    phases: phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      slug: toSlug(phase.name),
      filename: `${toSlug(phase.name)}.py`,
    })),
    backups,
  };

  fs.writeFileSync(dotfilePath, JSON.stringify(config, null, 2));

  phases.forEach((phase) => {
    const phasePath = path.join(dirPath, `${toSlug(phase.name)}.py`);
    fs.writeFileSync(phasePath, phase.code);
  });
}

export function listLocalWorkflows(): WorkflowConfig[] {
  const dirs = fs.readdirSync('.');
  const configs: WorkflowConfig[] = [];
  for (const slug of dirs) {
    const { dotfilePath } = getWorkflowPaths(slug);
    try {
      if (fs.existsSync(dotfilePath)) {
        configs.push(getWorkflowConfig(slug));
      }
    } catch {
      continue;
    }
  }
  return configs;
}
