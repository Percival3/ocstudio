import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { newWorkspace, newNode, newBoard, removeNodes, resolvedEntry, reorder, uid, validateWorkspace, type TimelineData, type CardData } from './model';
import { exportBackup, parseBackup, Repository, SaveQueue } from './storage';
import { StudioStore } from './store';

function fixture() {
  const workspace = newWorkspace(), board = workspace.boards[0];
  const event = newNode('event'), person = newNode('person'), timeline = newNode('timeline');
  event.data.title = '长夜之战';
  (event.data as CardData).fields[0].value = '第三纪元';
  (timeline.data as TimelineData).entries.push({ id: uid(), eventId: event.id, title: '', time: '', description: '历史从这里分岔' });
  board.nodes.push(event, person, timeline);
  board.edges.push({ id: uid(), source: person.id, target: event.id, label: '参与', directed: false });
  return { workspace, board, event, person, timeline };
}
describe('world model', () => {
  it('keeps referenced event time attached to field identity after rename and reordering', () => {
    const { board, event, timeline } = fixture();
    const card = event.data as CardData;
    card.fields[0].label = '自定义纪年'; card.fields = reorder(card.fields, 0, 3);
    expect(resolvedEntry((timeline.data as TimelineData).entries[0], board)).toMatchObject({ title: '长夜之战', time: '第三纪元' });
    card.fields = card.fields.filter(f => f.role !== 'time');
    expect(resolvedEntry((timeline.data as TimelineData).entries[0], board).time).toBe('');
  });
  it('removes connected edges and snapshots linked events without losing timeline notes', () => {
    const { board, event, timeline } = fixture();
    const removed = removeNodes(board, new Set([event.id]));
    expect(removed.edges).toHaveLength(0);
    const entry = (removed.nodes.find(n => n.id === timeline.id)!.data as TimelineData).entries[0];
    expect(entry).toMatchObject({ title: '长夜之战', time: '第三纪元', description: '历史从这里分岔' });
    expect(entry.eventId).toBeUndefined();
    expect((timeline.data as TimelineData).entries[0].eventId).toBe(event.id);
  });
  it('rejects dangling edges, invalid references and duplicate identities', () => {
    const { workspace, board } = fixture();
    expect(validateWorkspace(workspace, new Set())).toEqual(workspace);
    board.edges[0].target = 'missing';
    expect(() => validateWorkspace(workspace, new Set())).toThrow('关系引用');
    board.edges = []; board.nodes.push(board.nodes[0]);
    expect(() => validateWorkspace(workspace, new Set())).toThrow('重复 ID');
  });
});
describe('backup and transactional storage', () => {
  it('round trips all metadata and original image bytes', async () => {
    const { workspace, person } = fixture();
    const asset = { id: uid(), name: '人物.png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' }) };
    (person.data as CardData).images = [asset.id]; (person.data as CardData).coverId = asset.id;
    const restored = parseBackup(await exportBackup(workspace, [asset]));
    expect(restored.workspace).toEqual(workspace);
    expect(new Uint8Array(await restored.assets[0].blob.arrayBuffer())).toEqual(new Uint8Array(await asset.blob.arrayBuffer()));
    expect(restored.assets[0].name).toBe('人物.png');
  });
  it('rejects invalid versions, missing images and malformed base64 before writes', async () => {
    const { workspace, person } = fixture();
    const backup = JSON.parse(await exportBackup(workspace, []));
    expect(() => parseBackup(JSON.stringify({ ...backup, version: 2 }))).toThrow();
    (backup.workspace.boards[0].nodes.find((n: { id: string }) => n.id === person.id).data as CardData).images = ['lost'];
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('缺少图片');
    backup.assets = [{ id: 'lost', name: 'bad.png', type: 'image/png', base64: '%%%' }];
    expect(() => parseBackup(JSON.stringify(backup))).toThrow('图片数据损坏');
  });
  it('writes workspace and assets atomically, retaining prior data on an aborted replacement', async () => {
    const repo = new Repository(uid()), first = newWorkspace(), replacement = newWorkspace();
    await repo.save(first, []);
    const invalidAsset = { id: uid(), name: 'bad', blob: (() => {}) as unknown as Blob };
    await expect(repo.save(replacement, [invalidAsset], true)).rejects.toThrow();
    expect((await repo.load()).workspace).toEqual(first);
  });
  it('serializes writes and continues after a failed write', async () => {
    const queue = new SaveQueue(), order: number[] = [];
    let release!: () => void;
    const first = queue.enqueue(async () => { await new Promise<void>(resolve => { release = resolve; }); order.push(1); throw Error('failed'); });
    const caught = first.catch(() => {});
    const second = queue.enqueue(async () => { order.push(2); });
    await Promise.resolve(); expect(order).toEqual([]); release();
    await Promise.all([caught, second]); expect(order).toEqual([1, 2]);
  });
});
describe('editing and save state', () => {
  it('undoes deletion including edges and event references, without reverting board metadata', async () => {
    const store = new StudioStore(new Repository(uid())); await store.initialize();
    const { workspace, event, timeline } = fixture(); await store.restore(workspace, []);
    store.deleteSelection([event.id], []);
    store.updateWorkspace(w => ({ ...w, boards: w.boards.map(b => ({ ...b, title: '新名称' })) }));
    expect((store.board.nodes.find(n => n.id === timeline.id)!.data as TimelineData).entries[0].eventId).toBeUndefined();
    store.undo(); expect(store.board.title).toBe('新名称'); expect(store.board.edges).toHaveLength(1);
    expect((store.board.nodes.find(n => n.id === timeline.id)!.data as TimelineData).entries[0].eventId).toBe(event.id);
    store.redo(); expect(store.board.nodes).toHaveLength(2); await store.flush();
  });
  it('groups typing and gestures into undo steps and duplicates independently', async () => {
    const store = new StudioStore(new Repository(uid())); await store.initialize();
    const node = newNode('person'); store.updateBoard(b => ({ ...b, nodes: [node] })); store.resetHistory();
    for (const title of ['A', 'AB', 'ABC']) store.updateNode(node.id, n => ({ ...n, data: { ...n.data, title } }), 'typing');
    store.undo(); expect(store.board.nodes[0].data.title).toBe('未命名人物'); store.redo();
    store.beginGesture();
    for (let i = 0; i < 10; i++) store.updateNode(node.id, n => ({ ...n, position: { x: i, y: i } }));
    store.endGesture(); store.undo(); expect(store.board.nodes[0].position).toEqual(node.position);
    const copy = store.duplicateNode(node.id)!;
    store.updateNode(copy, n => ({ ...n, data: { ...n.data, title: '副本改变' } }));
    expect(store.board.nodes[0].data.title).toBe('ABC'); await store.flush();
  });
  it('flushes rapid edits to the correct canvas and resets undo on switch', async () => {
    const repo = new Repository(uid()), store = new StudioStore(repo); await store.initialize();
    const first = store.board.id, next = newBoard('第二张');
    store.updateWorkspace(w => ({ ...w, boards: [...w.boards, next] }));
    store.updateBoard(b => ({ ...b, nodes: [newNode('person')] }));
    await store.switchBoard(next.id);
    store.updateBoard(b => ({ ...b, nodes: [newNode('event')] })); await store.flush();
    const saved = (await repo.load()).workspace!;
    expect(saved.boards.find(b => b.id === first)!.nodes[0].data.kind).toBe('person');
    expect(saved.boards.find(b => b.id === next.id)!.nodes[0].data.kind).toBe('event');
    store.undo(); expect(store.board.nodes).toHaveLength(0); expect(store.getSnapshot().canUndo).toBe(false); await store.flush();
  });
  it('never reports failed persistence as saved and blocks board switching until retry succeeds', async () => {
    const repo = new Repository(uid()), store = new StudioStore(repo); await store.initialize();
    const next = newBoard('下一张'), original = store.board.id;
    store.updateWorkspace(w => ({ ...w, boards: [...w.boards, next] }));
    const spy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('QuotaExceededError'));
    await expect(store.switchBoard(next.id)).rejects.toThrow();
    expect(store.getSnapshot().status).toBe('error'); expect(store.board.id).toBe(original); expect(store.isDirty).toBe(true);
    spy.mockRestore(); await store.flush(); expect(store.getSnapshot().status).toBe('saved'); expect(store.isDirty).toBe(false);
  });
});
