import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import XLSX from 'xlsx';
import { loadClients, saveClients } from '../store.js';
import { loadRules } from '../store-rules.js';
import { mqttManager } from '../mqtt-bridge.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

function validateClient(body, isUpdate = false) {
  const errors = [];

  if (!isUpdate && !body.name?.trim()) errors.push('名称不能为空');
  if (!body.broker?.host?.trim()) errors.push('Broker 地址不能为空');
  if (!body.broker?.port || body.broker.port < 1 || body.broker.port > 65535) {
    errors.push('端口无效');
  }

  if (!Array.isArray(body.rules)) body.rules = [];
  body.rules.forEach((rule, i) => {
    if (!rule.subscribeTopic?.trim()) errors.push(`规则 ${i + 1}: 订阅主题不能为空`);
    if (!rule.forwardTopic?.trim()) errors.push(`规则 ${i + 1}: 转发主题不能为空`);
  });

  return errors;
}

function normalizeClient(body, existing = null) {
  return {
    id: existing?.id || uuidv4(),
    name: body.name?.trim() || existing?.name || '',
    enabled: body.enabled !== undefined ? Boolean(body.enabled) : (existing?.enabled ?? true),
    broker: {
      host: body.broker?.host?.trim() || existing?.broker?.host || '127.0.0.1',
      port: Number(body.broker?.port) || existing?.broker?.port || 1883,
      username: body.broker?.username?.trim() || '',
      password: body.broker?.password ?? existing?.broker?.password ?? '',
      clientId: body.broker?.clientId?.trim() || '',
    },
    rules: [],
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function maskPassword(client) {
  return {
    ...client,
    broker: { ...client.broker, password: client.broker.password ? '******' : '' },
  };
}

// ── 获取所有客户端（含运行时状态） ──

router.get('/', async (req, res, next) => {
  try {
    const clients = loadClients();
    const statuses = await mqttManager.getAllStatus();
    const statusMap = Object.fromEntries((statuses || []).map((s) => [s.id, s]));

    // 内部同步模式：返回完整数据（含密码）
    if (req.query.sync === 'true') {
      return res.json(clients);
    }

    const result = clients.map((c) => ({
      ...c,
      broker: { ...c.broker, password: c.broker.password ? '******' : '' },
      runtime: statusMap[c.id] || { status: 'unknown', stats: { received: 0, forwarded: 0, errors: 0 }, lastError: null },
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── 批量删除 ──

router.post('/batch-delete', async (req, res, next) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = rawIds.filter((id) => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) {
      return res.status(400).json({ error: '请选择要删除的客户端' });
    }

    const idSet = new Set(ids);
    const clients = loadClients();
    const remaining = [];
    let deleted = 0;

    for (const c of clients) {
      if (idSet.has(c.id)) {
        await mqttManager.removeBridge(c.id);
        deleted++;
      } else {
        remaining.push(c);
      }
    }

    saveClients(remaining);
    res.json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});

// ── 导出 Excel（含客户端和订阅主题两个工作表） ──

router.get('/export', (req, res, next) => {
  try {
    const clients = loadClients();
    const rules = loadRules();

    // Sheet 1: 客户端列表
    const clientRows = clients.map((c) => ({
      '名称': c.name,
      '启用': c.enabled ? '是' : '否',
      'Broker 地址': c.broker.host,
      '端口': c.broker.port,
      '用户名': c.broker.username || '',
      '密码': c.broker.password || '',
      'Client ID': c.broker.clientId || '',
      '创建时间': c.createdAt,
    }));

    // Sheet 2: 订阅主题
    const clientNameMap = new Map(clients.map((c) => [c.id, c.name]));
    const topicRows = rules.map((r) => {
      if (!r.subscribeTopic) return null;
      return {
        '主题名称': r.groupName || '',
        '订阅主题': r.subscribeTopic,
        '订阅客户端': clientNameMap.get(r.subscribeClientId) || '',
        '转发主题': r.forwardTopic,
        '转发客户端': clientNameMap.get(r.forwardClientId) || '',
        '规则内容': r.conditions ? JSON.stringify(r.conditions) : '',
      };
    }).filter(Boolean);

    const wb = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(clientRows);
    ws1['!cols'] = [
      { wch: 16 }, { wch: 8 }, { wch: 18 }, { wch: 8 },
      { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(wb, ws1, '客户端列表');

    const ws2 = XLSX.utils.json_to_sheet(topicRows);
    ws2['!cols'] = [
      { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 30 },
      { wch: 16 }, { wch: 30 },
    ];
    XLSX.utils.book_append_sheet(wb, ws2, '订阅主题');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=mqtt-center-${Date.now()}.xlsx`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

// ── 获取单个客户端 ──

router.get('/:id', async (req, res, next) => {
  try {
    const clients = loadClients();
    const client = clients.find((c) => c.id === req.params.id);

    if (!client) {
      return res.status(404).json({ error: '客户端不存在' });
    }

    const status = await mqttManager.getStatus(client.id);
    res.json({
      ...client,
      broker: { ...client.broker, password: client.broker.password ? '******' : '' },
      runtime: status || { status: 'unknown', stats: { received: 0, forwarded: 0, errors: 0 } },
    });
  } catch (err) {
    next(err);
  }
});

// ── 创建客户端 ──

router.post('/', async (req, res, next) => {
  try {
    const errors = validateClient(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const clients = loadClients();
    const client = normalizeClient(req.body);
    clients.push(client);
    saveClients(clients);

    const status = await mqttManager.addBridge(client);

    res.status(201).json({ ...maskPassword(client), runtime: status });
  } catch (err) {
    next(err);
  }
});

// ── 更新客户端 ──

router.put('/:id', async (req, res, next) => {
  try {
    const clients = loadClients();
    const index = clients.findIndex((c) => c.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: '客户端不存在' });
    }

    const errors = validateClient(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    const existing = clients[index];
    const updated = normalizeClient(req.body, existing);

    if (req.body.broker?.password === '******' || req.body.broker?.password === '') {
      updated.broker.password = existing.broker.password;
    }

    clients[index] = updated;
    saveClients(clients);

    const status = await mqttManager.updateBridge(updated);

    res.json({ ...maskPassword(updated), runtime: status });
  } catch (err) {
    next(err);
  }
});

// ── 删除客户端 ──

router.delete('/:id', async (req, res, next) => {
  try {
    const clients = loadClients();
    const index = clients.findIndex((c) => c.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: '客户端不存在' });
    }

    await mqttManager.removeBridge(req.params.id);
    clients.splice(index, 1);
    saveClients(clients);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── keepalived 主备切换时触发 ──

router.post('/sync-standby', (req, res) => {
  const clients = loadClients();
  mqttManager.syncClients(clients);
  res.json({ success: true, count: clients.length });
});

router.post('/reconnect-all', async (req, res, next) => {
  try {
    const clients = loadClients();
    let count = 0;
    for (const c of clients) {
      if (c.enabled) {
        const status = await mqttManager.updateBridge(c);
        if (status?.status === 'connected') count++;
      }
    }
    res.json({ success: true, connected: count });
  } catch (err) {
    next(err);
  }
});

router.post('/disconnect-all', async (req, res, next) => {
  try {
    const clients = loadClients();
    let count = 0;
    for (const c of clients) {
      await mqttManager.removeBridge(c.id);
      count++;
    }
    res.json({ success: true, disconnected: count });
  } catch (err) {
    next(err);
  }
});

// ── 切换启用/禁用 ──

router.post('/:id/toggle', async (req, res, next) => {
  try {
    const clients = loadClients();
    const index = clients.findIndex((c) => c.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({ error: '客户端不存在' });
    }

    clients[index].enabled = !clients[index].enabled;
    clients[index].updatedAt = new Date().toISOString();
    saveClients(clients);

    const status = await mqttManager.updateBridge(clients[index]);

    res.json({ ...maskPassword(clients[index]), runtime: status });
  } catch (err) {
    next(err);
  }
});

// ── 导入 Excel ──

router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传 Excel 文件' });
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = wb.SheetNames;

    let added = 0;
    let updated = 0;

    // 确定客户端列表 sheet
    let sheetName = null;
    if (sheetNames.includes('MQTT 客户端')) {
      sheetName = 'MQTT 客户端';
    } else if (sheetNames.includes('客户端列表')) {
      sheetName = '客户端列表';
    } else {
      sheetName = sheetNames[0];
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: '文件中没有数据' });
    }

    const oldClients = loadClients();
    const oldNameMap = new Map(oldClients.map((c) => [c.name, c]));
    const newClients = [];
    const addedRules = []; // 暂存规则，后续保存到规则存储

    for (const row of rows) {
      const name = String(row['名称'] || '').trim();
      if (!name) continue;

      const oldMatch = oldNameMap.get(name);
      const id = oldMatch?.id || uuidv4();

      const client = {
        id,
        name,
        enabled: String(row['启用'] || '是') === '是',
        broker: {
          host: String(row['Broker 地址'] || '127.0.0.1').trim(),
          port: Number(row['端口']) || 1883,
          username: String(row['用户名'] || '').trim(),
          password: String(row['密码'] || ''),
          clientId: String(row['Client ID'] || '').trim(),
        },
        rules: [],
        createdAt: oldMatch?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runtime: oldMatch?.runtime || { id, status: 'disconnected', stats: { received: 0, forwarded: 0, errors: 0 }, lastError: null },
      };

      if (!client.broker.password && oldMatch?.broker.password) {
        client.broker.password = oldMatch.broker.password;
      }

      newClients.push(client);
      if (oldMatch) updated++;
      else added++;
    }

    // 断开旧客户端中不再需要的 MQTT 连接
    const newNames = new Set(newClients.map((c) => c.name));
    for (const old of oldClients) {
      if (!newNames.has(old.name)) {
        try { await mqttManager.removeBridge(old.id); } catch { /* 忽略 */ }
      }
    }

    saveClients(newClients);

    // 为新客户端建立 MQTT 连接
    for (const c of newClients) {
      const oldMatch = oldNameMap.get(c.name);
      if (!oldMatch) {
        try { await mqttManager.addBridge(c); } catch { /* 忽略 */ }
      } else {
        try { await mqttManager.updateBridge(c); } catch { /* 忽略 */ }
      }
    }

    // 尝试导入订阅主题 sheet（如果有）
    let topicAdded = 0;
    if (sheetNames.includes('订阅主题')) {
      const { loadRules, saveRules } = await import('../store-rules.js');
      const existingRules = loadRules();
      const nameMap = new Map(newClients.map((c) => [c.name, c]));

      const tws = wb.Sheets['订阅主题'];
      const topicRows = XLSX.utils.sheet_to_json(tws, { defval: '' });

      for (const row of topicRows) {
        const subClientName = String(row['订阅客户端'] || '').trim();
        if (!subClientName) continue;
        const subscribeTopic = String(row['订阅主题'] || '').trim();
        if (!subscribeTopic) continue;

        const subClient = nameMap.get(subClientName);
        if (!subClient) continue;

        const fwdClientName = String(row['转发客户端'] || '').trim();
        let forwardClientId = '';
        if (fwdClientName) {
          const fwdClient = nameMap.get(fwdClientName);
          if (fwdClient) forwardClientId = fwdClient.id;
        }

        let conditions = null;
        const condStr = String(row['规则内容'] || '').trim();
        if (condStr) try { conditions = JSON.parse(condStr); } catch {}

        existingRules.push({
          id: uuidv4(),
          subscribeTopic,
          forwardTopic: String(row['转发主题'] || '').trim(),
          subscribeClientId: subClient.id,
          forwardClientId,
          groupName: String(row['主题名称'] || '').trim(),
          conditions,
        });
        topicAdded++;
      }

      saveRules(existingRules);
    }

    let msg = `导入完成：新增 ${added} 个，更新 ${updated} 个`;
    if (topicAdded > 0) msg += `，导入 ${topicAdded} 条订阅主题`;
    res.json({ success: true, added, updated, topicAdded });
  } catch (err) {
    next(err);
  }
});

export default router;
