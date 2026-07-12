export const STATUS_MAP = {
  connected: { label: '已连接', color: 'var(--success)' },
  connecting: { label: '连接中', color: 'var(--warning)' },
  reconnecting: { label: '重连中', color: 'var(--warning)' },
  offline: { label: '离线', color: 'var(--danger)' },
  error: { label: '异常', color: 'var(--danger)' },
  disconnected: { label: '已断开', color: 'var(--text-muted)' },
  disabled: { label: '已禁用', color: 'var(--disabled)' },
  unknown: { label: '未知', color: 'var(--text-muted)' },
};