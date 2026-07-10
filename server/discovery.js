import dgram from 'dgram';
import os from 'os';
import logger from './logger.js';

const DISCOVERY_PORT = 14141;
const DISCOVERY_MSG = '{"type":"mqtt-hub-discovery","version":1}';

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

/**
 * 启动 UDP 发现服务
 * 监听 Hub 的广播，回复本机状态信息
 */
export function startDiscovery(mqttManager, loadClients, servicePort) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    try {
      const payload = JSON.parse(msg.toString().trim());
      if (payload.type !== 'mqtt-hub-discovery') return;

      // 收集客户端统计
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
        ip: getLocalIp(),
        port: servicePort,
        stats: {
          total: clients.length,
          connected,
          disabled,
        },
      });

      socket.send(reply, rinfo.port, rinfo.address, (err) => {
        if (err) {
          logger.error({ err }, 'UDP 回复发送失败');
        }
      });
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
