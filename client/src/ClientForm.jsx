import { useState, useEffect, useRef } from 'react';

const emptyForm = () => ({
  name: '',
  enabled: true,
  broker: { host: '127.0.0.1', port: 1883, username: '', password: '', clientId: '' },
});

export function ClientForm({ client, onSave, onCancel }) {
  const nameInputRef = useRef(null);

  const [form, setForm] = useState(() => {
    if (client) {
      return {
        name: client.name,
        enabled: client.enabled,
        broker: { ...client.broker, password: '' },
      };
    }
    return emptyForm();
  });

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const update = (path, value) => {
    setForm((prev) => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  };

  const handlePortChange = (value) => {
    const digits = value.replace(/\D/g, '');
    update('broker.port', digits === '' ? '' : Number(digits));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = {
      ...form,
      broker: {
        ...form.broker,
        port: Number(form.broker.port) || 1883,
      },
    };
    if (client && !payload.broker.password) {
      payload.broker.password = '******';
    }
    onSave(payload);
  };

  const handleOverlayMouseDown = (e) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={handleOverlayMouseDown}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{client ? '编辑客户端' : '新建 MQTT 客户端'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>名称</label>
            <input
              ref={nameInputRef}
              className="form-input"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="例如：传感器数据转发"
              required
            />
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} style={{ width: 'auto' }} />
              启用客户端
            </label>
          </div>

          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>Broker 连接</h3>
          <div className="form-row">
            <div className="form-group">
              <label>地址</label>
              <input className="form-input" value={form.broker.host} onChange={(e) => update('broker.host', e.target.value)} placeholder="127.0.0.1" required />
            </div>
            <div className="form-group">
              <label>端口</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                value={form.broker.port}
                onChange={(e) => handlePortChange(e.target.value)}
                placeholder="1883"
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>用户名（可选）</label>
              <input className="form-input" value={form.broker.username} onChange={(e) => update('broker.username', e.target.value)} />
            </div>
            <div className="form-group">
              <label>密码（可选）</label>
              <input className="form-input" type="password" value={form.broker.password} onChange={(e) => update('broker.password', e.target.value)} placeholder={client ? '留空保持不变' : ''} />
            </div>
          </div>
          <div className="form-group">
            <label>Client ID（可选，留空自动生成）</label>
            <input className="form-input" value={form.broker.clientId} onChange={(e) => update('broker.clientId', e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="btn-primary">{client ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
