import { b64ToBytes, bytesToB64 } from "./base64";

const MANIFEST_KEY = "vault.manifest";
const MIRROR_KEY = "vault.mirror";
const CHUNK_KEY = /^v(\d+)\.chunk\.\d+$/;

export const MANIFEST_VERSION = 1;
/** chrome.storage.sync allows 8192 bytes per item; leave room for the key name
 *  and JSON quoting. */
export const CHUNK_CHARS = 6144;
/** chrome.storage.sync total budget. */
export const QUOTA_BYTES = 102_400;

export interface VaultManifest {
  version: number;
  revision: number;
  chunks: number;
  salt: string;
  kdfId: number;
}

export interface LoadedVault {
  blob: Uint8Array;
  manifest: VaultManifest;
}

export type SaveResult =
  | { ok: true; manifest: VaultManifest }
  | { ok: false; conflict: LoadedVault };

/** The vault no longer fits in chrome.storage.sync. */
export class VaultQuotaError extends Error {
  constructor() {
    super("This vault no longer fits in Chrome's sync storage (100 KB limit).");
    this.name = "VaultQuotaError";
  }
}

function chunkKey(revision: number, index: number): string {
  return `v${revision}.chunk.${index}`;
}

function split(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  return out.length > 0 ? out : [""];
}

/**
 * Moves the sealed vault blob in and out of chrome.storage as base64 chunks.
 *
 * The manifest is the commit point: chunks for a new generation are written
 * first, then the manifest, then the old generation is deleted. A concurrent
 * reader therefore sees either the old manifest with its intact generation, or
 * the new manifest with its intact generation — never a mix.
 */
export class VaultRepo {
  private readonly area: chrome.storage.StorageArea;

  constructor(private readonly areaName: "sync" | "local" = "sync") {
    this.area = chrome.storage[areaName];
  }

  async hasVault(): Promise<boolean> {
    return (await this.loadManifest()) !== null;
  }

  async loadManifest(): Promise<VaultManifest | null> {
    const got = await this.area.get(MANIFEST_KEY);
    return (got[MANIFEST_KEY] as VaultManifest | undefined) ?? null;
  }

  async load(): Promise<LoadedVault | null> {
    const manifest = await this.loadManifest();
    if (!manifest) return null;

    const keys = Array.from({ length: manifest.chunks }, (_, i) => chunkKey(manifest.revision, i));
    const got = await this.area.get(keys);
    const parts = keys.map((k) => got[k] as string | undefined);

    if (parts.some((p) => p === undefined)) {
      // A torn remote write: the manifest landed before all of its chunks.
      // Serve the last blob we read successfully rather than a corrupt one.
      const mirror = await this.readMirror();
      if (mirror) return mirror;
      throw new Error("Vault data is incomplete and no local copy is available.");
    }

    const loaded = { blob: b64ToBytes(parts.join("")), manifest };
    await this.writeMirror(loaded);
    return loaded;
  }

  async save(
    blob: Uint8Array,
    salt: string,
    kdfId: number,
    baseRevision: number,
  ): Promise<SaveResult> {
    const current = await this.loadManifest();
    if ((current?.revision ?? 0) !== baseRevision) {
      const conflict = await this.load();
      if (conflict) return { ok: false, conflict };
    }

    const revision = (current?.revision ?? 0) + 1;
    const parts = split(bytesToB64(blob));
    const manifest: VaultManifest = {
      version: MANIFEST_VERSION,
      revision,
      chunks: parts.length,
      salt,
      kdfId,
    };

    const items: Record<string, string> = {};
    parts.forEach((part, i) => {
      items[chunkKey(revision, i)] = part;
    });

    if (this.areaName === "sync" && this.estimateBytes(items, manifest) > QUOTA_BYTES) {
      throw new VaultQuotaError();
    }

    // Reclaim chunks belonging to no live generation before measuring ourselves
    // against the budget: an earlier write killed between its chunks and its
    // manifest would otherwise eat the quota permanently.
    await this.sweepOrphans(current?.revision ?? null, revision);

    try {
      await this.area.set(items); // chunks first...
      await this.area.set({ [MANIFEST_KEY]: manifest }); // ...manifest commits.
    } catch (err) {
      // The manifest never moved, so the old generation is still the live one.
      // Drop whatever part of the new one landed — a multi-item set is not
      // atomic, and leaving it behind shrinks the budget for every retry.
      await this.area.remove(Object.keys(items)).catch(() => {});
      if (String(err).includes("QUOTA_BYTES")) throw new VaultQuotaError();
      throw err;
    }

    if (current) {
      await this.area.remove(
        Array.from({ length: current.chunks }, (_, i) => chunkKey(current.revision, i)),
      );
    }
    await this.writeMirror({ blob, manifest });
    return { ok: true, manifest };
  }

  /** Rough size of what this write will occupy, including the manifest. */
  private estimateBytes(items: Record<string, string>, manifest: VaultManifest): number {
    const chunkBytes = Object.entries(items).reduce(
      (total, [key, value]) => total + key.length + value.length + 2,
      0,
    );
    return chunkBytes + MANIFEST_KEY.length + JSON.stringify(manifest).length;
  }

  /** Remove chunk keys from any generation that is neither live nor incoming. */
  private async sweepOrphans(liveRevision: number | null, incoming: number): Promise<void> {
    const all = await this.area.get(null);
    const stale = Object.keys(all).filter((key) => {
      const match = CHUNK_KEY.exec(key);
      if (!match) return false;
      const generation = Number(match[1]);
      return generation !== liveRevision && generation !== incoming;
    });
    if (stale.length > 0) await this.area.remove(stale);
  }

  private async readMirror(): Promise<LoadedVault | null> {
    const got = await chrome.storage.local.get(MIRROR_KEY);
    const mirror = got[MIRROR_KEY] as { blob: string; manifest: VaultManifest } | undefined;
    return mirror ? { blob: b64ToBytes(mirror.blob), manifest: mirror.manifest } : null;
  }

  private async writeMirror(loaded: LoadedVault): Promise<void> {
    // Ciphertext only — the mirror is no more sensitive than the sync copy.
    await chrome.storage.local.set({
      [MIRROR_KEY]: { blob: bytesToB64(loaded.blob), manifest: loaded.manifest },
    });
  }
}
