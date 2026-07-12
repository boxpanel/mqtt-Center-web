import cluster from 'cluster';
import os from 'os';
import logger from './logger.js';
import { setupIpcServer } from './ipc.js';
import { startDiscovery } from './discovery.js';

// ───────────────────────
// 环境变量控制
// ───────────────────────
const PORT = Number(process.env.PORT) || 8088;
const WORKERS = Number(process.env.WORKERS) || os.cpus().length;
const VIP = process.env.VIP || '';
const HA_ROLE = process.env.HA_ROLE || 'standalone';

// ───────────────────────
// 主进程（管理 MQTT 连接 + 系统指标）
// ───────────────────────
async function startPrimary() {
  const { loadClients } = await import('./store.js');
  const { mqttManager } = await import('./mqtt-manager.js');
  const { getSystemMetrics } = await import('./system.js');

  // 注册 IPC 处理器
  const handlers = new Map();
  handlers.set('mqtt:getAllStatus', () => mqttManager.getAllStatus());
  handlers.set('mqtt:getStatus', (id) => mqttManager.getStatus(id));
  handlers.set('mqtt:addBridge', (config) => mqttManager.addBridge(config));
  handlers.set('mqtt:removeBridge', (id) => mqttManager.removeBridge(id));
  handlers.set('mqtt:updateBridge', (config) => mqttManager.updateBridge(config));
  handlers.set('mqtt:enableAll', () => mqttManager.enableAll());
  handlers.set('mqtt:disableAll', () => mqttManager.disableAll());
  handlers.set('system:getMetrics', () => getSystemMetrics());

  const ipc = setupIpcServer(handlers);

  // 初始化 MQTT 连接
  const clients = loadClients();
  await mqttManager.init(clients);
  logger.info({ count: clients.length }, '主进程已加载 MQTT 客户端');

  // MQTT 事件广播给所有工作进程（用于 SSE）
  mqttManager.onEvent((event) => {
    ipc.broadcast('mqtt:event', event);
  });

  // 启动 UDP 发现服务 + 心跳上报
  global.__haRole = HA_ROLE;
  startDiscovery(mqttManager, loadClients, PORT, getSystemMetrics, VIP);

  // 启动工作进程
  for (let i = 0; i < WORKERS; i++) {
    const worker = cluster.fork();
    ipc.addWorker(worker);
  }
  logger.info({ workers: WORKERS, port: PORT }, 'MQTT Center 集群已启动');

  // 工作进程崩溃自动重启
  cluster.on('exit', (worker, code, signal) => {
    logger.warn({ pid: worker.process.pid, code, signal }, '工作进程退出，正在重启...');
    const newWorker = cluster.fork();
    ipc.addWorker(newWorker);
  });

  // 优雅关闭
  const shutdown = () => {
    logger.info('主进程关闭中...');
    mqttManager.shutdown();
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ───────────────────────
// 工作进程（处理 HTTP 请求）
// ───────────────────────
async function startWorker() {
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const path = (await import('path')).default;
  const { fileURLToPath } = await import('url');
  const { ipcCall } = await import('./ipc.js');
  const { migrateRulesIfNeeded } = await import('./migrate-rules.js');

  // 启动时迁移内嵌规则到独立存储
  migrateRulesIfNeeded();
  if (VIP) global.__vip = VIP;
  global.__haRole = HA_ROLE;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = express();

  app.use(cors());
  app.use(express.json());

  // ── 路由 ──

  // 客户端管理（内部通过 IPC 代理调用主进程的 MqttManager）
  const clientsRouter = (await import('./routes/clients.js')).default;
  app.use('/api/clients', clientsRouter);

  // 规则管理（独立于客户端存储）
  const rulesRouter = (await import('./routes/rules.js')).default;
  app.use('/api/rules', rulesRouter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/system', async (req, res) => {
    try {
      const metrics = await ipcCall('system:getMetrics');
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: '获取系统资源失败', message: err.message });
    }
  });

  // 返回本机配置信息（供安装脚本获取 VIP 等）
  app.get('/api/config', (req, res) => {
    res.json({
      vip: global.__vip || null,
      role: global.__haRole || 'standalone',
      version: '1.0.0',
    });
  });

  // 控制本机所有 MQTT 连接启用/禁用（供 Keepalived notify 脚本调用）
  app.post('/api/server/local-mqtt', express.json(), async (req, res) => {
    try {
      const { enabled } = req.body;
      const count = enabled ? await ipcCall('mqtt:enableAll') : await ipcCall('mqtt:disableAll');
      res.json({ success: true, enabled, affected: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // SSE：收到主进程广播后转发给浏览器
  const sseSenders = new Set();

  process.on('message', (msg) => {
    if (msg && msg.type === 'ipc:event' && msg.eventType === 'mqtt:event') {
      sseSenders.forEach((send) => {
        try { send(msg.data); } catch {}
      });
    }
  });

  app.get('/api/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 发送初始状态
    try {
      const statuses = await ipcCall('mqtt:getAllStatus');
      send({ type: 'status', data: statuses });
    } catch {}

    sseSenders.add(send);
    req.on('close', () => {
      sseSenders.delete(send);
    });
  });

  // 静态文件
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) res.status(404).send('前端未构建，请运行 npm run build');
    });
  });

  // 启动 HTTP 服务（cluster 自动共享端口）
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ pid: process.pid, port: PORT }, '工作进程已就绪');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.fatal({ port: PORT }, `端口 ${PORT} 已被占用`);
      console.error(`\n请关闭占用端口的程序，或使用其他端口启动：`);
      console.error(`  Windows: $env:PORT=9090; npm start`);
      console.error(`  Linux:   PORT=9090 npm start\n`);
    } else {
      logger.fatal({ err }, '服务启动失败');
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason instanceof Error ? reason : new Error(String(reason)) }, '未处理的 Promise 拒绝');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '未捕获的异常');
  });
}

// ───────────────────────
// 入口
// ───────────────────────
if (cluster.isPrimary) {
  startPrimary().catch((err) => {
    logger.fatal({ err }, '主进程启动失败');
    process.exit(1);
  });
} else {
  startWorker().catch((err) => {
    logger.fatal({ err }, '工作进程启动失败');
    process.exit(1);
  });
}
