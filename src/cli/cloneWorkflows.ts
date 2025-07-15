import { getPhases, getWorkflows } from '@lib/api';
import { refreshToken } from '@lib/auth';
import {
  computeChangedPhases,
  generateWorkflowDir,
  getWorkflowDirectoryMetaData,
} from '@lib/workspace';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';

export async function cloneWorkflows() {
  const spinner = ora('Getting auth token').start();
  await refreshToken();
  spinner.text = 'Downloading workflows';
  const workflows = await getWorkflows();
  spinner.stop();
  const answer = await inquirer.prompt([
    {
      name: 'workflow',
      message: 'Select workflow to clone',
      type: 'search',
      source: (input: any) => {
        if (!input) {
          return workflows.map((wf) => ({ name: wf.name, value: wf.id }));
        }
        const escapedInput = (input as string).replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        const pat = new RegExp(escapedInput, 'ig');
        return workflows
          .filter((wf) => pat.test(wf.name))
          .map((wf) => ({ name: wf.name, value: wf.id }));
      },
    },
  ]);
  const workflowId = answer.workflow;
  const workflow = workflows.find((wf) => wf.id === workflowId)!;
  spinner.text = 'Downloading phases';
  spinner.start();
  const phases = await getPhases(workflowId, { fromCodeOnly: true });
  const meta = getWorkflowDirectoryMetaData(workflow.name);

  spinner.stop();

  if (meta.existsDotFile) {
    const changedPhases = computeChangedPhases(meta.slug, phases);
    if (changedPhases.length > 0) {
      const answer = await inquirer.prompt([
        {
          name: 'overwrite',
          type: 'confirm',
          message: [
            'Some of the python code on the local system is different than on the remote.',
            'The changes to the following phases will be lost:',
            ...changedPhases.map((name) => chalk.red(name)),
            'Overwrite',
          ].join('\n'),
        },
      ]);
      if (answer.overwrite) {
        generateWorkflowDir(meta.slug, workflow, phases);
      }
      return;
    }
  }

  generateWorkflowDir(meta.slug, workflow, phases);
}
