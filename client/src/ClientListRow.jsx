import { STATUS_MAP } from './status';

export function ClientListRow({ client, index, selected, onSelect, onEdit, onDelete, onToggle }) {
  const status = STATUS_MAP[client.runtime?.status] || STATUS_MAP.unknown;
  const stats = client.runtime?.stats || { received: 0, forwarded: 0, errors: 0 };

  return (
    <tr className={`client-table-row ${selected ? 'row-selected' : ''}`}>
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="row-checkbox"
          checked={selected}
          onChange={(e) => onSelect(client.id, e.target.checked)}
          aria-label={`选择 ${client.name}`}
        />
      </td>
      <td className="col-index">{index}</td>
      <td className="col-name">{client.name}</td>
      <td className="col-ip">{client.broker.host}</td>
      <td className="col-port">{client.broker.port}</td>
      <td className="col-clientid">
        <code>{client.broker.clientId || <span className="cell-muted">自动生成</span>}</code>
      </td>
      <td className="col-status">
        <span
          className="status-badge"
          style={{ '--status-color': status.color }}
          title={client.runtime?.lastError || ''}
        >
          <span className="status-dot" />
          {status.label}
        </span>
      </td>
      <td className="col-topic">
        {client.rules.map((rule, i) => (
          <div key={i} className="cell-line">
            <code>{rule.subscribeTopic}</code>
          </div>
        ))}
      </td>
      <td className="col-topic">
        {client.rules.map((rule, i) => (
          <div key={i} className="cell-line">
            <code>{rule.forwardTopic}</code>
          </div>
        ))}
      </td>
      <td className="col-num">{stats.received}</td>
      <td className="col-num">{stats.forwarded}</td>
      <td className={`col-num ${stats.errors > 0 ? 'col-error' : ''}`}>{stats.errors}</td>
      <td className="col-actions">
        <button className="btn-secondary btn-sm" onClick={() => onToggle(client.id)}>
          {client.enabled ? '禁用' : '启用'}
        </button>
        <button className="btn-secondary btn-sm" onClick={() => onEdit(client)}>编辑</button>
        <button className="btn-danger btn-sm" onClick={() => onDelete(client)}>删除</button>
      </td>
    </tr>
  );
}
