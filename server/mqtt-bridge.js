/**
 * MqttManager 集群感知桥接
 * - 主进程 / 单进程模式 → 直连真实 MqttManager（同步）
 * - 工作进程模式 → IPC 代理（异步 Promise）
 * - 备用服务器模式 → 空操作（noop）
 */
import cluster from 'cluster';
import { mqttManager as realMqtt } from './mqtt-manager.js';
import { mqttManager as proxyMqtt } from './mqtt-proxy.js';

const noopManager = {
  getAllStatus: () => [],
  getStatus: () => ({ status: 'standby', stats: { received: 0, forwarded: 0, errors: 0 }, lastError: null }),
  addBridge: () => {},
  updateBridge: () => {},
  removeBridge: () => {},
  init: async () => {},
  onEvent: () => {},
  shutdown: () => {},
};

const isStandby = () => process.env.HA_ROLE === 'standby';

export const mqttManager = isStandby() ? noopManager : (cluster.isPrimary ? realMqtt : proxyMqtt);
