import os from 'os';
import { statfs } from 'fs/promises';

function sampleCpu() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }

  return { idle, total };
}

async function getCpuUsage() {
  const first = sampleCpu();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const second = sampleCpu();

  const idleDiff = second.idle - first.idle;
  const totalDiff = second.total - first.total;

  if (totalDiff <= 0) return 0;

  return Math.round(((totalDiff - idleDiff) / totalDiff) * 1000) / 10;
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    total,
    used,
    free,
    percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
  };
}

async function getDiskUsage() {
  const root = process.platform === 'win32'
    ? `${process.env.SystemDrive || 'C:'}\\`
    : '/';

  try {
    const stats = await statfs(root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;

    return {
      total,
      used,
      free,
      percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      mount: root,
    };
  } catch {
    return {
      total: 0,
      used: 0,
      free: 0,
      percent: 0,
      mount: root,
    };
  }
}

export async function getSystemMetrics() {
  const [cpu, memory, disk] = await Promise.all([
    getCpuUsage(),
    Promise.resolve(getMemoryUsage()),
    getDiskUsage(),
  ]);

  return {
    cpu: {
      percent: cpu,
      cores: os.cpus().length,
    },
    memory,
    disk,
    hostname: os.hostname(),
    platform: os.platform(),
    timestamp: new Date().toISOString(),
  };
}
