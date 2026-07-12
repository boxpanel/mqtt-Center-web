/**
 * MqttManager 集群感知桥接
 * - 主进程 / 单进程模式 → 直连真实 MqttManager（同步）
 * - 工作进程模式 → IPC 代理（异步 Promise）
 */
import cluster from 'cluster';
import { mqttManager as realMqtt } from './mqtt-manager.js';
import { mqttManager as proxyMqtt } from './mqtt-proxy.js';

export const mqttManager = cluster.isPrimary ? realMqtt : proxyMqtt;
