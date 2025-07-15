import { getPhases } from '@lib/api';
import { refreshToken } from '@lib/auth';
import { CrmPhase } from '@lib/types';
import {
  computeChangedPhases,
  generateWorkflowDir,
  isWorkflowTracked,
  listLocalWorkflows,
} from '@lib/workspace';
import inquirer from 'inquirer';
import ora from 'ora';

type CliOptions = {
  only?: string;
};

export async function refreshLocalWorkflows(options: CliOptions = {}) {
  const spinner = ora('Getting auth token').start();
  await refreshToken();
  let localWorkflows = listLocalWorkflows();

  if (options.only && isWorkflowTracked(options.only)) {
    localWorkflows = localWorkflows.filter((wf) => wf.slug === options.only);
  }

  spinner.text = 'Downloading phases';
  const phaseMap: { [id: number]: CrmPhase[] } = {};
  let allChanges: string[] = [];
  for (const config of localWorkflows) {
    const phases = await getPhases(config.id, { fromCodeOnly: true });
    const changes = computeChangedPhases(config.slug, phases);
    phaseMap[config.id] = phases;
    allChanges = [
      ...allChanges,
      ...changes.map((ch) => `[${config.name}] ${ch}`),
    ];
  }

  spinner.stop();

  let confirm = true;

  if (allChanges.length > 0) {
    const answer = await inquirer.prompt([
      {
        name: 'confirm',
        type: 'confirm',
        message: [
          'The following phases have local changes that will be overwritten:',
          ...allChanges.map((ch) => `- ${ch}`),
          'Confirm?',
        ].join('\n'),
      },
    ]);
    confirm = answer.confirm;
  }

  if (confirm) {
    for (const config of localWorkflows) {
      generateWorkflowDir(config.slug, config, phaseMap[config.id]);
    }
  }
}
