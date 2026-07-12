/**
 * MqttManager 的 IPC 代理
 * 工作进程中调用此代理，实际由主进程的 MqttManager 执行
 */
import { ipcCall } from './ipc.js';

function proxy(method) {
  return (...args) => ipcCall('mqtt:' + method, ...args);
}

export const mqttManager = {
  getAllStatus: proxy('getAllStatus'),
  getStatus: proxy('getStatus'),
  addBridge: proxy('addBridge'),
  removeBridge: proxy('removeBridge'),
  updateBridge: proxy('updateBridge'),
  syncClients: proxy('syncClients'),
};
