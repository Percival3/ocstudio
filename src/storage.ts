import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { type Workspace, type Board, type Asset, referencedAssetIds, validateWorkspace } from './model';

interface StudioDB extends DBSchema {
  workspace: { key: string; value: Workspace };
  assets: { key: string; value: Asset };
}
export class Repository {
  private database?: Promise<IDBPDatabase<StudioDB>>;
  private persisted = new Set<string>();
  constructor(private name = 'oc-studio-v1') {}
  private db() {
    return this.database ??= openDB<StudioDB>(this.name, 1, { upgrade(db) {
      db.createObjectStore('workspace'); db.createObjectStore('assets', { keyPath: 'id' });
    } });
  }
  async load() {
    const db = await this.db();
    const tx = db.transaction(['workspace', 'assets'], 'readonly');
    const [workspace, assets] = await Promise.all([tx.objectStore('workspace').get('current'), tx.objectStore('assets').getAll()]);
    await tx.done;
    this.persisted = new Set(assets.map(a => a.id));
    return { workspace: workspace ? validateWorkspace(workspace, this.persisted) : undefined, assets };
  }
  async save(workspace: Workspace, assets: Asset[], replace = false) {
    const db = await this.db();
    const tx = db.transaction(['workspace', 'assets'], 'readwrite');
    const newAssets = replace ? assets : assets.filter(a => !this.persisted.has(a.id));
    try {
      if (replace) await tx.objectStore('assets').clear();
      await tx.objectStore('workspace').put(workspace, 'current');
      for (const asset of newAssets) await tx.objectStore('assets').put(asset);
      await tx.done;
      if (replace) this.persisted.clear();
      newAssets.forEach(a => this.persisted.add(a.id));
    } catch (error) {
      try { tx.abort(); } catch { /* already aborted */ }
      await tx.done.catch(() => {});
      throw error;
    }
  }
}

export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();
  enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {});
    return next;
  }
}
const backupSchema = z.object({
  format: z.literal('oc-studio'), version: z.literal(1), exportedAt: z.string(), workspace: z.unknown(),
  scope: z.literal('board').optional(),
  assets: z.array(z.object({ id: z.string().min(1), name: z.string(), type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']), base64: z.string() })),
});
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export async function exportBackup(workspace: Workspace, assets: Asset[], scope?: 'board'): Promise<string> {
  const ids = referencedAssetIds(workspace);
  const embedded = await Promise.all(assets.filter(a => ids.has(a.id)).map(async a => {
    const bytes = new Uint8Array(await a.blob.arrayBuffer());
    let binary = '';
    for (let start = 0; start < bytes.length; start += 32768) binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    return { id: a.id, name: a.name, type: a.blob.type, base64: btoa(binary) };
  }));
  validateWorkspace(workspace, new Set(embedded.map(a => a.id)));
  return JSON.stringify({ format: 'oc-studio', version: 1, scope, exportedAt: new Date().toISOString(), workspace, assets: embedded });
}

export function exportBoardFile(board: Board, assets: Asset[]) {
  return exportBackup({ version: 1, activeBoardId: board.id, boards: [{ ...board, categoryId: null }], categories: [] }, assets, 'board');
}

export function parseBackup(text: string): { workspace: Workspace; assets: Asset[]; scope?: 'board' } {
  const data = backupSchema.parse(JSON.parse(text));
  const ids = new Set(data.assets.map(a => a.id));
  if (ids.size !== data.assets.length) throw new Error('备份包含重复图片 ID');
  const assets = data.assets.map(a => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.base64) || !a.base64) throw new Error('图片数据损坏');
    const bytes = Uint8Array.from(atob(a.base64), c => c.charCodeAt(0));
    return { id: a.id, name: a.name, blob: new Blob([bytes], { type: a.type }) };
  });
  const workspace = validateWorkspace(data.workspace, ids);
  if (data.scope === 'board' && workspace.boards.length !== 1) throw new Error('画布文件应包含一张画布');
  return { workspace, assets, scope: data.scope };
}
