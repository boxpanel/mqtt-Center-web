import mqtt from 'mqtt';
import { EventEmitter } from 'events';
import logger from './logger.js';
import { loadRules } from './store-rules.js';

const HEALTH_CHECK_INTERVAL = 30000;
const STARTUP_STAGGER_MS = 150;

class MqttBridge extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.status = 'disconnected';
    this.stats = { received: 0, forwarded: 0, errors: 0 };
    this.lastError = null;
    this.destroyed = false;
    this.listenersBound = false;
    this.log = logger.child({ client: config.name || config.id });
  }

  getId() {
    return this.config.id;
  }

  getStatus() {
    return {
      id: this.config.id,
      status: this.status,
      stats: { ...this.stats },
      lastError: this.lastError,
    };
  }

  safeEmit(event, data) {
    try {
      this.emit(event, data);
    } catch (err) {
      this.log.error({ err }, '事件异常');
    }
  }

  recordError(message) {
    this.stats.errors++;
    this.lastError = message;
    this.safeEmit('error', { id: this.config.id, message });
    this.safeEmit('status', this.getStatus());
  }

  clearError() {
    this.lastError = null;
  }

  connect() {
    if (this.destroyed) return;

    if (!this.config.enabled) {
      this.status = 'disabled';
      this.safeEmit('status', this.getStatus());
      return;
    }

    this.disconnect(false);

    try {
      const { host, port, username, password, clientId } = this.config.broker;
      const url = `mqtt://${host}:${port}`;

      const options = {
        clientId: clientId || `mqtt-center-${this.config.id}`,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clean: true,
        resubscribe: true,
      };

      if (username) options.username = username;
      if (password) options.password = password;

      this.status = 'connecting';
      this.safeEmit('status', this.getStatus());

      this.client = mqtt.connect(url, options);
      this.bindClientEvents();
    } catch (err) {
      this.status = 'error';
      this.recordError(`连接初始化失败: ${err.message}`);
    }
  }

  bindClientEvents() {
    if (!this.client || this.listenersBound) return;
    this.listenersBound = true;

    this.client.on('connect', () => {
      if (this.destroyed) return;
      this.log.info({ broker: `${this.config.broker.host}:${this.config.broker.port}` }, 'MQTT 已连接');
      this.status = 'connected';
      this.clearError();
      this.safeEmit('status', this.getStatus());
      this.subscribeAll();
    });

    this.client.on('message', (topic, payload) => {
      if (this.destroyed) return;
      setImmediate(() => this.handleMessage(topic, payload));
    });

    this.client.on('error', (err) => {
      if (this.destroyed) return;
      this.status = 'error';
      this.recordError(err.message);
    });

    this.client.on('close', (err) => {
      if (this.destroyed) return;
      this.listenersBound = false;
      if (err) {
        this.recordError(`连接断开: ${err.message}`);
      }
      if (this.config.enabled) {
        this.status = 'reconnecting';
      } else {
        this.status = 'disconnected';
      }
      this.safeEmit('status', this.getStatus());
    });

    this.client.on('offline', () => {
      if (this.destroyed) return;
      if (this.config.enabled) {
        this.status = 'offline';
        this.safeEmit('status', this.getStatus());
      }
    });

    this.client.on('reconnect', () => {
      if (this.destroyed) return;
      this.log.warn('MQTT 正在重连...');
      this.status = 'reconnecting';
      this.safeEmit('status', this.getStatus());
    });
  }

  subscribeAll() {
    if (!this.client || this.destroyed) return;

    const topics = [...new Set(this.config.rules.map((r) => r.subscribeTopic).filter(Boolean))];
    if (topics.length === 0) return;

    topics.forEach((topic) => {
      try {
        this.client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            this.recordError(`订阅失败 ${topic}: ${err.message}`);
          }
        });
      } catch (err) {
        this.recordError(`订阅异常 ${topic}: ${err.message}`);
      }
    });
  }

  handleMessage(topic, payload) {
    if (this.destroyed || !this.client) return;

    try {
      this.stats.received++;
      const matchedRules = this.config.rules.filter((rule) =>
        this.topicMatches(topic, rule.subscribeTopic)
      );

      for (const rule of matchedRules) {
        if (!rule.forwardTopic) continue;
        try {
          const forwardTopic = this.buildForwardTopic(rule.forwardTopic, topic, rule.subscribeTopic);
          this.publishMessage(forwardTopic, payload);
        } catch (err) {
          this.recordError(`转发处理异常: ${err.message}`);
        }
      }
    } catch (err) {
      this.recordError(`消息处理异常: ${err.message}`);
    }
  }

  publishMessage(forwardTopic, payload) {
    if (!this.client || this.destroyed) return;

    this.client.publish(forwardTopic, payload, { qos: 0 }, (err) => {
      if (err) {
        this.recordError(`转发失败 ${forwardTopic}: ${err.message}`);
      } else {
        this.stats.forwarded++;
        this.safeEmit('status', this.getStatus());
      }
    });
  }

  topicMatches(received, pattern) {
    const recParts = received.split('/');
    const patParts = pattern.split('/');

    for (let i = 0; i < patParts.length; i++) {
      const p = patParts[i];
      if (p === '#') return true;
      if (p === '+') continue;
      if (recParts[i] === undefined || recParts[i] !== p) return false;
    }

    return recParts.length === patParts.length || patParts[patParts.length - 1] === '#';
  }

  buildForwardTopic(template, receivedTopic, subscribePattern) {
    if (!template.includes('$topic') && !template.includes('$')) {
      return template;
    }

    const subParts = subscribePattern.split('/');
    const recParts = receivedTopic.split('/');
    const captures = {};

    subParts.forEach((part, i) => {
      if (part === '+') captures[`$${i + 1}`] = recParts[i] || '';
      if (part !== '+' && part !== '#') captures[part] = recParts[i];
    });

    let result = template.replace(/\$topic/g, () => receivedTopic);
    Object.entries(captures).forEach(([key, val]) => {
      result = result.replace(new RegExp(`\\${key}`, 'g'), () => val);
    });

    return result;
  }

  checkHealth() {
    if (this.destroyed || !this.config.enabled) return;

    const needsReconnect = ['disconnected', 'error', 'offline'].includes(this.status);
    const stuckConnecting = this.status === 'connecting' && this.client && !this.client.connected;

    if (needsReconnect || stuckConnecting) {
      this.log.info({ status: this.status }, '健康检查：尝试恢复连接');
      try {
        this.connect();
      } catch (err) {
        this.recordError(`健康恢复失败: ${err.message}`);
      }
    }
  }

  updateConfig(config) {
    const wasEnabled = this.config.enabled;
    this.config = config;

    if (config.enabled) {
      this.connect();
    } else if (wasEnabled) {
      this.disconnect();
      this.status = 'disabled';
      this.safeEmit('status', this.getStatus());
    }
  }

  disconnect(markDisconnected = true) {
    this.listenersBound = false;

    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.end(true);
      } catch (err) {
        this.log.error({ err }, '断开异常');
      }
      this.client = null;
    }

    if (!this.config.enabled) {
      this.status = 'disabled';
    } else if (markDisconnected) {
      this.status = 'disconnected';
    }
  }

  destroy() {
    this.destroyed = true;
    this.disconnect();
  }
}

class MqttManager {
  constructor() {
    this.bridges = new Map();
    this.listeners = new Set();
    this.healthTimer = null;
  }

  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emitEvent(event) {
    this.listeners.forEach((fn) => {
      try {
        fn(event);
      } catch (err) {
        logger.error({ err }, 'SSE 事件推送异常');
      }
    });
  }

  async init(clients) {
    for (let i = 0; i < clients.length; i++) {
      try {
        this.addBridge(clients[i]);
      } catch (err) {
        logger.error({ err, client: clients[i].name || clients[i].id }, '初始化失败');
      }
      if (i < clients.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, STARTUP_STAGGER_MS));
      }
    }
    this.startHealthCheck();
  }

  startHealthCheck() {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      this.bridges.forEach((bridge) => {
        try {
          bridge.checkHealth();
        } catch (err) {
          logger.error({ err, client: bridge.getId() }, '健康检查异常');
        }
      });
    }, HEALTH_CHECK_INTERVAL);
  }

  stopHealthCheck() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  addBridge(config) {
    if (this.bridges.has(config.id)) {
      this.removeBridge(config.id);
    }

    // 从独立规则存储中加载属于该客户端的规则
    const allRules = loadRules();
    config = {
      ...config,
      rules: allRules.filter((r) => r.subscribeClientId === config.id || r.forwardClientId === config.id),
    };

    const bridge = new MqttBridge(config);
    bridge.on('status', (status) => this.emitEvent({ type: 'status', data: status }));
    bridge.on('error', (err) => this.emitEvent({ type: 'error', data: err }));

    this.bridges.set(config.id, bridge);

    if (config.enabled) {
      bridge.connect();
    } else {
      bridge.status = 'disabled';
    }

    return bridge.getStatus();
  }

  removeBridge(id) {
    const bridge = this.bridges.get(id);
    if (bridge) {
      bridge.destroy();
      this.bridges.delete(id);
    }
  }

  updateBridge(config) {
    try {
      // 从独立规则存储中加载属于该客户端的规则
      const allRules = loadRules();
      config = {
        ...config,
        rules: allRules.filter((r) => r.subscribeClientId === config.id || r.forwardClientId === config.id),
      };
      const bridge = this.bridges.get(config.id);
      if (bridge) {
        bridge.updateConfig(config);
        return bridge.getStatus();
      }
      return this.addBridge(config);
    } catch (err) {
      logger.error({ err, client: config.name || config.id }, '更新失败');
      return { id: config.id, status: 'error', stats: { received: 0, forwarded: 0, errors: 1 }, lastError: err.message };
    }
  }

  getAllStatus() {
    return [...this.bridges.values()].map((b) => b.getStatus());
  }

  getStatus(id) {
    const bridge = this.bridges.get(id);
    return bridge ? bridge.getStatus() : null;
  }

  enableAll() {
    let count = 0;
    this.bridges.forEach((bridge) => {
      if (bridge.status !== 'connected' && bridge.status !== 'connecting') {
        bridge.connect();
        count++;
      }
    });
    logger.info({ count }, '已启用所有 MQTT 连接');
    return count;
  }

  disableAll() {
    let count = 0;
    this.bridges.forEach((bridge) => {
      if (bridge.status === 'connected' || bridge.status === 'connecting') {
        bridge.disconnect();
        count++;
      }
    });
    logger.info({ count }, '已禁用所有 MQTT 连接');
    return count;
  }

  shutdown() {
    this.stopHealthCheck();
    this.bridges.forEach((bridge) => {
      try {
        bridge.destroy();
      } catch (err) {
        logger.error({ err, client: bridge.getId() }, '关闭客户端异常');
      }
    });
    this.bridges.clear();
  }
}

export const mqttManager = new MqttManager();
