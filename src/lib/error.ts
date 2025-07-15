import { Response } from 'node-fetch';

export class ConfigError extends Error {
  constructor(missingFields: string[]) {
    const message = `Error while reading configuration: the following parameters are missing: ${missingFields.join(', ')}. Did you initalize the workaspace?`;
    super(message);
  }
}

export class ConnectError extends Error {
  constructor(response: Response, text?: string) {
    super(
      `Failed to load resource at ${response.url}: status code ${response.status} : ${text}`,
    );
  }
}

export class LocalWorkflowNotFound extends Error {
  constructor(slug: string) {
    let msg = `Could not find local workflow "${slug}".`;
    if (slug.endsWith('/')) {
      msg += `Did you mean '${slug.substring(0, -1)}'?`;
    }
    super(msg);
  }
}
