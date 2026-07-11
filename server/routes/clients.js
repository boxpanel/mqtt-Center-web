import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import XLSX from 'xlsx';
import { loadClients, saveClients } from '../store.js';
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
    rules: (body.rules || existing?.rules || []).map((r) => ({
      subscribeTopic: r.subscribeTopic?.trim() || '',
      forwardTopic: r.forwardTopic?.trim() || '',
    })),
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

// ── 导出 Excel ──

router.get('/export', (req, res, next) => {
  try {
    const clients = loadClients();

    const rows = clients.map((c) => ({
      '名称': c.name,
      '启用': c.enabled ? '是' : '否',
      'Broker 地址': c.broker.host,
      '端口': c.broker.port,
      '用户名': c.broker.username || '',
      '密码': c.broker.password || '',
      'Client ID': c.broker.clientId || '',
      '订阅主题': c.rules.map((r) => r.subscribeTopic).join(' | '),
      '转发主题': c.rules.map((r) => r.forwardTopic).join(' | '),
      '创建时间': c.createdAt,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    ws['!cols'] = [
      { wch: 16 }, { wch: 8 }, { wch: 18 }, { wch: 8 },
      { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 30 },
      { wch: 30 }, { wch: 24 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'MQTT 客户端');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=mqtt-clients-${Date.now()}.xlsx`);
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
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: '文件中没有数据' });
    }

    let added = 0;
    let updated = 0;
    const existing = loadClients();
    const nameMap = new Map(existing.map((c) => [c.name, c]));

    for (const row of rows) {
      const name = String(row['名称'] || '').trim();
      if (!name) continue;

      const rules = [];
      const subs = String(row['订阅主题'] || '').split('|').map((s) => s.trim()).filter(Boolean);
      const fwds = String(row['转发主题'] || '').split('|').map((s) => s.trim()).filter(Boolean);
      const maxLen = Math.max(subs.length, fwds.length, 1);
      for (let i = 0; i < maxLen; i++) {
        rules.push({
          subscribeTopic: subs[i] || '',
          forwardTopic: fwds[i] || '',
        });
      }

      const client = {
        name,
        enabled: String(row['启用'] || '是') === '是',
        broker: {
          host: String(row['Broker 地址'] || '127.0.0.1').trim(),
          port: Number(row['端口']) || 1883,
          username: String(row['用户名'] || '').trim(),
          password: String(row['密码'] || ''),
          clientId: String(row['Client ID'] || '').trim(),
        },
        rules,
      };

      const match = nameMap.get(name);
      if (match) {
        /* 保留原密码 */
        if (!client.broker.password && match.broker.password) {
          client.broker.password = match.broker.password;
        }
        Object.assign(match, client, { id: match.id, createdAt: match.createdAt, updatedAt: new Date().toISOString() });
        await mqttManager.updateBridge(match);
        updated++;
      } else {
        const newClient = { ...client, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        existing.push(newClient);
        nameMap.set(name, newClient);
        await mqttManager.addBridge(newClient);
        added++;
      }
    }

    saveClients(existing);
    res.json({ success: true, added, updated });
  } catch (err) {
    next(err);
  }
});

export default router;
