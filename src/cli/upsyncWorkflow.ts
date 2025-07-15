import { getPhases } from '@lib/api';
import { refreshToken } from '@lib/auth';
import { backupWorkflow } from '@lib/backup';
import { LocalWorkflowNotFound } from '@lib/error';
import { computePhaseStatus, performUpsync } from '@lib/upsync';
import {
  getWorkflowConfig,
  isWorkflowTracked,
  listLocalWorkflows,
  WorkflowConfig,
} from '@lib/workspace';
import inquirer from 'inquirer';
import ora from 'ora';

type CliOptions = {
  workflow?: string;
};

export async function upsyncLocalWorkflow(options: CliOptions = {}) {
  const config = await selectWorkflow(options);
  const spinner = ora('Getting auth token').start();
  await refreshToken();
  spinner.text = 'Downloading phases';
  const phases = await getPhases(config.id);
  const phasesWithStatus = computePhaseStatus(config.slug, phases);
  const safe = phasesWithStatus.filter((s) => s.status === 'safe');
  const missing = phasesWithStatus.filter((s) => s.status === 'missing');
  const stale = phasesWithStatus.filter((s) => s.status === 'stale');
  const noop = phasesWithStatus.filter((s) => s.status === 'noop');

  spinner.stop();

  const report = await inquirer.prompt([
    {
      name: 'confirm',
      type: 'confirm',
      message: [
        'Summary of operations that will be performed:',
        '',
        ...(stale.length > 0
          ? [
              '[WARNING - STALE] The following phases were modified on the remote after',
              'your last sync, make sure you want to overwrite them:',
              ...stale.map((phase) => `- ${phase.name}`),
              '',
            ]
          : []),
        ...(missing.length > 0
          ? [
              '[ERROR - MISSING] The following phases have ids that can ',
              'no longer be found on the remote, so they will not be written to Odoo:',
              ...missing.map((phase) => `- ${phase.name}`),
              '',
            ]
          : []),
        ...(safe.length > 0
          ? [
              '[SAFE] These phases were modified and do NOT conflict with the remote',
              'since the last sync:',
              ...safe.map((phase) => `- ${phase.name}`),
              '',
            ]
          : []),

        ...(noop.length > 0
          ? [
              '[NOOP] These phases are the same as on the remote:',
              ...noop.map((phase) => `- ${phase.name}`),
            ]
          : []),
        'Confirm',
      ].join('\n'),
    },
  ]);

  if (!report.confirm) {
    return;
  }

  spinner.text = 'Taking a backup';
  spinner.start();
  await backupWorkflow(config.slug, { phases, name: 'Pre upsync' });
  spinner.text = 'Syncing';
  await performUpsync(config.slug, phasesWithStatus);
  spinner.stop();
  spinner.text = 'Done';
}

async function selectWorkflow(options: CliOptions): Promise<WorkflowConfig> {
  if (options.workflow) {
    if (isWorkflowTracked(options.workflow)) {
      return getWorkflowConfig(options.workflow);
    } else {
      throw new LocalWorkflowNotFound(options.workflow);
    }
  }
  const localWorkflows = listLocalWorkflows();
  const answer = await inquirer.prompt([
    {
      name: 'workflow',
      message: 'Select workflow to upsync',
      type: 'search',
      source: (input: any) => {
        if (!input) {
          return localWorkflows.map((wf) => ({ name: wf.name, value: wf.id }));
        }
        const escapedInput = (input as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const pat = new RegExp(escapedInput, 'ig');
        return localWorkflows
          .filter((wf) => pat.test(wf.name))
          .map((wf) => ({ name: wf.name, value: wf.id }));
      },
    },
  ]);
  const config = localWorkflows.find((wf) => wf.id === answer.workflow)!;
  return config;
}
