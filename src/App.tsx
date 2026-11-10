import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, MoreHorizontal, Layers, FileImage, FileText, Upload, Save, Check, Circle, X, Clock3, Search, Pencil, Trash2, ArrowUpRight, LoaderCircle, HelpCircle } from 'lucide-react';
import { Canvas, kindIcons, type CanvasHandle, type Selection } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { kinds, kindLabels, newBoard, uid, type Board } from './model';
import { studio, useStudio } from './store';
import { exportBoardFile, parseBackup } from './storage';
import { downloadCanvas, downloadFile, safeCanvasName, type CanvasFormat } from './canvasExport';

type ModalData = { title: string; description: string; input?: string; confirmLabel?: string; danger?: boolean; action: (value: string) => void | Promise<void> };
type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

function Modal({ data, close }: { data: ModalData; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(data.input ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog className="modal" ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <form onSubmit={async e => { e.preventDefault(); if (data.input !== undefined && !value.trim()) { setError('请输入名称。'); return; } setBusy(true); try { await data.action(value.trim()); close(); } catch (err) { setError(err instanceof Error ? err.message : '操作失败，请重试。'); setBusy(false); } }}>
      <div className="modal-heading"><h2>{data.title}</h2><button type="button" className="icon-button" aria-label="关闭对话框" disabled={busy} onClick={close}><X size={17} /></button></div><p>{data.description}</p>
      {data.input !== undefined && <input autoFocus aria-label="名称" value={value} maxLength={120} onChange={e => setValue(e.target.value)} />}
      {error && <div className="error-text" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>取消</button><button type="submit" disabled={busy} className={data.danger ? 'danger-button' : 'primary'}>{busy ? '处理中…' : data.confirmLabel ?? '确定'}</button></div>
    </form>
  </dialog>;
}
function Lightbox({ image, close }: { image: { url: string; name: string }; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="lightbox" onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><header><span>{image.name}</span><button className="icon-button" aria-label="关闭图片预览" onClick={close}><X size={20} /></button></header><img src={image.url} alt={image.name} /></dialog>;
}
export function App() {
  const state = useStudio();
  const workspace = state.workspace;
  const board = workspace.boards.find(b => b.id === workspace.activeBoardId)!;
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 900);
  const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [menuBoard, setMenuBoard] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<ModalData | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [toast, setToast] = useState('');
  const [localFiles, setLocalFiles] = useState(() => new Map<string, FileSystemFileHandle>());
  const localFile = localFiles.get(board.id);
  const [savingFile, setSavingFile] = useState(false);
  const [exporting, setExporting] = useState(false);
  const savingFileRef = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<CanvasHandle>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const menus = useRef<HTMLDivElement>(null);
  const notify = (message: string) => setToast(message);
  const closeInspector = () => setSelection({ nodes: [], edges: [] });
  const selectNode = (id: string) => { setSelection({ nodes: [id], edges: [] }); canvas.current?.focus(id); };
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const click = (e: PointerEvent) => { if (!menus.current?.contains(e.target as HTMLElement)) { setCreateOpen(false); setBackupOpen(false); } };
    window.addEventListener('pointerdown', click); return () => window.removeEventListener('pointerdown', click);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (modal || preview || !state.ready) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!e.repeat) saveButton.current?.click();
        return;
      }
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? studio.redo() : studio.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); studio.redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && (selection.nodes.length || selection.edges.length)) { e.preventDefault(); studio.deleteSelection(selection.nodes, selection.edges); closeInspector(); }
      else if (e.key === 'Escape') { closeInspector(); setCreateOpen(false); setBackupOpen(false); setMenuBoard(null); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [modal, preview, state.ready, selection]);
  function promptName(title: string, initial: string, action: (value: string) => void | Promise<void>) { setModal({ title, description: '给它一个便于寻找的名字。', input: initial, action }); }
  async function switchBoard(id: string) {
    try { await studio.switchBoard(id); closeInspector(); setMenuBoard(null); }
    catch { notify('当前修改未能自动保存。请重试，或使用「保存画布」。'); }
  }
  function addBoard(categoryId: string | null = null) {
    promptName('创建画布', '未命名画布', async title => {
      await studio.flush(); const next = newBoard(title, categoryId);
      studio.resetHistory(); studio.updateWorkspace(w => ({ ...w, boards: [...w.boards, next], activeBoardId: next.id })); closeInspector();
    });
  }
  function deleteBoard(target: Board) {
    setMenuBoard(null);
    setModal({ title: `删除「${target.title}」？`, description: '这张画布的节点、关系和时间轴会一起删除，无法通过画布撤销恢复。需要保留时请先保存到本地。', danger: true, confirmLabel: '删除画布', action: async () => {
      await studio.flush();
      studio.updateWorkspace(w => { const remaining = w.boards.filter(b => b.id !== target.id); if (!remaining.length) remaining.push(newBoard('我的世界')); return { ...w, boards: remaining, activeBoardId: w.activeBoardId === target.id ? remaining[0].id : w.activeBoardId }; });
      if (board.id === target.id) { studio.resetHistory(); closeInspector(); }
    } });
  }
  async function saveLocalFile(saveAs = false) {
    if (savingFileRef.current) return;
    savingFileRef.current = true;
    setSavingFile(true);
    setBackupOpen(false);
    setCreateOpen(false);
    const filename = `OC-Studio-${safeCanvasName(board.title)}.json`;
    let file = saveAs ? undefined : localFile;
    try {
      const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
      if (!file && picker) {
        try {
          file = await picker.call(window, {
            suggestedName: filename,
            types: [{ description: 'OC Studio 画布', accept: { 'application/json': ['.json'] } }],
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          // Embedded previews can expose the API while blocking the native picker.
          if (!(error instanceof DOMException && error.name === 'SecurityError')) throw error;
        }
      }
      if (!file) {
        downloadFile(new Blob([await exportBoardFile(board, studio.allAssets)], { type: 'application/json' }), filename);
        notify('已发起本地文件下载，请在浏览器下载列表中查看。');
        return;
      }
      const stream = await file.createWritable();
      try {
        await stream.write(await exportBoardFile(board, studio.allAssets));
        await stream.close();
      } catch (error) {
        await stream.abort().catch(() => {});
        throw error;
      }
      const savedFile = file;
      setLocalFiles(files => new Map(files).set(board.id, savedFile));
      notify(`已保存到文件「${file.name}」。`);
    } catch {
      if (localFile && file === localFile) setLocalFiles(files => {
        const next = new Map(files);
        next.delete(board.id);
        return next;
      });
      notify('本地文件保存失败。请检查文件权限和磁盘空间，再选择位置重试。');
    } finally {
      savingFileRef.current = false;
      setSavingFile(false);
    }
  }

  async function exportBoard(format: CanvasFormat) {
    if (exporting || !canvas.current) return;
    setBackupOpen(false);
    setExporting(true);
    try {
      await downloadCanvas(await canvas.current.capture(), board.title, format);
      notify(`画布已导出为 ${format.toUpperCase()}。`);
    } catch { notify('画布导出失败，请重试。'); }
    finally { setExporting(false); }
  }

  async function importCanvasFile(file?: File) {
    if (!file) return;
    try {
      const project = parseBackup(await file.text());
      for (const asset of project.assets) {
        const bitmap = await createImageBitmap(asset.blob);
        bitmap.close();
      }
      const count = project.workspace.boards.length;
      setModal({
        title: '导入画布',
        description: `文件包含 ${count} 张画布和 ${project.assets.length} 张图片。导入的画布将加入当前工作台。`,
        confirmLabel: '添加画布',
        action: async () => {
          await studio.importWorkspace(project.workspace, project.assets, file.name.replace(/\.json$/i, ''));
          closeInspector();
          setMenuBoard(null);
          notify(`已导入 ${count} 张可编辑画布。`);
        },
      });
    } catch { notify('无法读取文件。请选择有效的 OC Studio JSON 文件。'); }
  }
  const selectedNode = selection.nodes.length === 1 && !selection.edges.length ? board.nodes.find(n => n.id === selection.nodes[0]) : undefined;
  const selectedEdge = selection.edges.length === 1 && !selection.nodes.length ? board.edges.find(e => e.id === selection.edges[0]) : undefined;
  const currentCategory = workspace.categories.find(c => c.id === board.categoryId)?.title ?? '未分类';
  const autoSaveLabel = state.status === 'saved' ? '已自动保存' : state.status === 'saving' ? '正在自动保存' : '自动保存失败 · 重试';
  function renderBoard(item: Board) {
    return <div className="board-item" key={item.id}>
      <div className={`board-row ${item.id === board.id ? 'active' : ''}`}><button className="board-link" onClick={() => void switchBoard(item.id)}><Layers size={15} /><span>{item.title || '未命名画布'}</span></button><button className="board-more" title={`${item.title}的操作`} aria-label={`${item.title}的操作`} onClick={() => setMenuBoard(menuBoard === item.id ? null : item.id)}><MoreHorizontal size={16} /></button></div>
      {menuBoard === item.id && <div className="board-menu"><button onClick={() => { setMenuBoard(null); promptName('重命名画布', item.title, title => studio.updateWorkspace(w => ({ ...w, boards: w.boards.map(b => b.id === item.id ? { ...b, title } : b) }))); }}><Pencil size={12} />重命名</button><label>移至分类<select aria-label={`移动 ${item.title} 到分类`} value={item.categoryId ?? ''} onChange={e => { studio.updateWorkspace(w => ({ ...w, boards: w.boards.map(b => b.id === item.id ? { ...b, categoryId: e.target.value || null } : b) })); setMenuBoard(null); }}><option value="">未分类</option>{workspace.categories.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select></label><button className="danger" onClick={() => deleteBoard(item)}><Trash2 size={12} />删除画布</button></div>}
    </div>;
  }
  function renderCategory(category: { id: string; title: string } | null) {
    const key = category?.id ?? 'uncategorized';
    const items = workspace.boards.filter(b => b.categoryId === (category?.id ?? null) && b.title.toLowerCase().includes(query.toLowerCase()));
    const hidden = collapsed.has(key) && !query;
    return <section className="category" key={key}><div className="category-heading"><button className="category-toggle" onClick={() => setCollapsed(s => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; })}>{hidden ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<Folder size={13} /><span>{category?.title ?? '未分类'}</span><small>{items.length}</small></button><div className="category-actions">
      {category && <><button title={`重命名分类 ${category.title}`} aria-label={`重命名分类 ${category.title}`} onClick={() => promptName('重命名分类', category.title, title => studio.updateWorkspace(w => ({ ...w, categories: w.categories.map(c => c.id === category.id ? { ...c, title } : c) })))}><Pencil size={11} /></button><button title={`删除分类 ${category.title}`} aria-label={`删除分类 ${category.title}`} onClick={() => setModal({ title: `删除分类「${category.title}」？`, description: '分类下的画布会移入“未分类”，内容会完整保留。', action: () => studio.updateWorkspace(w => ({ ...w, categories: w.categories.filter(c => c.id !== category.id), boards: w.boards.map(b => b.categoryId === category.id ? { ...b, categoryId: null } : b) })) })}><X size={12} /></button></>}
      <button title={`在${category?.title ?? '未分类'}创建画布`} aria-label={`在${category?.title ?? '未分类'}创建画布`} onClick={() => addBoard(category?.id ?? null)}><Plus size={13} /></button>
    </div></div>{!hidden && <div className="category-boards">{items.map(renderBoard)}{!items.length && <p className="category-empty">{query ? '没有匹配的画布' : '还没有画布'}</p>}</div>}</section>;
  }
  if (!state.ready) return <div className="loading-screen"><div className="brand-mark"><Layers size={22} /></div><h1>OC Studio</h1><p>{state.status === 'error' ? state.error : '正在打开你的世界…'}</p>{state.status === 'error' && <button className="primary" onClick={() => void studio.initialize()}>重新读取</button>}</div>;
  return <div className={`app ${sidebarOpen ? 'with-sidebar' : ''}`}>
    {sidebarOpen && <aside className="sidebar" aria-label="画布目录"><div className="brand"><div className="brand-mark"><Layers size={19} strokeWidth={1.6} /></div><div><strong>OC Studio</strong><span>世界观工作台</span></div><button className="icon-button" title="收起目录" aria-label="收起目录" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={17} /></button></div>
      <div className="sidebar-tools"><button className="new-board" onClick={() => addBoard()}><Plus size={15} />新建画布<span>＋</span></button><label className="search"><Search size={14} /><input placeholder="查找画布…" aria-label="查找画布" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={12} /></button>}</label></div>
      <div className="directory-heading"><span>我的画布</span><button className="icon-button" title="新建分类" aria-label="新建分类" onClick={() => promptName('新建分类', '', title => studio.updateWorkspace(w => ({ ...w, categories: [...w.categories, { id: uid(), title }] })))}><FolderPlus size={15} /></button></div>
      <nav className="board-directory">{workspace.categories.map(renderCategory)}{renderCategory(null)}</nav>
      <footer className="sidebar-footer"><div><span className="local-dot" />本地工作空间<span>{workspace.boards.length} 张画布</span></div><p>让想象有迹可循。</p><button onClick={() => setModal({ title: '使用与保存', description: '编辑时会自动保存到浏览器。「保存画布」或 Ctrl+S 会把当前画布保存成可编辑文件。用「导入画布」可以重新打开自己保存的画布，也能加入别人分享的画布。可将当前画布导出为 PNG 或 PDF。', confirmLabel: '知道了', action: () => {} })}><HelpCircle size={13} />操作与文件说明<ArrowUpRight size={12} /></button></footer>
    </aside>}
    <div className="workspace"><header className="topbar"><div className="breadcrumb">{!sidebarOpen && <button className="icon-button" aria-label="展开目录" title="展开目录" onClick={() => setSidebarOpen(true)}><PanelLeftOpen size={18} /></button>}<span>{currentCategory}</span><ChevronRight size={13} /><button title="重命名当前画布" onClick={() => promptName('重命名画布', board.title, title => studio.updateWorkspace(w => ({ ...w, boards: w.boards.map(b => b.id === board.id ? { ...b, title } : b) })))}>{board.title}</button></div>
      <div className="topbar-actions" ref={menus}>
        <button className={`save-status ${state.status}`} aria-label={autoSaveLabel} title={state.status === 'error' ? state.error + ' 点击重试' : '自动保存到当前浏览器'} onClick={() => void studio.flush().catch(() => {})}>
          {state.status === 'saved' ? <Check size={13} /> : state.status === 'saving' ? <LoaderCircle size={13} /> : <Circle size={13} />}
          <span>{autoSaveLabel}</span>
        </button><div className="toolbar-divider" />
        <button ref={saveButton} className="toolbar-button local-save-button" aria-label="保存画布到本地" aria-busy={savingFile} disabled={savingFile}
          title={localFile ? `保存到 ${localFile.name}（Ctrl+S）` : '保存当前画布到本地文件（Ctrl+S）'} onClick={() => void saveLocalFile()}>
          {savingFile ? <LoaderCircle size={15} /> : <Save size={15} />}<span>{savingFile ? '正在保存…' : '保存画布'}</span>
        </button>
        <div className="menu-anchor">
          <button className="toolbar-button" aria-label="文件" aria-busy={exporting} aria-expanded={backupOpen} onClick={() => { setBackupOpen(!backupOpen); setCreateOpen(false); }}><FolderOpen size={14} /><span>{exporting ? '正在导出…' : '文件'}</span><ChevronDown size={12} /></button>
          {backupOpen && <div className="dropdown backup-dropdown"><div className="dropdown-caption">可编辑文件</div>
            {localFile && <button disabled={savingFile} onClick={() => void saveLocalFile(true)}><Save size={15} /><span>另存为<small>选择新的本地文件</small></span></button>}
            <button onClick={() => { setBackupOpen(false); importInput.current?.click(); }}><Upload size={15} /><span>导入画布<small>打开本地或别人分享的画布</small></span></button>
            <hr /><div className="dropdown-caption">导出当前画布</div>
            <button disabled={exporting || !board.nodes.length} onClick={() => void exportBoard('png')}><FileImage size={15} /><span>导出为 PNG</span></button>
            <button disabled={exporting || !board.nodes.length} onClick={() => void exportBoard('pdf')}><FileText size={15} /><span>导出为 PDF</span></button>
          </div>}
        </div>
        <div className="menu-anchor"><button className="primary create-button" aria-expanded={createOpen} onClick={() => { setCreateOpen(!createOpen); setBackupOpen(false); }}><Plus size={15} />创建<ChevronDown size={12} /></button>{createOpen && <div className="dropdown create-dropdown"><div className="dropdown-caption">添加到画布</div>{kinds.map(kind => { const Icon = kindIcons[kind]; return <button key={kind} onClick={() => { canvas.current?.create(kind); setCreateOpen(false); }}><Icon size={16} /><span>{kindLabels[kind]}</span></button>; })}<hr /><button onClick={() => { canvas.current?.create('timeline'); setCreateOpen(false); }}><Clock3 size={16} /><span>时间轴</span><small>自由纪年</small></button></div>}</div>
      </div>
    </header><div className="workspace-body"><Canvas key={`${board.id}-${state.session}`} board={board} selection={selection} setSelection={setSelection} ref={canvas} />{(selectedNode || selectedEdge) && <Inspector key={selectedNode?.id ?? selectedEdge?.id} board={board} node={selectedNode} edge={selectedEdge} close={closeInspector} select={selectNode} notify={notify} preview={(url, name) => setPreview({ url, name })} />}</div></div>
    <input hidden type="file" ref={importInput} accept=".json,application/json" aria-label="导入 OC Studio 文件" onChange={e => { void importCanvasFile(e.target.files?.[0]); e.target.value = ''; }} />
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="关闭提示" onClick={() => setToast('')}><X size={14} /></button></div>}
    {modal && <Modal data={modal} close={() => setModal(null)} />}{preview && <Lightbox image={preview} close={() => setPreview(null)} />}
  </div>;
}
