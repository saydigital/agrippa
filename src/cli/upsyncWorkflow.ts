import { getPhases } from '@lib/api';
import { refreshToken } from '@lib/auth';
import { backupWorkflow } from '@lib/backup';
import { LocalResourceNotFound } from '@lib/error';
import { computePhaseStatus, performUpsync, PhaseStatus } from '@lib/upsync';
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
  all?: boolean;
  reportNoop?: boolean;
};

export async function upsyncLocalWorkflow(options: CliOptions = {}) {
  await refreshToken();
  if (options.all) {
    return doAll(options);
  } else {
    return doOne(options, { spin: true, prompt: true });
  }
}

async function doAll(options: CliOptions) {
  const spinner = ora('Computing phases').start();

  const workflows = listLocalWorkflows();
  const reportLines: {
    safe: { name: string; id: number }[];
    missing: { name: string; id: number }[];
    stale: { name: string; id: number }[];
    noop: { name: string; id: number }[];
  } = {
    safe: [],
    missing: [],
    stale: [],
    noop: [],
  };
  const allPhases: { [wfSlug: string]: PhaseStatus[] } = {};
  for (const wf of workflows) {
    const phases = await getPhases(wf.id);
    await backupWorkflow(wf.slug, { name: 'Pre upsync', phases });
    const phasesWithStatus = computePhaseStatus(wf.slug, phases);
    allPhases[wf.slug] = phasesWithStatus;
    const safe = phasesWithStatus.filter((s) => s.status === 'safe');
    const missing = phasesWithStatus.filter((s) => s.status === 'missing');
    const stale = phasesWithStatus.filter((s) => s.status === 'stale');
    const noop = phasesWithStatus.filter((s) => s.status === 'noop');

    reportLines.safe = [
      ...reportLines.safe,
      ...safe.map((phase) => ({
        name: `${wf.name} / ${phase.name}`,
        id: phase.id,
      })),
    ];

    reportLines.missing = [
      ...reportLines.missing,
      ...missing.map((phase) => ({
        name: `${wf.name} / ${phase.name}`,
        id: phase.id,
      })),
    ];

    reportLines.stale = [
      ...reportLines.stale,
      ...stale.map((phase) => ({
        name: `${wf.name} / ${phase.name}`,
        id: phase.id,
      })),
    ];

    reportLines.noop = [
      ...reportLines.noop,
      ...noop.map((phase) => ({
        name: `${wf.name} / ${phase.name}`,
        id: phase.id,
      })),
    ];
  }

  spinner.stop();

  const answer = await inquirer.prompt([
    {
      name: 'confirm',
      type: 'confirm',
      message: [
        'Summary of operations:',
        '',
        ...reportLines.safe.map((line) => `- [SYNC-SAFE] ${line.name}`),
        '',
        ...reportLines.stale.map((line) => `- [SYNC-DANGER] ${line.name}`),
        '',
        ...reportLines.missing.map((line) => `- [SKIP-MISSING] ${line.name}`),
        '',
        ...(options.reportNoop
          ? reportLines.missing.map((line) => `- [SKIP-MISSING] ${line.name}`)
          : []),
        '',
      ].join('\n'),
    },
  ]);

  if (!answer.confirm) {
    return;
  }

  spinner.text = 'Syncing';
  spinner.start();

  for (const wf of workflows) {
    const phases = allPhases[wf.slug]!;
    await performUpsync(wf.slug, phases);
  }

  spinner.stop();
}

async function doOne(
  options: CliOptions,
  { prompt, spin }: { prompt?: boolean; spin?: boolean },
) {
  const config = await selectWorkflow(options);
  const spinner = ora('Getting auth token');

  if (spin) {
    spinner.start();
  }

  spinner.text = 'Downloading phases';
  const phases = await getPhases(config.id);
  const phasesWithStatus = computePhaseStatus(config.slug, phases);
  const safe = phasesWithStatus.filter((s) => s.status === 'safe');
  const missing = phasesWithStatus.filter((s) => s.status === 'missing');
  const stale = phasesWithStatus.filter((s) => s.status === 'stale');
  const noop = phasesWithStatus.filter((s) => s.status === 'noop');

  spinner.stop();

  if (prompt) {
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

          ...(options.reportNoop && noop.length > 0
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
  }

  spinner.text = 'Taking a backup';
  if (spin) {
    spinner.start();
  }
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
      throw new LocalResourceNotFound(options.workflow);
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
