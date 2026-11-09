import { useSyncExternalStore } from 'react';
import { type Asset, type Board, type CanvasNode, type Workspace, newWorkspace, uid, removeNodes } from './model';
import { Repository, SaveQueue } from './storage';

export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error';
type State = { workspace: Workspace; ready: boolean; status: SaveStatus; error: string; canUndo: boolean; canRedo: boolean; session: number };
export class StudioStore {
  private state: State = { workspace: newWorkspace(), ready: false, status: 'loading', error: '', canUndo: false, canRedo: false, session: 0 };
  private listeners = new Set<() => void>();
  private assets = new Map<string, Asset>();
  private urls = new Map<string, string>();
  private queue = new SaveQueue();
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private savedRevision = -1;
  private past: Board[] = [];
  private future: Board[] = [];
  private lastEdit = { key: '', time: 0 };
  private gesture?: Board;
  constructor(private repository = new Repository()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  get board() { return this.state.workspace.boards.find(b => b.id === this.state.workspace.activeBoardId)!; }
  get allAssets() { return [...this.assets.values()]; }
  private emit(patch: Partial<State> = {}) {
    this.state = { ...this.state, ...patch, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
    this.listeners.forEach(l => l());
  }
  async initialize() {
    try {
      const loaded = await this.repository.load();
      this.assets = new Map(loaded.assets.map(a => [a.id, a]));
      this.savedRevision = loaded.workspace ? this.revision : -1;
      this.emit({ workspace: loaded.workspace ?? this.state.workspace, ready: true, status: 'saved', error: '' });
      if (!loaded.workspace) await this.flush();
    } catch (error) { this.emit({ status: 'error', error: `无法读取本地资料：${String(error)}` }); }
  }
  private changed(workspace: Workspace, save = true) {
    this.revision++;
    this.emit({ workspace, status: 'saving', error: '' });
    clearTimeout(this.timer);
    if (save) this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 450);
  }
  updateWorkspace(change: (workspace: Workspace) => Workspace) { this.changed(change(this.state.workspace)); }
  updateBoard(change: (board: Board) => Board, key = '', record = true, boardId = this.board.id) {
    const board = this.state.workspace.boards.find(b => b.id === boardId);
    if (!board) return;
    const updated = change(board);
    if (updated === board) return;
    if (record && !this.gesture && boardId === this.board.id) {
      if (!key || this.lastEdit.key !== key || Date.now() - this.lastEdit.time > 900) this.pushHistory(board);
      this.lastEdit = { key, time: Date.now() };
      this.future = [];
    }
    this.changed({ ...this.state.workspace, boards: this.state.workspace.boards.map(b => b.id === boardId ? updated : b) }, !this.gesture);
  }
  updateNode(id: string, change: (node: CanvasNode) => CanvasNode, key = '', boardId = this.board.id) {
    this.updateBoard(b => ({ ...b, nodes: b.nodes.map(n => n.id === id ? change(n) : n) }), key, true, boardId);
  }
  private pushHistory(board: Board) { this.past.push(structuredClone(board)); if (this.past.length > 80) this.past.shift(); }
  beginGesture() { this.gesture ??= structuredClone(this.board); this.lastEdit.key = ''; }
  endGesture() {
    if (this.gesture && JSON.stringify(this.gesture) !== JSON.stringify(this.board)) { this.pushHistory(this.gesture); this.future = []; }
    this.gesture = undefined;
    this.emit();
    void this.flush().catch(() => {});
  }
  undo() {
    const board = this.past.pop(); if (!board) return;
    this.future.push(structuredClone(this.board)); this.lastEdit.key = '';
    this.replaceCurrentBoard({ ...board, title: this.board.title, categoryId: this.board.categoryId, viewport: this.board.viewport });
  }
  redo() {
    const board = this.future.pop(); if (!board) return;
    this.past.push(structuredClone(this.board)); this.lastEdit.key = '';
    this.replaceCurrentBoard({ ...board, title: this.board.title, categoryId: this.board.categoryId, viewport: this.board.viewport });
  }
  private replaceCurrentBoard(board: Board) { this.changed({ ...this.state.workspace, boards: this.state.workspace.boards.map(b => b.id === board.id ? board : b) }); }
  deleteSelection(nodeIds: string[], edgeIds: string[]) {
    this.updateBoard(b => ({ ...removeNodes(b, new Set(nodeIds)), edges: b.edges.filter(e => !edgeIds.includes(e.id) && !nodeIds.includes(e.source) && !nodeIds.includes(e.target)) }));
  }
  duplicateNode(id: string): string | undefined {
    const original = this.board.nodes.find(n => n.id === id); if (!original) return;
    const node = structuredClone(original); node.id = uid(); node.data.title += ' · 副本';
    node.position = { x: node.position.x + 40, y: node.position.y + 40 };
    if (node.data.kind === 'timeline') node.data.entries.forEach(e => { e.id = uid(); });
    else node.data.fields.forEach(f => { f.id = uid(); });
    this.updateBoard(b => ({ ...b, nodes: [...b.nodes, node] })); return node.id;
  }
  async switchBoard(id: string) {
    if (!this.state.workspace.boards.some(b => b.id === id) || id === this.board.id) return;
    await this.flush();
    this.past = []; this.future = []; this.lastEdit.key = ''; this.gesture = undefined;
    this.updateWorkspace(w => ({ ...w, activeBoardId: id }));
  }
  resetHistory() { this.past = []; this.future = []; this.gesture = undefined; this.lastEdit.key = ''; this.emit(); }
  putAssets(assets: Asset[]) { assets.forEach(a => this.assets.set(a.id, a)); }
  assetName(id: string) { return this.assets.get(id)?.name ?? '图片'; }
  assetUrl(id: string) {
    const asset = this.assets.get(id); if (!asset) return '';
    let url = this.urls.get(id);
    if (!url) { url = URL.createObjectURL(asset.blob); this.urls.set(id, url); }
    return url;
  }
  get isDirty() { return this.savedRevision < this.revision; }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.state.ready || !this.isDirty) return Promise.resolve();
    const revision = this.revision;
    const workspace = structuredClone(this.state.workspace);
    const assets = this.allAssets;
    return this.queue.enqueue(async () => {
      if (revision <= this.savedRevision) return;
      try {
        await this.repository.save(workspace, assets);
        this.savedRevision = revision;
        if (revision === this.revision) this.emit({ status: 'saved', error: '' });
      } catch (error) {
        this.emit({ status: 'error', error: `保存失败，请检查磁盘空间或导出备份。${String(error)}` });
        throw error;
      }
    });
  }
  async restore(workspace: Workspace, assets: Asset[]) {
    clearTimeout(this.timer);
    await this.queue.enqueue(() => this.repository.save(workspace, assets, true));
    this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls.clear();
    this.assets = new Map(assets.map(a => [a.id, a]));
    this.past = []; this.future = []; this.lastEdit.key = ''; this.gesture = undefined;
    this.revision++; this.savedRevision = this.revision;
    this.emit({ workspace, status: 'saved', ready: true, error: '', session: this.state.session + 1 });
  }
}
export const studio = new StudioStore();
export const useStudio = () => useSyncExternalStore(studio.subscribe, studio.getSnapshot);
