import { test, expect, type Page } from '@playwright/test';

async function testImage(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#dce8ed'; context.fillRect(0, 0, 160, 200);
    context.fillStyle = '#7694a3'; context.beginPath(); context.arc(80, 74, 31, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.ellipse(80, 195, 66, 75, 0, 0, Math.PI * 2); context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}
async function create(page: Page, kind: string, title: string) {
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.locator('.create-dropdown').getByRole('button', { name: kind, exact: kind !== '时间轴' }).click();
  await page.getByRole('textbox', { name: '节点名称', exact: true }).fill(title);
}
async function dismissInspector(page: Page) { await page.getByRole('button', { name: '收起属性', exact: true }).click(); }
test('complete local workflow, images, relationships, timeline references and backup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('一个世界，从一点想法开始。')).toBeVisible();
  await page.getByRole('button', { name: '新建分类', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('北境档案');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByRole('button', { name: '在北境档案创建画布', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('人物与历史');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await create(page, '人物', '林岚');
  await page.getByRole('textbox', { name: '身份', exact: true }).fill('北境的守望者');
  await page.getByLabel('上传图片', { exact: true }).setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: await testImage(page) });
  await expect(page.locator('.image-tile')).toHaveCount(1);
  await page.getByRole('button', { name: '预览 portrait.png', exact: true }).click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await create(page, '事件', '长夜之战');
  await page.getByRole('textbox', { name: '时间', exact: true }).fill('第三纪元');
  await page.getByRole('textbox', { name: '过程', exact: true }).fill('北境诸城结盟。');
  await dismissInspector(page);
  // Position cards apart so the actual handle gesture can be exercised.
  const cards = page.getByTestId('world-card');
  const eventBox = await cards.filter({ hasText: '长夜之战' }).boundingBox();
  await page.mouse.move(eventBox!.x + 70, eventBox!.y + 20); await page.mouse.down(); await page.mouse.move(eventBox!.x + 70, eventBox!.y + 120, { steps: 15 }); await page.mouse.up();
  await dismissInspector(page).catch(() => {});
  await page.getByRole('button', { name: '定位全部内容' }).click(); await page.waitForTimeout(350);
  const person = cards.filter({ hasText: '林岚' }); const event = cards.filter({ hasText: '长夜之战' });
  await person.hover();
  const personBox = await person.boundingBox(), targetBox = await event.boundingBox();
  const eventIsRight = targetBox!.x > personBox!.x;
  const source = await person.locator(`[data-handleid="${eventIsRight ? 'right' : 'left'}"]`).boundingBox();
  const target = await event.locator(`[data-handleid="${eventIsRight ? 'left' : 'right'}"]`).boundingBox();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2); await page.mouse.down(); await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 15 }); await page.mouse.up();
  await expect(page.locator('.edge-label')).toHaveCount(1);
  await page.locator('.edge-label').click(); await page.getByRole('textbox', { name: '关系名称' }).fill('参与'); await page.getByLabel('关系方向').selectOption('directed');
  await create(page, '时间轴', '北境编年史');
  await page.getByLabel('引用事件', { exact: true }).selectOption({ label: '长夜之战' });
  await page.getByRole('button', { name: '添加独立条目', exact: true }).click();
  await page.getByLabel('条目时间 2', { exact: true }).fill('大战前夕'); await page.getByLabel('条目标题 2', { exact: true }).fill('风雪中的来信');
  await page.getByRole('button', { name: '上移条目 2', exact: true }).click();
  await expect(page.getByLabel('条目标题 1', { exact: true })).toHaveValue('风雪中的来信');
  await create(page, '时间轴', '人物经历');
  await page.getByLabel('引用事件', { exact: true }).selectOption({ label: '长夜之战' });
  await dismissInspector(page); await page.getByRole('button', { name: '定位全部内容' }).click(); await page.waitForTimeout(400);
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByTestId('timeline-card')).toHaveCount(2);
  await expect(page.getByTestId('world-card')).toHaveCount(2); await expect(page.locator('.edge-label')).toHaveText('参与');
  await page.screenshot({ path: 'test-results/workbench.png', fullPage: true });
  await page.getByRole('button', { name: '备份', exact: true }).click();
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: /导出全部资料/ }).click(); const download = await downloaded;
  const backupPath = await download.path();
  // Import through the UI, checking that images and all objects return.
  await page.getByLabel('导入备份文件', { exact: true }).setInputFiles(backupPath!);
  await expect(page.getByRole('heading', { name: '恢复工作台备份' })).toBeVisible();
  await page.getByRole('button', { name: '替换并恢复' }).click();
  await expect(page.getByTestId('world-card')).toHaveCount(2);
  await expect(page.locator('.card-cover img')).toHaveCount(1);
  await page.getByLabel('导入备份文件', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await expect(page.getByRole('status')).toContainText('当前资料未修改');
  expect(errors).toEqual([]);
});

test('field editing, independent copies, deletion snapshot, undo and input keyboard isolation', async ({ page }) => {
  await page.goto('/'); await create(page, '事件', '事件甲');
  await page.getByRole('textbox', { name: '时间', exact: true }).fill('纪元零年');
  await page.getByLabel('字段名称 1', { exact: true }).fill('年代');
  await page.getByRole('button', { name: '下移字段 1', exact: true }).click();
  await create(page, '时间轴', '编年'); await page.getByLabel('引用事件', { exact: true }).selectOption({ label: '事件甲' });
  await expect(page.getByLabel('条目时间 1')).toHaveValue('纪元零年');
  await page.getByRole('button', { name: '编辑源事件' }).click();
  const input = page.getByRole('textbox', { name: '节点名称', exact: true });
  await input.fill('事件乙'); await input.press('End'); await input.press('Backspace');
  await expect(page.getByTestId('world-card')).toHaveCount(1);
  await input.fill('事件乙');
  await page.getByRole('button', { name: '删除事件', exact: true }).click();
  await expect(page.getByTestId('world-card')).toHaveCount(0);
  await page.getByTestId('timeline-card').locator('header').click();
  await expect(page.getByLabel('条目标题 1')).toHaveValue('事件乙');
  await expect(page.getByLabel('条目时间 1')).toHaveValue('纪元零年');
  await expect(page.locator('.entry-toolbar')).toContainText('独立记录');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByTestId('world-card')).toHaveCount(1);
  await expect(page.locator('.entry-toolbar')).toContainText('关联事件');
  await page.getByRole('button', { name: '编辑源事件' }).click();
  await page.getByRole('button', { name: '复制节点', exact: true }).click(); await input.fill('独立副本');
  await expect(page.getByTestId('world-card').filter({ hasText: '事件乙' })).toHaveCount(1);
  await expect(page.getByTestId('world-card').filter({ hasText: '独立副本' })).toHaveCount(1);
  await page.getByRole('button', { name: '删除字段 2', exact: true }).click();
  await expect(page.getByLabel('时间字段', { exact: true })).toHaveValue('');
});

test('200 nodes and 300 relations remain editable and navigate without errors', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const data = await page.evaluate(async () => {
    const { newWorkspace, newNode, uid } = await import('/src/model.ts');
    const { exportBackup } = await import('/src/storage.ts');
    const workspace = newWorkspace(), board = workspace.boards[0];
    for (let i = 0; i < 200; i++) { const n = newNode('person', { x: (i % 20) * 300, y: Math.floor(i / 20) * 200 }); n.data.title = `人物 ${i + 1}`; board.nodes.push(n); }
    for (let i = 0; i < 300; i++) board.edges.push({ id: uid(), source: board.nodes[i % 200].id, target: board.nodes[(i + 1) % 200].id, label: `关系 ${i + 1}`, directed: false });
    return exportBackup(workspace, []);
  });
  await page.getByLabel('导入备份文件').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(data) });
  await page.getByRole('button', { name: '替换并恢复' }).click();
  await page.getByRole('button', { name: '定位全部内容' }).click(); await page.waitForTimeout(400);
  await expect(page.getByTestId('world-card')).toHaveCount(200);
  await page.mouse.move(800, 500); await page.mouse.wheel(0, -500); await page.waitForTimeout(300);
  await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(650, 450, { steps: 15 }); await page.mouse.up(); await page.keyboard.up('Space');
  await create(page, '人物', '新增人物');
  await page.getByRole('textbox', { name: '身份', exact: true }).fill('压力检查中的新节点');
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/large-workbench.png' });
});

test('timeline drag ordering and resize preserve position and support undo', async ({ page }) => {
  await page.goto('/'); await create(page, '时间轴', '自由纪年');
  await page.getByRole('button', { name: '添加独立条目' }).click();
  await page.getByLabel('条目标题 1').fill('起源');
  await page.getByRole('button', { name: '添加独立条目' }).click();
  await page.getByLabel('条目标题 2').fill('迁徙');
  const timeline = page.getByTestId('timeline-card');
  const originalPosition = await timeline.evaluate(el => (el.closest('.react-flow__node') as HTMLElement).style.transform);
  await timeline.locator('.timeline-moment').nth(0).dragTo(timeline.locator('.timeline-moment').nth(1));
  await expect(page.getByLabel('条目标题 1')).toHaveValue('迁徙');
  expect(await timeline.evaluate(el => (el.closest('.react-flow__node') as HTMLElement).style.transform)).toEqual(originalPosition);
  const handle = timeline.locator('.react-flow__resize-control.handle.right.bottom');
  const box = await handle.boundingBox();
  const initialWidth = await timeline.evaluate(el => el.getBoundingClientRect().width);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(box!.x + 84, box!.y + box!.height / 2, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => timeline.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(initialWidth + 60);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => timeline.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(initialWidth, 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByLabel('条目标题 1')).toHaveValue('起源');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByLabel('条目标题 1')).toHaveValue('迁徙');
});

test('quick switching, category removal and compact layout', async ({ page }) => {
  await page.goto('/'); await page.screenshot({ path: 'test-results/empty-workbench.png' });
  await create(page, '人物', '留在第一张');
  await page.getByRole('button', { name: '新建画布', exact: false }).first().click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('另一张画布');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await create(page, '地点', '北境城');
  await page.locator('.board-link').filter({ hasText: '我的世界' }).click();
  await expect(page.getByTestId('world-card')).toContainText('留在第一张');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '新建分类', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('临时分类');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByRole('button', { name: '另一张画布的操作', exact: true }).click();
  await page.getByLabel('移动 另一张画布 到分类').selectOption({ label: '临时分类' });
  await page.getByRole('button', { name: '删除分类 临时分类', exact: true }).click();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.locator('.board-link').filter({ hasText: '另一张画布' }).click();
  await expect(page.locator('.breadcrumb')).toContainText('未分类');
  await expect(page.getByTestId('world-card')).toContainText('北境城');
  await page.getByRole('button', { name: '收起目录', exact: true }).click();
  await page.setViewportSize({ width: 760, height: 800 });
  await page.getByRole('button', { name: '定位全部内容' }).click();
  await expect(page.getByTestId('world-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/compact-workbench.png' });
});

test('multi-selection movement and parallel relation labels', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible();
  const fixture = await page.evaluate(async () => {
    const { exportBackup } = await import('/src/storage.ts');
    const { newWorkspace, newNode, uid } = await import('/src/model.ts');
    const workspace = newWorkspace(), board = workspace.boards[0];
    const first = newNode('person', { x: 60, y: 100 }), second = newNode('person', { x: 460, y: 100 });
    first.data.title = '人物甲'; second.data.title = '人物乙'; board.nodes = [first, second];
    board.edges = ['朋友', '同僚'].map(label => ({ id: uid(), source: first.id, target: second.id, sourceHandle: 'right', targetHandle: 'left', label, directed: false }));
    return exportBackup(workspace, []);
  });
  await page.getByLabel('导入备份文件').setInputFiles({ name: 'group.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
  await page.getByRole('button', { name: '替换并恢复' }).click();
  const a = page.getByTestId('world-card').filter({ hasText: '人物甲' });
  const b = page.getByTestId('world-card').filter({ hasText: '人物乙' });
  await a.locator('h3').click(); await b.locator('h3').click({ modifiers: ['Shift'] });
  await expect(page.locator('.world-card.is-selected')).toHaveCount(2);
  const box = await a.boundingBox();
  await page.mouse.move(box!.x + 60, box!.y + 20); await page.mouse.down(); await page.mouse.move(box!.x + 130, box!.y + 90, { steps: 12 }); await page.mouse.up();
  const positions = await page.locator('.react-flow__node-card').evaluateAll(nodes => nodes.map(el => { const matrix = new DOMMatrix(getComputedStyle(el).transform); return { x: matrix.m41, y: matrix.m42 }; }));
  expect(positions[0].x).toBeGreaterThan(100); expect(positions[1].x - positions[0].x).toBe(400); expect(positions[1].y).toBe(positions[0].y);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect.poll(() => page.locator('.react-flow__node-card').evaluateAll(nodes => nodes.map(el => { const matrix = new DOMMatrix(getComputedStyle(el).transform); return { x: matrix.m41, y: matrix.m42 }; }))).toEqual([{ x: 60, y: 100 }, { x: 460, y: 100 }]);
  const labels = page.locator('.edge-label'); await expect(labels).toHaveCount(2);
  const firstLabel = await labels.nth(0).boundingBox(), secondLabel = await labels.nth(1).boundingBox();
  expect(Math.abs(firstLabel!.y - secondLabel!.y)).toBeGreaterThan(30);
  await labels.filter({ hasText: '同僚' }).click();
  await expect(page.getByRole('textbox', { name: '关系名称' })).toHaveValue('同僚');
});
