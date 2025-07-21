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

export class LocalResourceNotFound extends Error {
  constructor(slug: string) {
    const msg = `Could not find local resource "${slug}".`;
    super(msg);
  }
}

export class RemoteResourceNotFound extends Error {
  constructor(slug: string) {
    const msg = `Could not find remote resource "${slug}".`;
    super(msg);
  }
}

export class NothingToSync extends Error {
  constructor() {
    super('Nothing to sync');
  }
}

export class UpsyncFailure extends Error {
  constructor(resource: string, reason = 'unknown') {
    super(`Failed to upsync resource ${resource}: ${reason}`);
  }
}
