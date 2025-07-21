import { getModelFunctions } from '@lib/api';
import { refreshToken } from '@lib/auth';
import { NothingToSync, RemoteResourceNotFound } from '@lib/error';
import {
  computeUpsyncOperations,
  getIsCloningSafe,
  getModelFuncionAccessConfig,
  listLocalModelFunctions,
  performUpsync,
  takeBackup,
  writeFunctionToWorkspace,
} from '@lib/mfa';
import inquirer from 'inquirer';
import ora from 'ora';

export async function cloneModelFunction() {
  const spinner = ora('Getting token').start();
  await refreshToken();
  spinner.text = 'Loading functions';
  const functions = await getModelFunctions();
  spinner.stop();
  const choice = await inquirer.prompt([
    {
      name: 'choice',
      type: 'search',
      message: 'Choose a function to clone',
      source: (input: any) => {
        if (!input) {
          return functions.map((fn) => ({
            name: `${fn.model_name} / ${fn.name}`,
            value: fn.id,
          }));
        }
        const pat = new RegExp(input, 'i');
        return functions
          .filter((fn) => pat.test(`${fn.model_name} / ${fn.name}`))
          .map((fn) => ({
            name: `${fn.model_name} / ${fn.name}`,
            value: fn.id,
          }));
      },
    },
  ]);

  const toClone = functions.find((fn) => fn.id === choice.choice)!;
  const config = getModelFuncionAccessConfig(toClone);
  const isSafe = getIsCloningSafe(toClone, config);
  if (isSafe) {
    return writeFunctionToWorkspace(toClone);
  }

  const confirm = await inquirer.prompt([
    {
      name: 'confirm',
      message: 'Local changes will be overwritten by the cloning.',
      type: 'confirm',
    },
  ]);

  if (confirm.confirm) {
    return writeFunctionToWorkspace(toClone);
  }
}

type UpsyncCliOptions = {
  choose?: boolean;
};

export async function upsyncModelFunction(options: UpsyncCliOptions) {
  const { choose } = options || {};

  const spinner = ora('Getting token').start();
  await refreshToken();
  spinner.text = 'Loading functions';
  const functions = await getModelFunctions();
  let localModels = listLocalModelFunctions();
  spinner.stop();

  if (choose) {
    const choice = await inquirer.prompt([
      {
        name: 'choice',
        type: 'search',
        message: 'Choose fuction to upsync',
        source: (input: any) => {
          const baseChoices: { name: string; value: number }[] =
            localModels.reduce(
              (acc: { name: string; value: number }[], current) => {
                return [
                  ...acc,
                  ...current.functions.map((fn) => ({
                    name: `${current.model} / ${fn.name}`,
                    value: fn.id,
                  })),
                ];
              },
              [],
            );
          if (!input) {
            return baseChoices;
          }
          const pat = new RegExp(input, 'i');
          return baseChoices.filter((fn) => pat.test(fn.name));
        },
      },
    ]);
    localModels = localModels
      .filter((cf) => cf.functions.some((fn) => fn.id === choice.choice))
      .map((cf) => ({
        ...cf,
        functions: cf.functions.filter((fn) => fn.id === choice.choice),
      }));
  }

  const operations = computeUpsyncOperations(localModels, functions);

  if (operations.filter((o) => o.write).length === 0) {
    throw new NothingToSync();
  }

  const answer = await inquirer.prompt([
    {
      name: 'confirm',
      type: 'confirm',
      message: [
        'Summary of operations:',
        ...operations
          .filter((op) => op.write)
          .map((op) => `- ${op.operation} ${op.name}`),
      ].join('\n'),
    },
  ]);

  if (answer.confirm) {
    takeBackup('PRE UPSYNC', functions);
    spinner.text = 'Performing upsync';
    spinner.start();
    await performUpsync(operations);
    spinner.stop();
  }
}

type RefreshCliOptions = {
  choose?: boolean;
};

export async function refreshModelFunctions(options: RefreshCliOptions) {
  const { choose } = options || {};

  const spinner = ora('Getting token').start();
  await refreshToken();
  spinner.text = 'Loading functions';
  const functions = await getModelFunctions();
  let localModels = listLocalModelFunctions();
  spinner.stop();

  if (choose) {
    const choice = await inquirer.prompt([
      {
        name: 'choice',
        type: 'search',
        message: 'Choose fuction to upsync',
        source: (input: any) => {
          const baseChoices: { name: string; value: number }[] =
            localModels.reduce(
              (acc: { name: string; value: number }[], current) => {
                return [
                  ...acc,
                  ...current.functions.map((fn) => ({
                    name: `${current.model} / ${fn.name}`,
                    value: fn.id,
                  })),
                ];
              },
              [],
            );
          if (!input) {
            return baseChoices;
          }
          const pat = new RegExp(input, 'i');
          return baseChoices.filter((fn) => pat.test(fn.name));
        },
      },
    ]);
    localModels = localModels
      .filter((cf) => cf.functions.some((fn) => fn.id === choice.choice))
      .map((cf) => ({
        ...cf,
        functions: cf.functions.filter((fn) => fn.id === choice.choice),
      }));
  }

  const flag = await inquirer.prompt([
    {
      name: 'accept',
      type: 'confirm',
      message: 'Local version will be overwritten',
    },
  ]);

  if (!flag.accept) {
    return;
  }

  localModels.forEach((model) => {
    model.functions.forEach((fn) => {
      const remote = functions.find((rfn) => rfn.id === fn.id);
      if (!remote) {
        throw new RemoteResourceNotFound(fn.name);
      }
      writeFunctionToWorkspace(remote);
    });
  });
}
