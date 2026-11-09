import { z } from 'zod';

const id = z.string().min(1);
const point = z.object({ x: z.number().finite(), y: z.number().finite() });
export const kinds = ['blank', 'person', 'event', 'place', 'group'] as const;
export type Kind = typeof kinds[number];
export const kindLabels: Record<Kind, string> = { blank: '自由节点', person: '人物', event: '事件', place: '地点', group: '组织' };
const fieldSchema = z.object({ id, label: z.string(), value: z.string(), role: z.literal('time').optional() });
const entrySchema = z.object({ id, eventId: id.optional(), title: z.string(), time: z.string(), description: z.string() });
const cardSchema = z.object({ kind: z.enum(kinds), title: z.string(), fields: z.array(fieldSchema), images: z.array(id), coverId: id.optional() });
const timelineSchema = z.object({ kind: z.literal('timeline'), title: z.string(), entries: z.array(entrySchema) });
export const nodeSchema = z.object({ id, position: point, width: z.number().finite().min(400).max(4000).optional(), data: z.discriminatedUnion('kind', [cardSchema, timelineSchema]) });
export const boardSchema = z.object({
  id, title: z.string(), categoryId: id.nullable(), nodes: z.array(nodeSchema),
  edges: z.array(z.object({ id, source: id, target: id, sourceHandle: z.string().nullable().optional(), targetHandle: z.string().nullable().optional(), label: z.string(), directed: z.boolean() })),
  viewport: point.extend({ zoom: z.number().finite().min(0.1).max(2) }),
});
export const workspaceSchema = z.object({
  version: z.literal(1), activeBoardId: id,
  categories: z.array(z.object({ id, title: z.string() })),
  boards: z.array(boardSchema).min(1),
});
export type Field = z.infer<typeof fieldSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type CardData = z.infer<typeof cardSchema>;
export type TimelineData = z.infer<typeof timelineSchema>;
export type CanvasNode = z.infer<typeof nodeSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type Asset = { id: string; name: string; blob: Blob };
export const uid = () => crypto.randomUUID();
export function newBoard(title = '未命名画布', categoryId: string | null = null): Board {
  return { id: uid(), title, categoryId, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}
export function newWorkspace(): Workspace {
  const board = newBoard('我的世界');
  return { version: 1, activeBoardId: board.id, categories: [], boards: [board] };
}
const templates: Record<Kind, string[]> = {
  blank: ['笔记'], person: ['姓名', '身份', '性别', '年龄', '经历'],
  event: ['时间', '地点', '人物', '过程'], place: ['位置', '特征', '历史'], group: ['性质', '成员', '目标', '历史'],
};
export function newNode(kind: Kind | 'timeline', position = { x: 120, y: 120 }): CanvasNode {
  return kind === 'timeline'
    ? { id: uid(), position, width: 720, data: { kind, title: '新的时间轴', entries: [] } }
    : { id: uid(), position, data: { kind, title: kind === 'blank' ? '新的想法' : `未命名${kindLabels[kind]}`, images: [], fields: templates[kind].map(label => ({ id: uid(), label, value: '', ...(kind === 'event' && label === '时间' ? { role: 'time' as const } : {}) })) } };
}
export function resolvedEntry(entry: Entry, board: Board): Entry {
  const event = board.nodes.find(n => n.id === entry.eventId && n.data.kind === 'event');
  if (!event || event.data.kind === 'timeline') return entry;
  return { ...entry, title: event.data.title, time: event.data.fields.find(f => f.role === 'time')?.value ?? '' };
}
export function removeNodes(board: Board, ids: Set<string>): Board {
  return { ...board,
    edges: board.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)),
    nodes: board.nodes.filter(n => !ids.has(n.id)).map(n => n.data.kind !== 'timeline' ? n : {
      ...n, data: { ...n.data, entries: n.data.entries.map(e => {
        if (!e.eventId || !ids.has(e.eventId)) return e;
        const { eventId: _, ...snapshot } = resolvedEntry(e, board);
        return snapshot;
      }) },
    }),
  };
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const copy = [...items]; const [item] = copy.splice(from, 1); copy.splice(to, 0, item); return copy;
}
export function referencedAssetIds(workspace: Workspace): Set<string> {
  return new Set(workspace.boards.flatMap(b => b.nodes.flatMap(n => n.data.kind === 'timeline' ? [] : n.data.images)));
}
export function validateWorkspace(input: unknown, assetIds: Set<string>): Workspace {
  const workspace = workspaceSchema.parse(input);
  const unique = (ids: string[]) => { if (new Set(ids).size !== ids.length) throw new Error('备份包含重复 ID'); };
  unique(workspace.categories.map(c => c.id)); unique(workspace.boards.map(b => b.id));
  if (!workspace.boards.some(b => b.id === workspace.activeBoardId)) throw new Error('当前画布不存在');
  for (const board of workspace.boards) {
    if (board.categoryId && !workspace.categories.some(c => c.id === board.categoryId)) throw new Error('画布分类不存在');
    unique(board.nodes.map(n => n.id)); unique(board.edges.map(e => e.id));
    for (const edge of board.edges) {
      if (![edge.source, edge.target].every(id => board.nodes.some(n => n.id === id && n.data.kind !== 'timeline'))) throw new Error('关系引用了不存在的节点');
    }
    for (const node of board.nodes) {
      if (node.data.kind === 'timeline') {
        unique(node.data.entries.map(e => e.id));
        for (const e of node.data.entries) if (e.eventId && !board.nodes.some(n => n.id === e.eventId && n.data.kind === 'event')) throw new Error('时间轴引用了不存在的事件');
      } else {
        unique(node.data.fields.map(f => f.id)); unique(node.data.images);
        if (node.data.images.some(id => !assetIds.has(id))) throw new Error('备份缺少图片');
        if (node.data.coverId && !node.data.images.includes(node.data.coverId)) throw new Error('封面图片不存在');
        if (node.data.fields.filter(f => f.role === 'time').length > 1) throw new Error('事件包含多个时间字段');
      }
    }
  }
  return workspace;
}
