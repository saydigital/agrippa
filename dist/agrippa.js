#!/usr/bin/env node
import fs, { readFileSync } from 'fs';
import fetch from 'node-fetch';
import dayjs from 'dayjs';
import path from 'path';
import slugify from 'slugify';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import utc from 'dayjs/plugin/utc.js';
import { program } from 'commander';

class ConfigError extends Error {
    constructor(missingFields) {
        const message = `Error while reading configuration: the following parameters are missing: ${missingFields.join(', ')}. Did you initalize the workaspace?`;
        super(message);
    }
}
class ConnectError extends Error {
    constructor(response, text) {
        super(`Failed to load resource at ${response.url}: status code ${response.status} : ${text}`);
    }
}
class LocalWorkflowNotFound extends Error {
    constructor(slug) {
        let msg = `Could not find local workflow "${slug}".`;
        if (slug.endsWith('/')) {
            msg += `Did you mean '${slug.substring(0, -1)}'?`;
        }
        super(msg);
    }
}

const DOTFILE = '.sorge';
const DOTFILE_WF = '.sorge.wf';
function getConfig() {
    try {
        const handle = fs.readFileSync(DOTFILE);
        return JSON.parse(handle.toString('utf-8'));
    }
    catch {
        return {};
    }
}
function updateConfig(update) {
    let config = getConfig();
    config = { ...config, ...update };
    fs.writeFileSync(DOTFILE, JSON.stringify(config, null, 2));
}
function ensureEnv(fields) {
    const config = getConfig();
    const missing = fields.filter((field) => !config[field]);
    if (missing.length > 0) {
        throw new ConfigError(missing);
    }
}

class SimpleCache {
    cachePath;
    ttl;
    cache;
    constructor(ttl = 300) {
        // Default TTL: 5 minutes in milliseconds
        this.cachePath = path.join('.', '.cache');
        this.ttl = ttl;
    }
    get(key) {
        try {
            const allCache = fs.readFileSync(this.cachePath).toString('utf-8');
            const { value, ts } = JSON.parse(allCache)[key];
            if (dayjs(ts) > dayjs().add(this.ttl, 'seconds')) {
                this.set(key, null);
                return undefined;
            }
            return value;
        }
        catch {
            return undefined;
        }
    }
    set(key, value) {
        const ts = dayjs().toISOString();
        try {
            const allCache = fs.readFileSync(this.cachePath).toString('utf-8');
            const parsed = JSON.parse(allCache);
            parsed[key] = { value, ts };
            fs.writeFileSync(this.cachePath, JSON.stringify(parsed, null, 2));
        }
        catch {
            fs.writeFileSync(this.cachePath, JSON.stringify({ key: { value, ts } }, null, 2));
        }
    }
}

const cache = new SimpleCache();
async function getWorkflows() {
    return makeRequest('GET', '/symple.workflow/*', {
        cache: true,
    });
}
async function getPhases(workflowId, { fromCodeOnly } = {}) {
    const phases = await makeRequest('GET', `/symple.triplet.phase/*?_filter_=[('workflow_id', '=', ${workflowId})]`);
    if (fromCodeOnly) {
        return phases.filter((phase) => phase.set_result_automatically === 'from_code');
    }
    return phases;
}
function updatePhase(id, body) {
    return makeRequest('PUT', `/symple.triplet.phase/${id}`, { body });
}
async function makeRequest(method, path, args = {}) {
    const { body, cache: doCache } = args;
    const cacheKey = path;
    if (doCache) {
        const cachedValue = await cache.get(cacheKey);
        if (cachedValue) {
            return cachedValue;
        }
    }
    ensureEnv(['authToken', 'odooRipBaseUrl']);
    const { authToken, odooRipBaseUrl } = getConfig();
    const headers = {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
    };
    const res = await fetch(`${odooRipBaseUrl}${path}`, {
        method,
        headers,
        body: body && JSON.stringify(body),
    });
    if (res.status === 200) {
        const json = await res.json();
        if (doCache) {
            cache.set(cacheKey, json);
        }
        return json;
    }
    else {
        throw new ConnectError(res, await res.text());
    }
}

async function getToken() {
    ensureEnv([
        'keycloakUrl',
        'keycloakPassword',
        'keycloakUser',
        'keycloakClientId',
        'keycloakClientSecret',
    ]);
    const { keycloakPassword, keycloakUser, keycloakUrl, keycloakClientId, keycloakClientSecret, } = getConfig();
    const response = await fetch(keycloakUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeQs({
            username: keycloakUser,
            password: keycloakPassword,
            client_id: keycloakClientId,
            client_secret: keycloakClientSecret,
            grant_type: 'password',
        }),
    });
    if (response.status === 200) {
        const json = (await response.json());
        return json.access_token;
    }
    else {
        throw new ConnectError(response, await response.text());
    }
}
async function refreshToken() {
    const token = await getToken();
    updateConfig({
        authToken: token,
    });
}
function encodeQs(body) {
    const searchParams = new URLSearchParams();
    Object.entries(body).forEach(([key, value]) => {
        searchParams.append(key, value);
    });
    return searchParams.toString();
}

function toSlug(str) {
    return slugify(str, {
        lower: true,
        trim: true,
        replacement: '-',
    });
}
function isWorkflowTracked(slug) {
    try {
        getWorkflowConfig(slug);
        return true;
    }
    catch {
        return false;
    }
}
function getWorkflowPaths(slug) {
    const dirPath = path.join('.', slug);
    const dotfilePath = path.join('.', dirPath, DOTFILE_WF);
    return { dirPath, dotfilePath };
}
function getWorkflowDirectoryMetaData(workflowName) {
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
function computeChangedPhases(slug, newPhases) {
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
function getWorkflowConfig(slug) {
    const { dotfilePath } = getWorkflowPaths(slug);
    const handle = readFileSync(dotfilePath);
    const config = JSON.parse(handle.toString('utf-8'));
    return config;
}
function writeWorkflowConfig(slug, config) {
    const { dotfilePath } = getWorkflowPaths(slug);
    fs.writeFileSync(dotfilePath, JSON.stringify(config, null, 2));
}
function generateWorkflowDir(slug, wf, phases, { preserveBackups } = {}) {
    const { dirPath, dotfilePath } = getWorkflowPaths(slug);
    const { existsDotFile } = getWorkflowDirectoryMetaData(wf.name);
    let backups = [];
    if (existsDotFile && preserveBackups) {
        const config = getWorkflowConfig(slug);
        backups = config.backups;
    }
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { force: true, recursive: true });
    }
    fs.mkdirSync(dirPath);
    const config = {
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
function listLocalWorkflows() {
    const dirs = fs.readdirSync('.');
    const configs = [];
    for (const slug of dirs) {
        const { dotfilePath } = getWorkflowPaths(slug);
        try {
            if (fs.existsSync(dotfilePath)) {
                configs.push(getWorkflowConfig(slug));
            }
        }
        catch {
            continue;
        }
    }
    return configs;
}

async function cloneWorkflows() {
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
            source: (input) => {
                if (!input) {
                    return workflows.map((wf) => ({ name: wf.name, value: wf.id }));
                }
                const escapedInput = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pat = new RegExp(escapedInput, 'ig');
                return workflows
                    .filter((wf) => pat.test(wf.name))
                    .map((wf) => ({ name: wf.name, value: wf.id }));
            },
        },
    ]);
    const workflowId = answer.workflow;
    const workflow = workflows.find((wf) => wf.id === workflowId);
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

function initWorkspace() {
    const config = getConfig();
    return inquirer
        .prompt([
        {
            name: 'keycloakUser',
            message: 'Keycloak username',
            type: 'input',
            default: config.keycloakUser || '',
        },
        {
            name: 'keycloakPassword',
            message: 'Keycloak password',
            type: 'input',
            default: config.keycloakPassword || '',
        },
        {
            name: 'keycloakClientId',
            message: 'Keycloak client id',
            type: 'input',
            default: config.keycloakClientId || '',
        },
        {
            name: 'keycloakClientSecret',
            message: 'Keycloak client secret',
            type: 'input',
            default: config.keycloakClientSecret || '',
        },
        {
            name: 'odooRipBaseUrl',
            message: 'Base URL RIP',
            type: 'input',
            default: config.odooRipBaseUrl ||
                'https://odoo.sorgenia-test-02.symple.cloud/rip/v3/api',
        },
        {
            name: 'keycloakUrl',
            message: 'URL keycloak',
            type: 'input',
            default: config.keycloakUrl ||
                'https://login-test.symple.cloud/auth/realms/sorgenia-test-02/protocol/openid-connect/token',
        },
    ])
        .then((answers) => {
        updateConfig(answers);
    })
        .catch(() => { });
}

async function refreshLocalWorkflows(options = {}) {
    const spinner = ora('Getting auth token').start();
    await refreshToken();
    let localWorkflows = listLocalWorkflows();
    if (options.only && isWorkflowTracked(options.only)) {
        localWorkflows = localWorkflows.filter((wf) => wf.slug === options.only);
    }
    spinner.text = 'Downloading phases';
    const phaseMap = {};
    let allChanges = [];
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

async function backupWorkflow$1(workflowSlug, { name, phases } = {}) {
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
async function restoreWorkflowBackup(backup) {
    for (const { id, code } of backup.phases) {
        await updatePhase(id, { code });
    }
}

dayjs.extend(utc);
function computePhaseStatus(slug, newPhases) {
    const { lastSyncAt, phases } = getWorkflowConfig(slug);
    const { dirPath } = getWorkflowPaths(slug);
    const localDate = dayjs.utc(lastSyncAt);
    return phases.map((phase) => {
        const remotePhase = newPhases.find((rp) => rp.id === phase.id);
        if (!remotePhase) {
            return {
                name: phase.name,
                id: phase.id,
                status: 'missing',
            };
        }
        const isStale = dayjs.utc(remotePhase.write_date).isAfter(localDate);
        const isNoop = remotePhase.code.trim() ===
            readFileSync(path.join(dirPath, phase.filename)).toString('utf-8').trim();
        if (isStale) {
            return {
                name: phase.name,
                id: phase.id,
                status: 'stale',
            };
        }
        if (isNoop) {
            return {
                name: phase.name,
                id: phase.id,
                status: 'noop',
            };
        }
        return {
            name: phase.name,
            id: phase.id,
            status: 'safe',
        };
    });
}
async function performUpsync(workflowSlug, phases) {
    const { dirPath } = getWorkflowPaths(workflowSlug);
    const config = getWorkflowConfig(workflowSlug);
    for (const phase of phases) {
        const { id, status } = phase;
        if (status === 'missing' || status === 'noop') {
            continue;
        }
        const { filename } = config.phases.find((p) => p.id === id);
        const code = readFileSync(path.join(dirPath, filename))
            .toString('utf-8')
            .trim();
        await updatePhase(id, { code });
    }
    writeWorkflowConfig(workflowSlug, {
        ...config,
        lastSyncAt: dayjs().toISOString(),
    });
}

async function upsyncLocalWorkflow(options = {}) {
    await refreshToken();
    if (options.all) {
        return doAll(options);
    }
    else {
        return doOne(options, { spin: true, prompt: true });
    }
}
async function doAll(options) {
    const spinner = ora('Computing phases').start();
    const workflows = listLocalWorkflows();
    const reportLines = {
        safe: [],
        missing: [],
        stale: [],
        noop: [],
    };
    const allPhases = {};
    for (const wf of workflows) {
        const phases = await getPhases(wf.id);
        await backupWorkflow$1(wf.slug, { name: 'Pre upsync', phases });
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
        const phases = allPhases[wf.slug];
        await performUpsync(wf.slug, phases);
    }
    spinner.stop();
}
async function doOne(options, { prompt, spin }) {
    const config = await selectWorkflow$1(options);
    const spinner = ora('Getting auth token');
    {
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
    {
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
    {
        spinner.start();
    }
    await backupWorkflow$1(config.slug, { phases, name: 'Pre upsync' });
    spinner.text = 'Syncing';
    await performUpsync(config.slug, phasesWithStatus);
    spinner.stop();
    spinner.text = 'Done';
}
async function selectWorkflow$1(options) {
    if (options.workflow) {
        if (isWorkflowTracked(options.workflow)) {
            return getWorkflowConfig(options.workflow);
        }
        else {
            throw new LocalWorkflowNotFound(options.workflow);
        }
    }
    const localWorkflows = listLocalWorkflows();
    const answer = await inquirer.prompt([
        {
            name: 'workflow',
            message: 'Select workflow to upsync',
            type: 'search',
            source: (input) => {
                if (!input) {
                    return localWorkflows.map((wf) => ({ name: wf.name, value: wf.id }));
                }
                const escapedInput = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pat = new RegExp(escapedInput, 'ig');
                return localWorkflows
                    .filter((wf) => pat.test(wf.name))
                    .map((wf) => ({ name: wf.name, value: wf.id }));
            },
        },
    ]);
    const config = localWorkflows.find((wf) => wf.id === answer.workflow);
    return config;
}

function backupWorkflow(options = {}) {
    const spinner = ora('Getting auth token').start();
    refreshToken();
    spinner.stop();
    if (options.restore) {
        restoreBackup(options, spinner);
    }
    else {
        takeBackup(options, spinner);
    }
}
async function takeBackup(options, spinner) {
    const config = await selectWorkflow(options);
    spinner.text = 'Taking backup';
    spinner.start();
    await backupWorkflow$1(config.slug, {
        name: options.name || 'Manual backup',
    });
    spinner.stop();
}
async function restoreBackup(options, spinner) {
    const config = await selectWorkflow(options);
    const backups = config.backups;
    const answer = await inquirer.prompt([
        {
            name: 'choice',
            type: 'search',
            message: 'Select backup to restore',
            source: (input) => {
                if (!input) {
                    return backups.map((bck) => ({
                        name: `[${bck.name}] ${fmt(bck.ts)}`,
                        value: bck.ts,
                    }));
                }
                const escapedInput = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const toRestore = backups.find((bck) => bck.ts === answer.choice);
    spinner.text = 'Restoring backup';
    spinner.start();
    await restoreWorkflowBackup(toRestore);
    spinner.stop();
}
async function selectWorkflow(options) {
    if (options.workflow && isWorkflowTracked(options.workflow)) {
        return getWorkflowConfig(options.workflow);
    }
    const locals = listLocalWorkflows();
    const answer = await inquirer.prompt([
        {
            name: 'workflow',
            message: 'Select a workflow to backup',
            type: 'search',
            source: (input) => {
                if (!input) {
                    return locals.map((wf) => ({ name: wf.name, value: wf.slug }));
                }
                const escapedInput = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pat = new RegExp(escapedInput, 'ig');
                return locals
                    .filter((wf) => pat.test(wf.name))
                    .map((wf) => ({ name: wf.name, value: wf.id }));
            },
        },
    ]);
    return getWorkflowConfig(answer.workflow);
}
const fmt = (d) => {
    return dayjs(d).format('D/M/YY HH:mm');
};

var version = "1.0.0";

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
