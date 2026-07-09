import { useState, useEffect, useRef } from 'react';

const emptyRule = () => ({ subscribeTopic: '', forwardTopic: '' });

const emptyForm = () => ({
  name: '',
  enabled: true,
  broker: { host: '127.0.0.1', port: 1883, username: '', password: '', clientId: '' },
  rules: [emptyRule()],
});

export function ClientForm({ client, onSave, onCancel }) {
  const nameInputRef = useRef(null);

  const [form, setForm] = useState(() => {
    if (client) {
      return {
        name: client.name,
        enabled: client.enabled,
        broker: { ...client.broker, password: '' },
        rules: client.rules.length ? [...client.rules] : [emptyRule()],
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

  const updateRule = (index, field, value) => {
    setForm((prev) => {
      const rules = [...prev.rules];
      rules[index] = { ...rules[index], [field]: value };
      return { ...prev, rules };
    });
  };

  const handlePortChange = (value) => {
    const digits = value.replace(/\D/g, '');
    update('broker.port', digits === '' ? '' : Number(digits));
  };

  const addRule = () => setForm((prev) => ({ ...prev, rules: [...prev.rules, emptyRule()] }));

  const removeRule = (index) => {
    setForm((prev) => ({
      ...prev,
      rules: prev.rules.length > 1 ? prev.rules.filter((_, i) => i !== index) : prev.rules,
    }));
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

          <h3 style={{ fontSize: 14, color: 'var(--text-muted)', margin: '20px 0 12px' }}>主题转发规则</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            支持 MQTT 通配符：+ 匹配单层，# 匹配多层。转发主题可用 $topic 引用原始主题。
          </p>

          {form.rules.map((rule, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 12 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>订阅主题</label>
                <input className="form-input" value={rule.subscribeTopic} onChange={(e) => updateRule(i, 'subscribeTopic', e.target.value)} placeholder="sensor/+/data" style={{ fontFamily: 'var(--mono)' }} required />
              </div>
              <div style={{ padding: '0 4px 10px', color: 'var(--text-muted)' }}>→</div>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>转发主题</label>
                <input className="form-input" value={rule.forwardTopic} onChange={(e) => updateRule(i, 'forwardTopic', e.target.value)} placeholder="forward/$topic" style={{ fontFamily: 'var(--mono)' }} required />
              </div>
              <button type="button" className="btn-danger btn-sm" onClick={() => removeRule(i)} style={{ marginBottom: 2 }} disabled={form.rules.length <= 1}>
                删除
              </button>
            </div>
          ))}

          <button type="button" className="btn-secondary btn-sm" onClick={addRule}>
            + 添加规则
          </button>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="btn-primary">{client ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
