/**
 * 心跳上报模块
 * 向 Hub 定期发送本机状态信息
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

const HEARTBEAT_INTERVAL = 60000; // 60 秒

export function startHeartbeat(hubUrl, mqttManager, loadClients, getSystemMetrics) {
  if (!hubUrl) {
    logger.warn('未配置 Hub 地址，不启动心跳上报');
    return null;
  }

  async function sendHeartbeat() {
    try {
      const clients = loadClients();
      const statuses = mqttManager.getAllStatus();
      const statusMap = new Map(statuses.map((s) => [s.id, s]));

      let connected = 0;
      let disabled = 0;
      let errors = 0;
      let notForwarded = 0;
      for (const c of clients) {
        if (!c.enabled) {
          disabled++;
          errors++;
        } else {
          const s = statusMap.get(c.id);
          if (s && s.status === 'connected') connected++;
          if ((c.runtime?.stats?.errors || 0) > 0) errors++;
        }
        const received = c.runtime?.stats?.received || 0;
        const forwarded = c.runtime?.stats?.forwarded || 0;
        notForwarded += Math.max(0, received - forwarded);
      }

      // 获取系统指标
      let system = null;
      try { system = await getSystemMetrics(); } catch {}

      const body = {
        host: global.__localIp,
        port: global.__servicePort,
        vip: global.__vip || null,
        version: pkg.version,
        stats: {
          total: clients.length,
          connected,
          disabled,
          errors,
          notForwarded,
        },
        system,
        clients,
      };

      const res = await fetch(`${hubUrl}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        logger.warn({ status: res.status }, '心跳上报失败');
      }
    } catch (err) {
      logger.warn({ err: err.message }, '心跳上报异常');
    }
  }

  // 立即发送一次，然后定时发送
  sendHeartbeat();
  const timer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  logger.info({ hubUrl, interval: HEARTBEAT_INTERVAL }, '心跳上报已启动');

  return timer;
}
