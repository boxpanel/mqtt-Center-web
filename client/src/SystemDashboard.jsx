import { useState, useEffect } from 'react';
import { fetchSystemMetrics } from './api';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function getBarColor(percent) {
  if (percent >= 90) return 'var(--danger)';
  if (percent >= 70) return 'var(--warning)';
  return 'var(--primary)';
}

function MetricCard({ label, percent, detail, icon }) {
  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-icon">{icon}</span>
        <span className="metric-label">{label}</span>
        <span className="metric-percent" style={{ color: getBarColor(percent) }}>
          {percent}%
        </span>
      </div>
      <div className="metric-bar">
        <div
          className="metric-bar-fill"
          style={{ width: `${Math.min(percent, 100)}%`, background: getBarColor(percent) }}
        />
      </div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}

function ClientStatCard({ total, connected, disabled, notForwarded }) {
  return (
    <div className="metric-card client-stat-card">
      <div className="stat-rows">
        <div className="stat-row">
          <span className="stat-label">总数量</span>
          <span className="stat-value">{total}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label stat-connected">已连接</span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{connected}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label stat-disabled">已禁用</span>
          <span className="stat-value" style={{ color: 'var(--danger)' }}>{disabled}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">未转发</span>
          <span className="stat-value" style={{ color: '#f59e0b' }}>{notForwarded}</span>
        </div>
      </div>
    </div>
  );
}

export function SystemDashboard({ clients }) {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(false);

  const total = clients?.length || 0;
  const connected = clients?.filter((c) => c.runtime?.status === 'connected').length || 0;
  const disabled = clients?.filter((c) => !c.enabled).length || 0;
  const notForwarded = clients?.reduce((sum, c) => {
    const received = c.runtime?.stats?.received || 0;
    const forwarded = c.runtime?.stats?.forwarded || 0;
    return sum + Math.max(0, received - forwarded);
  }, 0) || 0;

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await fetchSystemMetrics();
        if (active) {
          setMetrics(data);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };

    load();
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (error && !metrics) {
    return (
      <div className="system-dashboard">
        <div className="dashboard-error">无法获取系统资源信息</div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="system-dashboard">
        <div className="dashboard-loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="system-dashboard">
      <div className="metric-grid">
        <MetricCard
          label="CPU"
          percent={metrics.cpu.percent}
          detail={`${metrics.cpu.cores} 核心 · 使用率 ${metrics.cpu.percent}%`}
          icon="⚡"
        />
        <MetricCard
          label="内存"
          percent={metrics.memory.percent}
          detail={`${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`}
          icon="🧠"
        />
        <MetricCard
          label="存储"
          percent={metrics.disk.percent}
          detail={`${formatBytes(metrics.disk.used)} / ${formatBytes(metrics.disk.total)}`}
          icon="💾"
        />
        <ClientStatCard
          total={total}
          connected={connected}
          disabled={disabled}
          notForwarded={notForwarded}
        />
      </div>
    </div>
  );
}
