import { useRef, useState } from 'react';
import { X, Copy, Trash2, Plus, ArrowUp, ArrowDown, ImagePlus, Star, ArrowUpRight, GripVertical, Clock3 } from 'lucide-react';
import { type Board, type CanvasNode, type CardData, type TimelineData, type Entry, type Field, kindLabels, reorder, resolvedEntry, uid } from '../model';
import { studio } from '../store';
import { imageTypes } from '../storage';
import { kindIcons } from './Canvas';

type Props = {
  board: Board; node?: CanvasNode; edge?: Board['edges'][number];
  close: () => void; select: (id: string) => void; notify: (message: string) => void; preview: (url: string, name: string) => void;
};
export function Inspector({ board, node, edge, close, select, notify, preview }: Props) {
  const [uploading, setUploading] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const dragEntry = useRef<number | null>(null);
  if (!node && !edge) return null;
  const card = node?.data.kind !== 'timeline' ? node?.data as CardData | undefined : undefined;
  const timeline = node?.data.kind === 'timeline' ? node.data : undefined;
  const Icon = card ? kindIcons[card.kind] : Clock3;
  const title = card ? kindLabels[card.kind] : timeline ? '时间轴' : '关系';
  function updateCard(change: (data: CardData) => CardData, key = '') { studio.updateNode(node!.id, n => ({ ...n, data: change(n.data as CardData) }), key); }
  function updateTimeline(change: (data: TimelineData) => TimelineData, key = '') { studio.updateNode(node!.id, n => ({ ...n, data: change(n.data as TimelineData) }), key); }
  function updateEntry(id: string, change: Partial<Entry>, key = '') { updateTimeline(t => ({ ...t, entries: t.entries.map(e => e.id === id ? { ...e, ...change } : e) }), key); }
  function updateField(id: string, change: Partial<Field>, key: string) { updateCard(c => ({ ...c, fields: c.fields.map(f => f.id === id ? { ...f, ...change } : f) }), key); }
  async function uploadImages(files: FileList | null) {
    if (!files?.length || !node) return;
    const targetBoardId = board.id, targetNodeId = node.id;
    setUploading(true);
    try {
      const assets = await Promise.all([...files].map(async file => {
        if (!imageTypes.includes(file.type)) throw new Error('请使用 PNG、JPG、WebP、GIF 或 AVIF 图片。');
        if (file.size > 20 * 1024 * 1024) throw new Error('单张图片需小于 20 MB。');
        try { const bitmap = await createImageBitmap(file); bitmap.close(); }
        catch { throw new Error(`无法读取图片「${file.name}」，文件可能已损坏。`); }
        return { id: uid(), name: file.name, blob: file };
      }));
      studio.putAssets(assets);
      studio.updateNode(targetNodeId, n => {
        if (n.data.kind === 'timeline') return n;
        return { ...n, data: { ...n.data, images: [...n.data.images, ...assets.map(a => a.id)], coverId: n.data.coverId ?? n.data.images[0] ?? assets[0].id } };
      }, '', targetBoardId);
    } catch (error) { notify(error instanceof Error ? error.message : '图片读取失败，请重试。'); }
    finally { setUploading(false); if (upload.current) upload.current.value = ''; }
  }
  return <aside className="inspector" aria-label="属性编辑">
    <div className="inspector-heading"><span><Icon size={15} />{title}属性</span><button className="icon-button" title="收起属性" aria-label="收起属性" onClick={close}><X size={16} /></button></div>
    <div className="inspector-body">
      <div className="section-label">{edge ? 'RELATIONSHIP' : timeline ? 'TIMELINE' : 'DETAILS'}</div>
      <label className="input-label">{edge ? '关系名称' : '名称'}<input className="title-input" aria-label={edge ? '关系名称' : '节点名称'} value={node?.data.title ?? edge?.label ?? ''} placeholder="未命名" onChange={e => {
        const value = e.target.value;
        if (node) studio.updateNode(node.id, n => ({ ...n, data: { ...n.data, title: value } }), `title-${node.id}`);
        else studio.updateBoard(b => ({ ...b, edges: b.edges.map(item => item.id === edge!.id ? { ...item, label: value } : item) }), `edge-${edge!.id}`);
      }} /></label>
      {edge && <><label className="input-label">方向<select aria-label="关系方向" value={edge.directed ? 'directed' : 'none'} onChange={e => studio.updateBoard(b => ({ ...b, edges: b.edges.map(item => item.id === edge.id ? { ...item, directed: e.target.value === 'directed' } : item) }))}><option value="none">无箭头</option><option value="directed">单向箭头</option></select></label><div className="relation-endpoints">{[edge.source, edge.target].map((id, i) => <div key={`${id}-${i}`}><span>{i ? '连接至' : '从'}</span><button onClick={() => select(id)}>{board.nodes.find(n => n.id === id)?.data.title || '未命名节点'}<ArrowUpRight size={13} /></button></div>)}</div><p className="help-text">关系从起点指向终点。可在同一对节点间绘制多条连线，表达不同关系。</p></>}
      {card && <>
        <section className="inspector-section"><div className="section-heading"><h3>图像</h3><span>{card.images.length || '可选'}</span></div>
          <input ref={upload} type="file" accept={imageTypes.join(',')} multiple hidden aria-label="上传图片" onChange={e => void uploadImages(e.target.files)} />
          {card.images.length > 0 && <div className="image-grid">{card.images.map(id => <div className="image-tile" key={id}>
            <button className="image-preview" aria-label={`预览 ${studio.assetName(id)}`} onClick={() => preview(studio.assetUrl(id), studio.assetName(id))}><img src={studio.assetUrl(id)} alt={studio.assetName(id)} /></button>
            <div className="image-actions"><button title="设为封面" aria-label={`设为封面 ${studio.assetName(id)}`} className={(card.coverId ?? card.images[0]) === id ? 'active' : ''} onClick={() => updateCard(c => ({ ...c, coverId: id }))}><Star size={12} /></button><button title="删除图片" aria-label={`删除图片 ${studio.assetName(id)}`} onClick={() => updateCard(c => ({ ...c, images: c.images.filter(imageId => imageId !== id), coverId: c.coverId === id ? c.images.find(imageId => imageId !== id) : c.coverId }))}><X size={12} /></button></div>
          </div>)}</div>}
          <button className="upload-button" disabled={uploading} onClick={() => upload.current?.click()}><ImagePlus size={17} />{uploading ? '正在读取图片…' : '上传图片'}<span>保留原图 · 单张 ≤ 20 MB</span></button>
        </section>
        <section className="inspector-section"><div className="section-heading"><h3>自定义字段</h3><span>{card.fields.length}</span></div>
          {card.kind === 'event' && <label className="input-label compact-label">时间轴使用的时间字段<select aria-label="时间字段" value={card.fields.find(f => f.role === 'time')?.id ?? ''} onChange={e => updateCard(c => ({ ...c, fields: c.fields.map(f => ({ ...f, role: f.id === e.target.value ? 'time' : undefined })) }))}><option value="">不指定</option>{card.fields.map(f => <option key={f.id} value={f.id}>{f.label || '未命名字段'}</option>)}</select></label>}
          <div className="fields">{card.fields.map((field, index) => <div className="field-block" key={field.id}>
            <div className="field-header"><input aria-label={`字段名称 ${index + 1}`} value={field.label} placeholder="字段名称" onChange={e => updateField(field.id, { label: e.target.value }, `field-label-${field.id}`)} /><div className="field-actions"><button aria-label={`上移字段 ${index + 1}`} title="上移" disabled={!index} onClick={() => updateCard(c => ({ ...c, fields: reorder(c.fields, index, index - 1) }))}><ArrowUp size={12} /></button><button aria-label={`下移字段 ${index + 1}`} title="下移" disabled={index === card.fields.length - 1} onClick={() => updateCard(c => ({ ...c, fields: reorder(c.fields, index, index + 1) }))}><ArrowDown size={12} /></button><button aria-label={`删除字段 ${index + 1}`} title="删除字段" onClick={() => updateCard(c => ({ ...c, fields: c.fields.filter(f => f.id !== field.id) }))}><X size={12} /></button></div></div>
            <textarea aria-label={field.label || `字段内容 ${index + 1}`} rows={field.value.length > 60 ? 4 : 2} placeholder="写下一些线索…" value={field.value} onChange={e => updateField(field.id, { value: e.target.value }, `field-value-${field.id}`)} />
          </div>)}</div>
          <button className="text-button full" onClick={() => updateCard(c => ({ ...c, fields: [...c.fields, { id: uid(), label: '新字段', value: '' }] }))}><Plus size={14} />添加字段</button>
          <p className="help-text">前 3 个有内容的字段会显示在卡片上。字段名称和排列顺序都可以自由调整。</p>
        </section>
      </>}
      {timeline && <section className="inspector-section"><div className="section-heading"><h3>历史中的时刻</h3><span>{timeline.entries.length}</span></div><p className="help-text">时间可以是“第三纪元”或“大战前夕”。条目等距排列，拖动把手调整先后。</p>
        <label className="input-label">引用画布中的事件<select aria-label="引用事件" value="" onChange={e => { if (e.target.value) updateTimeline(t => ({ ...t, entries: [...t.entries, { id: uid(), eventId: e.target.value, title: '', time: '', description: '' }] })); }}><option value="">选择事件…</option>{board.nodes.filter(n => n.data.kind === 'event').map(n => <option key={n.id} value={n.id}>{n.data.title || '未命名事件'}</option>)}</select></label>
        <button className="text-button full" onClick={() => updateTimeline(t => ({ ...t, entries: [...t.entries, { id: uid(), title: '新的时刻', time: '', description: '' }] }))}><Plus size={14} />添加独立条目</button>
        <div className="timeline-entry-list">{timeline.entries.map((entry, index) => {
          const resolved = resolvedEntry(entry, board);
          return <div className="entry-editor" key={entry.id} onDragOver={e => { if (dragEntry.current !== null) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragEntry.current !== null) updateTimeline(t => ({ ...t, entries: reorder(t.entries, dragEntry.current!, index) })); dragEntry.current = null; }}>
            <div className="entry-toolbar"><span draggable className="entry-grip" title="拖动排序" onDragStart={e => { dragEntry.current = index; e.dataTransfer.setData('text/plain', entry.id); }} onDragEnd={() => { dragEntry.current = null; }}><GripVertical size={14} /></span><span>{String(index + 1).padStart(2, '0')} · {entry.eventId ? '关联事件' : '独立记录'}</span><div className="field-actions"><button aria-label={`上移条目 ${index + 1}`} disabled={!index} onClick={() => updateTimeline(t => ({ ...t, entries: reorder(t.entries, index, index - 1) }))}><ArrowUp size={12} /></button><button aria-label={`下移条目 ${index + 1}`} disabled={index === timeline.entries.length - 1} onClick={() => updateTimeline(t => ({ ...t, entries: reorder(t.entries, index, index + 1) }))}><ArrowDown size={12} /></button><button aria-label={`移除条目 ${index + 1}`} onClick={() => updateTimeline(t => ({ ...t, entries: t.entries.filter(e => e.id !== entry.id) }))}><X size={12} /></button></div></div>
            <label className="input-label">时间<input aria-label={`条目时间 ${index + 1}`} value={resolved.time} readOnly={!!entry.eventId} placeholder="未定时间" onChange={e => updateEntry(entry.id, { time: e.target.value }, `entry-time-${entry.id}`)} /></label>
            <label className="input-label">标题<input aria-label={`条目标题 ${index + 1}`} value={resolved.title} readOnly={!!entry.eventId} placeholder="未命名时刻" onChange={e => updateEntry(entry.id, { title: e.target.value }, `entry-title-${entry.id}`)} /></label>
            <textarea aria-label={`条目说明 ${index + 1}`} rows={2} value={entry.description} placeholder="补充一点说明…" onChange={e => updateEntry(entry.id, { description: e.target.value }, `entry-desc-${entry.id}`)} />
            {entry.eventId && <button className="text-button" onClick={() => select(entry.eventId!)}>编辑源事件<ArrowUpRight size={12} /></button>}
          </div>;
        })}</div>
      </section>}
    </div>
    <footer className="inspector-footer">{node && <button className="text-button" onClick={() => { const id = studio.duplicateNode(node.id); if (id) select(id); }}><Copy size={14} />复制{timeline ? '时间轴' : '节点'}</button>}<button className="text-button danger" onClick={() => { studio.deleteSelection(node ? [node.id] : [], edge ? [edge.id] : []); close(); }}><Trash2 size={14} />删除{title}</button></footer>
  </aside>;
}
