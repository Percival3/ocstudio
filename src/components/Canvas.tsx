import { createContext, forwardRef, memo, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type Dispatch, type PointerEvent, type SetStateAction } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Handle, Position, NodeResizer, BaseEdge, EdgeLabelRenderer, ConnectionMode, useReactFlow, type Node, type NodeProps, type EdgeProps, type Edge, type NodeChange } from '@xyflow/react';
import { Plus, Minus, Scan, MousePointer2, GitBranch, UserRound, MapPin, CalendarDays, UsersRound, StickyNote, ArrowUpRight, GripVertical, Move, Clock3, Undo2, Redo2 } from 'lucide-react';
import { type Board, type CanvasNode, type Kind, type TimelineData, kindLabels, newNode, resolvedEntry, reorder, uid } from '../model';
import { studio, useStudio } from '../store';
import { renderCanvas } from '../canvasExport';

export const kindIcons = { blank: StickyNote, person: UserRound, event: CalendarDays, place: MapPin, group: UsersRound };
export type Selection = { nodes: string[]; edges: string[] };
type FlowNode = Node<CanvasNode['data'], 'card' | 'timeline'>;
type Point = CanvasNode['position'];
type FlowEdge = Edge<{ offset: number; bend?: Point }, 'relation'>;
type Actions = { board: Board; selectNode: (id: string) => void; selectEdge: (id: string) => void };
const CanvasContext = createContext<Actions>(null!);

const CardNode = memo(function CardNode({ id, data, selected }: NodeProps<FlowNode>) {
  if (data.kind === 'timeline') return null;
  const Icon = kindIcons[data.kind];
  const fields = data.fields.filter(f => f.value.trim()).slice(0, 3);
  const cover = data.coverId ?? data.images[0];
  return <article className={`world-card ${selected ? 'is-selected' : ''}`} data-testid="world-card" data-node-id={id}>
    <div className={`card-type type-${data.kind}`}><Icon size={12} /><span>{kindLabels[data.kind]}</span><span className="card-dots">···</span></div>
    {cover && <div className="card-cover"><img src={studio.assetUrl(cover)} alt={studio.assetName(cover)} draggable={false} /></div>}
    <div className="card-content"><h3>{data.title || '未命名节点'}</h3>
      {fields.length ? <dl>{fields.map(f => <div key={f.id}><dt>{f.label || '字段'}</dt><dd>{f.value}</dd></div>)}</dl> : <p className="card-placeholder">记录一点关于{data.kind === 'blank' ? '这个想法' : `这个${kindLabels[data.kind]}`}的线索…</p>}
    </div>
    {Object.entries({ top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }).map(([key, position]) => <Handle key={key} id={key} position={position} type="source" />)}
  </article>;
});

const TimelineNode = memo(function TimelineNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { board, selectNode } = useContext(CanvasContext);
  const flow = useReactFlow();
  const dragIndex = useRef<number | null>(null);
  if (data.kind !== 'timeline') return null;
  function move(from: number, to: number) { studio.updateNode(id, n => ({ ...n, data: { ...(n.data as TimelineData), entries: reorder((n.data as TimelineData).entries, from, to) } })); }
  function locate(eventId: string) {
    selectNode(eventId); void flow.fitView({ nodes: [{ id: eventId }], duration: 350, maxZoom: 1 });
  }
  return <article className={`timeline-card ${selected ? 'is-selected' : ''}`} data-testid="timeline-card">
    <NodeResizer minWidth={400} maxWidth={4000} minHeight={240} maxHeight={240} isVisible={selected} onResizeStart={() => studio.beginGesture()} onResizeEnd={() => studio.endGesture()} />
    <header className="timeline-drag"><Clock3 size={16} /><h3>{data.title || '未命名时间轴'}</h3><span>{data.entries.length} 个时刻</span><GripVertical size={14} /></header>
    <div className="timeline-scroll nodrag nowheel nopan" onWheel={e => e.stopPropagation()}>
      {data.entries.length ? <div className="timeline-track">{data.entries.map((entry, i) => {
        const resolved = resolvedEntry(entry, board);
        return <div key={entry.id} className="timeline-moment" draggable onDragStart={e => { dragIndex.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', entry.id); }} onDragEnd={() => { dragIndex.current = null; }} onDragOver={e => { if (dragIndex.current !== null) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragIndex.current !== null) move(dragIndex.current, i); dragIndex.current = null; }}>
          <span className="moment-time">{resolved.time || '未定时间'}</span><div className="moment-axis"><i /></div>
          <button className="moment-title" onClick={() => entry.eventId ? locate(entry.eventId) : selectNode(id)}>{resolved.title || '未命名时刻'}{entry.eventId && <ArrowUpRight size={12} />}</button>
          <p>{resolved.description || (entry.eventId ? '关联事件' : '独立记录')}</p>
        </div>;
      })}</div> : <button className="timeline-empty" onClick={() => selectNode(id)}><Plus size={18} /><span>添加第一个时刻</span><small>自由纪年，让历史慢慢展开</small></button>}
    </div>
  </article>;
});

const handleDirection: Record<Position, Point> = {
  [Position.Top]: { x: 0, y: -1 }, [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 }, [Position.Right]: { x: 1, y: 0 },
};
const zeroBend = { x: 0, y: 0 };

function RelationEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, data, label, selected, source, target }: EdgeProps<FlowEdge>) {
  const { board, selectEdge } = useContext(CanvasContext);
  const flow = useReactFlow();
  const drag = useRef<{ pointerId: number; origin: Point; bend: Point } | null>(null);
  const [previewBend, setPreviewBend] = useState<Point>();
  const savedBend = data?.bend ?? zeroBend;
  const bend = previewBend ?? savedBend;
  const dx = targetX - sourceX, dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy);
  const from = handleDirection[sourcePosition], to = handleDirection[targetPosition];
  const reach = source === target ? 140 : Math.min(180, Math.max(42, distance * 0.45));
  const spacing = (data?.offset ?? 0) * (source < target ? 1 : -1);
  const shiftX = (distance ? -dy / distance * spacing : from.x * spacing) + bend.x * 4 / 3;
  const shiftY = (distance ? dx / distance * spacing : from.y * spacing) + bend.y * 4 / 3;
  const spread = distance < 1 ? 100 : 0;
  const c1 = { x: sourceX + from.x * reach - from.y * spread + shiftX, y: sourceY + from.y * reach + from.x * spread + shiftY };
  const c2 = { x: targetX + to.x * reach + to.y * spread + shiftX, y: targetY + to.y * reach - to.x * spread + shiftY };
  const path = `M ${sourceX} ${sourceY} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${targetX} ${targetY}`;
  const lx = (sourceX + 3 * c1.x + 3 * c2.x + targetX) / 8;
  const ly = (sourceY + 3 * c1.y + 3 * c2.y + targetY) / 8;

  function pointerPosition(event: PointerEvent<HTMLButtonElement>) {
    return flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
  }
  function movedBend(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const point = pointerPosition(event);
    return { x: start.bend.x + point.x - start.origin.x, y: start.bend.y + point.y - start.origin.y };
  }
  function finishDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const next = movedBend(event);
    if (!next) return;
    drag.current = null;
    setPreviewBend(undefined);
    if (commit && (next.x !== savedBend.x || next.y !== savedBend.y)) {
      studio.updateBoard(b => ({ ...b, edges: b.edges.map(edge => edge.id === id ? { ...edge, bend: next } : edge) }), '', true, board.id);
    }
  }

  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: selected ? '#477c88' : '#a4afb9', strokeWidth: selected ? 2 : 1.3 }} interactionWidth={24} />
    <EdgeLabelRenderer><div className="edge-label-anchor" style={{ transform: `translate(${lx}px,${ly}px)` }}>
      <button className={`edge-label nodrag nopan ${selected ? 'selected' : ''}`} onClick={e => { e.stopPropagation(); selectEdge(id); }}>{String(label || '关系')}</button>
      {selected && <button type="button" className="edge-bend-handle nodrag nopan" aria-label="拖动调整曲线" title="拖动调整曲线"
        onPointerDown={e => {
          if (e.button !== 0 || drag.current) return;
          e.preventDefault(); e.stopPropagation();
          drag.current = { pointerId: e.pointerId, origin: pointerPosition(e), bend: savedBend };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => { const next = movedBend(e); if (next) setPreviewBend(next); }}
        onPointerUp={e => finishDrag(e, true)} onPointerCancel={e => finishDrag(e, false)}
        onLostPointerCapture={e => finishDrag(e, false)} onClick={e => e.stopPropagation()}><Move size={13} /></button>}
    </div></EdgeLabelRenderer>
  </>;
}
const nodeTypes = { card: CardNode, timeline: TimelineNode };
const edgeTypes = { relation: RelationEdge };
export type CanvasHandle = { create: (kind: Kind | 'timeline') => void; focus: (id: string) => void; capture: () => Promise<HTMLCanvasElement> };
type CanvasProps = { board: Board; selection: Selection; setSelection: Dispatch<SetStateAction<Selection>> };

const InnerCanvas = forwardRef<CanvasHandle, CanvasProps>(function InnerCanvas({ board, selection, setSelection }, ref) {
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const container = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), []);
  const state = useStudio();
  const selectNode = (id: string) => setSelection({ nodes: [id], edges: [] });
  const selectEdge = (id: string) => setSelection({ nodes: [], edges: [id] });
  function create(kind: Kind | 'timeline', position?: { x: number; y: number }) {
    const rect = container.current!.getBoundingClientRect();
    const origin = flow.screenToFlowPosition({ x: rect.left + rect.width / 2 - (kind === 'timeline' ? 300 : 120), y: rect.top + rect.height / 2 - 100 });
    let nextPosition = position ?? origin;
    if (!position) {
      const width = kind === 'timeline' ? 720 : 248, height = kind === 'timeline' ? 240 : 200;
      const occupied = flow.getNodes();
      const candidates = [origin];
      for (let ring = 1; ring <= 20; ring++) {
        for (let x = -ring; x <= ring; x++) for (let y = -ring; y <= ring; y++) {
          if (Math.max(Math.abs(x), Math.abs(y)) === ring) candidates.push({ x: origin.x + x * 300, y: origin.y + y * 300 });
        }
      }
      candidates.sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y));
      nextPosition = candidates.find(p => !occupied.some(n => {
        const w = n.measured?.width ?? 248, h = n.measured?.height ?? 200;
        return p.x < n.position.x + w + 24 && p.x + width + 24 > n.position.x && p.y < n.position.y + h + 24 && p.y + height + 24 > n.position.y;
      })) ?? { x: origin.x, y: origin.y + 6300 };
    }
    const node = newNode(kind, nextPosition);
    studio.updateBoard(b => ({ ...b, nodes: [...b.nodes, node] })); selectNode(node.id);
    clearTimeout(focusTimer.current);
    if (!position) focusTimer.current = setTimeout(() => {
      // Wait for the inspector and ResizeObserver to establish the available canvas size.
      void flow.fitView({ nodes: [{ id: node.id }], padding: 0.15, maxZoom: Math.min(flow.getZoom(), 1), duration: 180 });
    }, 60);
  }
  async function capture() {
    const viewport = container.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport || !board.nodes.length) throw new Error('画布里还没有可导出的内容。');
    setCapturing(true);
    try {
      const deadline = performance.now() + 3000;
      while (performance.now() < deadline && viewport.isConnected) {
        await new Promise(requestAnimationFrame);
        const rendered = [...viewport.querySelectorAll('.react-flow__node')];
        if (rendered.length === board.nodes.length && rendered.every(node => getComputedStyle(node).visibility === 'visible')
          && viewport.querySelectorAll('.react-flow__edge-path').length === board.edges.length) {
          return await renderCanvas(viewport, flow.getZoom());
        }
      }
      throw new Error('画布尚未渲染完成，请重试。');
    } finally {
      setCapturing(false);
    }
  }
  useImperativeHandle(ref, () => ({ create, capture, focus: id => { void flow.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1 }); } }));
  const nodes: FlowNode[] = useMemo(() => board.nodes.map(n => ({
    id: n.id, position: n.position, data: n.data, measured: measurements[n.id], type: n.data.kind === 'timeline' ? 'timeline' : 'card',
    selected: !capturing && selection.nodes.includes(n.id), ...(n.data.kind === 'timeline' ? { style: { width: n.width ?? 720 }, dragHandle: '.timeline-drag' } : {}),
  })), [board.nodes, selection.nodes, measurements, capturing]);
  const edges: FlowEdge[] = useMemo(() => {
    const groups = new Map<string, string[]>();
    board.edges.forEach(e => { const key = [e.source, e.target].sort().join('|'); groups.set(key, [...(groups.get(key) ?? []), e.id]); });
    return board.edges.map(e => {
      const group = groups.get([e.source, e.target].sort().join('|'))!;
      return { ...e, type: 'relation', selected: !capturing && selection.edges.includes(e.id), markerEnd: e.directed ? { type: 'arrowclosed' as const, color: '#a4afb9', width: 18, height: 18 } : undefined, data: { offset: (group.indexOf(e.id) - (group.length - 1) / 2) * 70, bend: e.bend } };
    });
  }, [board.edges, selection.edges, capturing]);
  function changeNodes(changes: NodeChange<FlowNode>[]) {
    const dimensions = changes.filter(c => c.type === 'dimensions');
    if (dimensions.length) setMeasurements(previous => {
      const next = { ...previous }; let changed = false;
      for (const change of dimensions) if (change.dimensions && (next[change.id]?.width !== change.dimensions.width || next[change.id]?.height !== change.dimensions.height)) {
        next[change.id] = change.dimensions; changed = true;
      }
      return changed ? next : previous;
    });
    const selects = changes.filter(c => c.type === 'select');
    if (selects.length) setSelection(s => { const ids = new Set(s.nodes); selects.forEach(c => c.selected ? ids.add(c.id) : ids.delete(c.id)); return { ...s, nodes: [...ids] }; });
    const mutations = changes.filter(c => c.type === 'position' && c.position || c.type === 'dimensions' && c.resizing && c.dimensions);
    if (mutations.length) studio.updateBoard(b => ({ ...b, nodes: b.nodes.map(n => {
      let next = n;
      for (const change of mutations) if ('id' in change && change.id === n.id) {
        if (change.type === 'position' && change.position) next = { ...next, position: change.position };
        if (change.type === 'dimensions' && change.dimensions && n.data.kind === 'timeline') next = { ...next, width: change.dimensions.width };
      }
      return next;
    }) }), '', false);
  }
  return <CanvasContext.Provider value={{ board, selectNode, selectEdge }}><main className="canvas" ref={container} aria-label="世界观画布">
    <ReactFlow<FlowNode, FlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={changeNodes} onEdgesChange={changes => { const selects = changes.filter(c => c.type === 'select'); if (selects.length) setSelection(s => { const ids = new Set(s.edges); selects.forEach(c => c.selected ? ids.add(c.id) : ids.delete(c.id)); return { ...s, edges: [...ids] }; }); }}
      onConnect={connection => { studio.updateBoard(b => ({ ...b, edges: [...b.edges, { ...connection, id: uid(), label: '关系', directed: false }] })); }}
      onNodeDragStart={() => studio.beginGesture()} onNodeDragStop={() => studio.endGesture()}
      onSelectionDragStart={() => studio.beginGesture()} onSelectionDragStop={() => studio.endGesture()}
      onMoveEnd={(_, viewport) => { if (JSON.stringify(viewport) !== JSON.stringify(studio.board.viewport)) studio.updateBoard(b => ({ ...b, viewport }), '', false); }}
      onPaneClick={() => setSelection({ nodes: [], edges: [] })}
      onDoubleClick={e => { if ((e.target as HTMLElement).classList.contains('react-flow__pane')) create('blank', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}
      defaultViewport={board.viewport} minZoom={0.1} maxZoom={2} connectionMode={ConnectionMode.Loose}
      selectionOnDrag panOnDrag={[1, 2]} panActivationKeyCode="Space" multiSelectionKeyCode="Shift" selectionKeyCode="Shift" deleteKeyCode={null} zoomOnDoubleClick={false}
      onlyRenderVisibleElements={!capturing} elevateEdgesOnSelect aria-label="无限画布">
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#dce2e7" />
    </ReactFlow>
    {!board.nodes.length && <div className="canvas-welcome"><div className="welcome-symbol"><div /><div /><div /><GitBranch size={30} strokeWidth={1.1} /></div><span className="eyebrow">EVERY WORLD STARTS WITH A THOUGHT</span><h1>一个世界，从一点想法开始。</h1><p>放下人物、地点与事件，<br />让散落的线索，在这里慢慢相连。</p><button className="primary" onClick={() => create('blank')}><Plus size={15} />创建第一个节点</button><span className="welcome-hint">也可以双击画布任意位置</span></div>}
    <div className="canvas-legend"><MousePointer2 size={13} /><span>拖动框选</span><i /><kbd>空格</kbd><span>平移</span><i /><span>滚轮缩放</span></div>
    <div className="canvas-controls"><button title="撤销 Ctrl+Z" aria-label="撤销" disabled={!state.canUndo} onClick={() => studio.undo()}><Undo2 size={16} /></button><button title="重做 Ctrl+Shift+Z" aria-label="重做" disabled={!state.canRedo} onClick={() => studio.redo()}><Redo2 size={16} /></button><i /><button title="缩小" aria-label="缩小" onClick={() => void flow.zoomOut()}><Minus size={16} /></button><span>{Math.round(board.viewport.zoom * 100)}%</span><button title="放大" aria-label="放大" onClick={() => void flow.zoomIn()}><Plus size={16} /></button><i /><button title="定位全部内容" aria-label="定位全部内容" onClick={() => void flow.fitView({ padding: 0.18, duration: 300, maxZoom: 1 })}><Scan size={16} /></button></div>
    <div className="canvas-counter">{board.nodes.filter(n => n.data.kind !== 'timeline').length} 节点<span>·</span>{board.edges.length} 关系<span>·</span>{board.nodes.filter(n => n.data.kind === 'timeline').length} 时间轴</div>
  </main></CanvasContext.Provider>;
});
export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(props, ref) {
  return <ReactFlowProvider key={props.board.id}><InnerCanvas {...props} ref={ref} /></ReactFlowProvider>;
});
