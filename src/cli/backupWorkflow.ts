import { refreshToken } from '@lib/auth';
import * as backup from '@lib/backup';
import {
  getWorkflowConfig,
  isWorkflowTracked,
  listLocalWorkflows,
  WorkflowConfig,
} from '@lib/workspace';
import dayjs from 'dayjs';
import inquirer from 'inquirer';
import ora, { Ora } from 'ora';

type CliOptions = {
  workflow?: string;
  restore?: boolean;
  name?: string;
};

export function backupWorkflow(options: CliOptions = {}) {
  const spinner = ora('Getting auth token').start();
  refreshToken();

  spinner.stop();

  if (options.restore) {
    restoreBackup(options, spinner);
  } else {
    takeBackup(options, spinner);
  }
}

async function takeBackup(options: CliOptions, spinner: Ora) {
  const config = await selectWorkflow(options);
  spinner.text = 'Taking backup';
  spinner.start();
  await backup.backupWorkflow(config.slug, {
    name: options.name || 'Manual backup',
  });

  spinner.stop();
}

async function restoreBackup(options: CliOptions, spinner: Ora) {
  const config = await selectWorkflow(options);
  const backups = config.backups;
  const answer = await inquirer.prompt([
    {
      name: 'choice',
      type: 'search',
      message: 'Select backup to restore',
      source: (input: any) => {
        if (!input) {
          return backups.map((bck) => ({
            name: `[${bck.name}] ${fmt(bck.ts)}`,
            value: bck.ts,
          }));
        }
        const escapedInput = (input as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const pat = new RegExp(escapedInput, 'ig');
        return backups
          .filter((bck) => pat.test(`[${bck.name}] ${fmt(bck.ts)}`))
          .map((bck) => {
            return {
              name: ``,
              value: fmt(bck.ts),
            };
          });
      },
    },
  ]);

  const toRestore = backups.find((bck) => bck.ts === answer.choice)!;
  spinner.text = 'Restoring backup';
  spinner.start();
  await backup.restoreWorkflowBackup(toRestore);
  spinner.stop();
}

async function selectWorkflow(options: CliOptions): Promise<WorkflowConfig> {
  if (options.workflow && isWorkflowTracked(options.workflow)) {
    return getWorkflowConfig(options.workflow);
  }
  const locals = listLocalWorkflows();
  const answer = await inquirer.prompt([
    {
      name: 'workflow',
      message: 'Select a workflow to backup',
      type: 'search',
      source: (input: any) => {
        if (!input) {
          return locals.map((wf) => ({ name: wf.name, value: wf.slug }));
        }
        const escapedInput = (input as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const pat = new RegExp(escapedInput, 'ig');
        return locals
          .filter((wf) => pat.test(wf.name))
          .map((wf) => ({ name: wf.name, value: wf.id }));
      },
    },
  ]);

  return getWorkflowConfig(answer.workflow);
}

const fmt = (d: string) => {
  return dayjs(d).format('D/M/YY HH:mm');
};
