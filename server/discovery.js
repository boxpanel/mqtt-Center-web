import dgram from 'dgram';
import os from 'os';
import logger from './logger.js';
import { startHeartbeat } from './heartbeat.js';

const DISCOVERY_PORT = 14141;

/**
 * 获取本机局域网 IP（排除回环地址）
 */
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

function getAllIps() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal && !ips.includes(addr.address)) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

/**
 * 启动 UDP 发现服务
 * - 响应 Hub 的广播发现
 * - 监听 Hub 的注册通知，启动心跳上报
 */
export function startDiscovery(mqttManager, loadClients, servicePort, getSystemMetrics, vip) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  // 保存本机信息供心跳模块使用
  const localIp = getLocalIp();
  global.__localIp = localIp;
  global.__servicePort = servicePort;
  if (vip) global.__vip = vip;

  socket.on('message', (msg, rinfo) => {
    try {
      const payload = JSON.parse(msg.toString().trim());

      if (payload.type === 'mqtt-hub-discovery') {
        // ── 响应发现广播（仅回复，不启动心跳）──
        const clients = loadClients();
        const statuses = mqttManager.getAllStatus();
        const statusMap = new Map(statuses.map((s) => [s.id, s]));

        let connected = 0;
        let disabled = 0;
        for (const c of clients) {
          if (!c.enabled) {
            disabled++;
          } else {
            const s = statusMap.get(c.id);
            if (s && s.status === 'connected') connected++;
          }
        }

        const reply = JSON.stringify({
          type: 'mqtt-hub-info',
          version: 1,
          hostname: os.hostname(),
          ip: localIp,
          port: servicePort,
          role: global.__haRole || 'standalone',
          stats: { total: clients.length, connected, disabled },
          vip: global.__vip || null,
          ips: getAllIps(),
        });

        socket.send(reply, rinfo.port, rinfo.address, (err) => {
          if (err) logger.error({ err }, 'UDP 回复发送失败');
        });
      } else if (payload.type === 'mqtt-hub-register') {
        // ── Hub 通知本节点已注册，启动心跳 ──
        const hubUrl = `http://${payload.hubIp}:${payload.hubPort}`;
        logger.info({ hubUrl }, '收到 Hub 注册通知，启动心跳上报');
        startHeartbeat(hubUrl, mqttManager, loadClients, getSystemMetrics);
      }
    } catch {
      // 忽略非 JSON 消息
    }
  });

  socket.on('error', (err) => {
    logger.error({ err }, 'UDP 发现服务异常');
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    logger.info({ port: DISCOVERY_PORT }, 'UDP 发现服务已启动');
  });

  return socket;
}
