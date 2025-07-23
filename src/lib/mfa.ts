import path from 'path';
import { ModelFunctionAccess } from './types';
import fs, { existsSync } from 'fs';
import { LocalResourceNotFound, UpsyncFailure } from './error';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { updateModelFunction } from './api';

dayjs.extend(utc);

export const DOTFILE_MFA = '.sorge.mfa';

export type ModelFunctionAccessBackup = {
  backupName: string;
  ts: string;
  data: {
    id: number;
    code: string;
  };
};

export type ModelFunctionAccessConfig = {
  model: string;
  functions: {
    name: string;
    id: number;
    filename: string;
    lastSyncAt: string;
  }[];
  backups: ModelFunctionAccessBackup[];
};

export type UpsyncOperation = {
  id: number;
  operation: '[NOOP]' | '[SYNC-SAFE]' | '[SYNC-DANGER]' | '[MISSING]';
  write: boolean;
  name: string;
  code: string;
};

export function getIsCloningSafe(
  fn: ModelFunctionAccess,
  config: ModelFunctionAccessConfig | null,
) {
  if (!config) {
    return true;
  }

  const functionConfig = config.functions.find(
    (localFn) => localFn.id === fn.id,
  );
  if (!functionConfig) {
    // Model dir exists but this function was never cloned
    return true;
  }
  const fpath = path.join(config.model, functionConfig.filename);
  if (fs.existsSync(fpath)) {
    return false;
  }
  const code = fs.readFileSync(fpath).toString('utf-8').trim();
  if (code !== fn.code.trim()) {
    return false;
  }
  return true;
}

export function computeUpsyncOperations(
  configs: ModelFunctionAccessConfig[],
  remoteFunctions: ModelFunctionAccess[],
): UpsyncOperation[] {
  return configs.reduce(
    (acc: UpsyncOperation[], config: ModelFunctionAccessConfig) => {
      config.functions.forEach((fn) => {
        const { lastSyncAt } = fn;
        const fpath = path.join(config.model, fn.filename);
        let code: string;

        try {
          code = fs.readFileSync(fpath).toString('utf-8');
        } catch {
          throw new LocalResourceNotFound(fn.name);
        }

        const base = {
          id: fn.id,
          code,
          name: `${config.model} / ${fn.name}`,
        };
        const remote = remoteFunctions.find((rfn) => rfn.id === fn.id);
        if (!remote) {
          acc.push({ ...base, write: false, operation: '[MISSING]' });
          return;
        }

        const isStale = dayjs
          .utc(remote.write_date)
          .isAfter(dayjs.utc(lastSyncAt));

        const isNoop =
          fs
            .readFileSync(path.join(config.model, fn.filename))
            .toString('utf-8')
            .trim() === remote.code.trim();

        if (isNoop) {
          acc.push({
            ...base,
            operation: '[NOOP]',
            write: false,
          });
          return;
        }

        if (isStale) {
          acc.push({
            ...base,
            operation: '[SYNC-DANGER]',
            write: true,
          });
          return;
        }

        acc.push({
          ...base,
          operation: '[SYNC-SAFE]',
          write: true,
        });
      });
      return acc;
    },
    [],
  );
}

export async function performUpsync(operations: UpsyncOperation[]) {
  for (const op of operations) {
    if (op.write) {
      try {
        await updateModelFunction(op.id, op.code);
      } catch (err: any) {
        throw new UpsyncFailure(op.name, err.message);
      }
    }
  }
}

export function takeBackup(name: string, remote: ModelFunctionAccess[]) {
  remote.forEach((fn) => {
    const config = getModelFuncionAccessConfig(fn);
    if (!config) {
      return;
    }
    config.backups.push({
      backupName: name,
      ts: dayjs().toISOString(),
      data: { id: fn.id, code: fn.code.trim() + '\n' },
    });
    updateConfig(config);
  });
}

export function writeFunctionToWorkspace(fn: ModelFunctionAccess) {
  const { model_name, name, code } = fn;
  let config = getModelFuncionAccessConfig(fn);

  if (!config) {
    if (!existsSync(model_name)) {
      fs.mkdirSync(model_name);
    }
    const newConfig = genConfig(fn);
    fs.writeFileSync(
      path.join(model_name, DOTFILE_MFA),
      JSON.stringify(newConfig, null, 2),
    );
    config = newConfig;
  }
  const fpath = path.join(model_name, `${name}.py`);
  fs.writeFileSync(fpath, code.trim() + '\n');
  config = updateConfigFunction(config!, fn);
  updateConfig(config);
}

export function getModelFuncionAccessConfig(
  fn: ModelFunctionAccess,
): ModelFunctionAccessConfig | null {
  const allLocal = listLocalModelFunctions();
  return allLocal.find((config) => config.model === fn.model_name) || null;
}

export function getModelFuncionAccessConfigFromPath(
  p: string,
): ModelFunctionAccessConfig {
  return JSON.parse(
    fs.readFileSync(path.join(p, DOTFILE_MFA)).toString('utf-8'),
  );
}

export function listLocalModelFunctions(): ModelFunctionAccessConfig[] {
  const dirs = fs.readdirSync('.');
  const configs: ModelFunctionAccessConfig[] = [];
  for (const slug of dirs) {
    const dotfilePath = path.join(slug, DOTFILE_MFA);
    try {
      if (fs.existsSync(dotfilePath)) {
        configs.push(getModelFuncionAccessConfigFromPath(slug));
      }
    } catch {
      continue;
    }
  }
  return configs;
}

function genConfig(fn: ModelFunctionAccess): ModelFunctionAccessConfig {
  return {
    model: fn.model_name,
    backups: [],
    functions: [
      {
        id: fn.id,
        name: fn.name,
        filename: `${fn.name}.py`,
        lastSyncAt: dayjs().toISOString(),
      },
    ],
  };
}

function updateConfig(update: ModelFunctionAccessConfig) {
  const fpath = path.join(update.model, DOTFILE_MFA);
  fs.writeFileSync(fpath, JSON.stringify(update, null, 2));
}

function updateConfigFunction(
  config: ModelFunctionAccessConfig,
  fn: ModelFunctionAccess,
): ModelFunctionAccessConfig {
  if (config.functions.find((func) => func.id === fn.id)) {
    config.functions = config.functions.map((func) => {
      if (func.id === fn.id) {
        return {
          name: func.name,
          filename: `${fn.name}.py`,
          id: fn.id,
          lastSyncAt: dayjs().toISOString(),
        };
      }
      return func;
    });
  } else {
    config.functions.push({
      name: fn.name,
      filename: `${fn.name}.py`,
      id: fn.id,
      lastSyncAt: dayjs().toISOString(),
    });
  }
  return config;
}
