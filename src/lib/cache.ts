import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';

class SimpleCache {
  cachePath: string;
  ttl: number;
  cache: any;
  constructor(ttl = 300) {
    // Default TTL: 5 minutes in milliseconds
    this.cachePath = path.join('.', '.cache');
    this.ttl = ttl;
  }

  get(key: string) {
    try {
      const allCache = fs.readFileSync(this.cachePath).toString('utf-8');
      const { value, ts } = JSON.parse(allCache)[key];
      if (dayjs(ts) > dayjs().add(this.ttl, 'seconds')) {
        this.set(key, null);
        return undefined;
      }
      return value;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: any) {
    const ts = dayjs().toISOString();
    try {
      const allCache = fs.readFileSync(this.cachePath).toString('utf-8');
      const parsed = JSON.parse(allCache);
      parsed[key] = { value, ts };
      fs.writeFileSync(this.cachePath, JSON.stringify(parsed, null, 2));
    } catch {
      fs.writeFileSync(
        this.cachePath,
        JSON.stringify({ key: { value, ts } }, null, 2),
      );
    }
  }
}

export default SimpleCache;
