import cluster from 'cluster';
import { v4 as uuidv4 } from 'uuid';

// ── Worker 端：发送 IPC 请求到主进程 ──

const pending = new Map();

if (cluster.isWorker) {
  process.on('message', (msg) => {
    if (msg.type === 'ipc:response' && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    }
  });
}

/**
 * 工作进程调用主进程的方法（异步 RPC）
 */
export function ipcCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = uuidv4();
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`IPC 调用超时: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (val) => { clearTimeout(timeout); resolve(val); },
      reject: (err) => { clearTimeout(timeout); reject(err); },
    });
    process.send({ type: 'ipc:request', id, method, args });
  });
}

// ── 主进程端：处理来自工作进程的 IPC 请求 ──

/**
 * 主进程注册 IPC 请求处理器
 * @param {Map<string, Function>} handlers - 方法名 → 处理函数
 */
export function setupIpcServer(handlers) {
  const workers = new Set();

  function handleMessage(worker, msg) {
    if (msg.type !== 'ipc:request') return;
    const { id, method, args } = msg;
    const handler = handlers.get(method);
    if (!handler) {
      worker.send({ type: 'ipc:response', id, error: `未知方法: ${method}` });
      return;
    }
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        result
          .then((val) => worker.send({ type: 'ipc:response', id, result: val }))
          .catch((err) => worker.send({ type: 'ipc:response', id, error: err.message }));
      } else {
        worker.send({ type: 'ipc:response', id, result });
      }
    } catch (err) {
      worker.send({ type: 'ipc:response', id, error: err.message });
    }
  }

  return {
    addWorker(worker) {
      workers.add(worker);
      worker.on('message', (msg) => handleMessage(worker, msg));
      worker.on('exit', () => workers.delete(worker));
    },
    broadcast(type, data) {
      const msg = JSON.stringify({ type: 'ipc:event', eventType: type, data });
      workers.forEach((w) => {
        try { w.send({ type: 'ipc:event', eventType: type, data }); } catch {}
      });
    },
    get workerCount() { return workers.size; },
  };
}
