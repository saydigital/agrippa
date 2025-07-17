#!/usr/bin/env node

import { cloneWorkflows } from '@cli/cloneWorkflows';
import { initWorkspace } from '@cli/initWorkspace';
import { refreshLocalWorkflows } from '@cli/refreshWorkflows';
import { upsyncLocalWorkflow } from '@cli/upsyncWorkflow';
import { backupWorkflow } from '@cli/backupWorkflow';
import { program } from 'commander';
import { version } from '../package.json';

program.name('CLI Fasi').version(version);
program.command('init').action(() => {
  initWorkspace();
});
program.command('clone').action(() => {
  cloneWorkflows();
});
program
  .command('upsync')
  .option('-w, --workflow <slug>')
  .option('-a, --all')
  .option('--report-noop')
  .action((opts) => {
    if (opts.workflow && opts.workflow.endsWith('/')) {
      opts.workflow = opts.workflow.replace(/\/$/, '');
    }

    upsyncLocalWorkflow(opts);
  });

program
  .command('backup')
  .option('-w, --workflow <slug>')
  .option('-r, --restore')
  .option('-n, --name <name>')
  .action((opts) => {
    if (opts.workflow && opts.workflow.endsWith('/')) {
      opts.workflow = opts.workflow.replace(/\/$/, '');
    }
    backupWorkflow(opts);
  });

program
  .command('refresh')
  .option('-o, --only <slug>')
  .action((opts) => {
    if (opts.only && opts.only.endsWith('/')) {
      opts.only = opts.only.replace(/\/$/, '');
    }
    refreshLocalWorkflows(opts);
  });

program.parse();
