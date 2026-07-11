import { useState } from 'react';

const emptyRule = () => ({ subscribeTopic: '', forwardTopic: '' });

export function TopicForm({ clients, editingRule, editingClient, onSave, onCancel }) {
  const [rule, setRule] = useState(() => {
    if (editingRule) return { ...editingRule };
    return emptyRule();
  });

  const [selectedClient, setSelectedClient] = useState(editingClient?.id || '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedClient) return;
    onSave(selectedClient, rule);
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
        <h2>{editingRule ? '编辑订阅主题' : '新建订阅主题'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>所属客户端</label>
            <select
              className="form-input"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              required
            >
              <option value="">请选择客户端</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>订阅主题</label>
            <input
              className="form-input"
              value={rule.subscribeTopic}
              onChange={(e) => setRule({ ...rule, subscribeTopic: e.target.value })}
              placeholder="sensor/+/data"
              style={{ fontFamily: 'var(--mono)' }}
              required
            />
          </div>

          <div className="form-group">
            <label>转发主题</label>
            <input
              className="form-input"
              value={rule.forwardTopic}
              onChange={(e) => setRule({ ...rule, forwardTopic: e.target.value })}
              placeholder="forward/$topic"
              style={{ fontFamily: 'var(--mono)' }}
              required
            />
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0 0' }}>
            支持 MQTT 通配符：+ 匹配单层，# 匹配多层。转发主题可用 $topic 引用原始主题。
          </p>

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="btn-primary">{editingRule ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
