// Minimal in-memory stand-in for the chrome.storage areas the extension uses.
// Enforces the real sync quotas so quota handling is actually exercised.

const SYNC_QUOTA_BYTES = 102_400;
const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;

interface Quota {
  total: number;
  perItem: number;
}

export interface FakeArea {
  data: Record<string, unknown>;
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

function areaSize(data: Record<string, unknown>): number {
  return Object.entries(data).reduce(
    (total, [key, value]) => total + key.length + JSON.stringify(value).length,
    0,
  );
}

function makeArea(quota: Quota | null): FakeArea {
  const area: FakeArea = {
    data: {},
    async get(keys) {
      if (keys === undefined || keys === null) return { ...area.data };
      const list = typeof keys === "string" ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in area.data) out[key] = area.data[key];
      return out;
    },
    async set(items) {
      // Applied item by item, and a failure leaves the earlier items in place.
      // Real sync storage promises no atomicity across a multi-item write, so
      // the double models the worst case the repo has to survive.
      for (const [key, value] of Object.entries(items)) {
        const itemSize = key.length + JSON.stringify(value).length;
        if (quota !== null && itemSize > quota.perItem) {
          throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
        }
        const next = { ...area.data, [key]: value };
        if (quota !== null && areaSize(next) > quota.total) {
          throw new Error("QUOTA_BYTES quota exceeded");
        }
        area.data = next;
      }
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) delete area.data[key];
    },
    async clear() {
      area.data = {};
    },
  };
  return area;
}

export interface FakeAlarms {
  /** Alarm name -> the delay it was last armed with, in minutes. */
  created: Record<string, number>;
  create(name: string, info: { delayInMinutes: number }): void;
  clear(name: string): Promise<boolean>;
}

export interface FakeChrome {
  sync: FakeArea;
  local: FakeArea;
  session: FakeArea;
  alarms: FakeAlarms;
}

/** Install a fake `chrome` global and return its areas for assertions. */
export function installFakeChrome(): FakeChrome {
  const alarms: FakeAlarms = {
    created: {},
    create(name, info) {
      alarms.created[name] = info.delayInMinutes;
    },
    async clear(name) {
      const existed = name in alarms.created;
      delete alarms.created[name];
      return existed;
    },
  };
  const fake: FakeChrome = {
    sync: makeArea({ total: SYNC_QUOTA_BYTES, perItem: SYNC_QUOTA_BYTES_PER_ITEM }),
    local: makeArea(null),
    session: makeArea(null),
    alarms,
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { sync: fake.sync, local: fake.local, session: fake.session },
    alarms,
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  };
  return fake;
}
