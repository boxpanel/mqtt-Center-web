import { useState } from 'react';

const emptyRule = () => ({
  subscribeTopic: '',
  forwardTopic: '',
  subscribeClientId: '',
  forwardClientId: '',
});

const CONDITION_TYPES = [
  { value: 'always', label: '无条件（始终转发）' },
  { value: 'body_contains', label: '消息体包含' },
  { value: 'body_equals', label: '消息体等于' },
  { value: 'body_regex', label: '消息体正则匹配' },
  { value: 'qos', label: 'QoS 等于' },
  { value: 'json_field', label: 'JSON 字段满足条件' },
];

const emptyCondition = () => ({ type: 'always', field: '', operator: '==', value: '' });

export function TopicForm({ clients, editingItems, editingGroupName, editingConditions, onSave, onCancel }) {
  const [groupName, setGroupName] = useState(editingGroupName || '');
  const [rules, setRules] = useState(() => {
    if (editingItems) return editingItems.map((r) => ({ ...r }));
    return [];
  });
  const [form, setForm] = useState(emptyRule());
  const [conditions, setConditions] = useState(() => {
    if (editingConditions) return editingConditions.map((c) => ({ ...c }));
    return [emptyCondition()];
  });
  const [conditionLogic, setConditionLogic] = useState('and'); // 'and' | 'or'

  const addRule = () => {
    if (!form.subscribeTopic.trim() || !form.forwardTopic.trim() || !form.subscribeClientId || !form.forwardClientId) return;
    setRules([...rules, { ...form, groupName: groupName.trim() || '' }]);
    setForm(emptyRule());
  };

  const removeRule = (index) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const updateCondition = (index, updates) => {
    setConditions(conditions.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const addCondition = () => {
    setConditions([...conditions, emptyCondition()]);
  };

  const removeCondition = (index) => {
    setConditions(conditions.length > 1 ? conditions.filter((_, i) => i !== index) : conditions);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (rules.length === 0) return;
    const validConditions = conditions.filter((c) => c.type !== 'always' || conditions.length === 1);
    onSave(
      rules.map((r) => ({ ...r, groupName: groupName.trim() || '' })),
      editingGroupName,
      { logic: conditionLogic, items: validConditions }
    );
  };

  const handleOverlayMouseDown = (e) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      onCancel();
    }
  };

  const clientName = (id) => clients.find((c) => c.id === id)?.name || id;

  return (
    <div className="modal-overlay" onMouseDown={handleOverlayMouseDown}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <h2>{editingItems ? '编辑订阅主题' : '新建订阅主题'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>主题名称</label>
            <input
              className="form-input"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：传感器数据转发"
            />
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>订阅主题</label>
              <input
                className="form-input"
                value={form.subscribeTopic}
                onChange={(e) => setForm({ ...form, subscribeTopic: e.target.value })}
                placeholder="sensor/+/data"
                style={{ fontFamily: 'var(--mono)' }}
              />
            </div>
            <div style={{ padding: '0 2px 10px', color: 'var(--text-muted)', fontSize: 16 }}>→</div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>转发主题</label>
              <input
                className="form-input"
                value={form.forwardTopic}
                onChange={(e) => setForm({ ...form, forwardTopic: e.target.value })}
                placeholder="forward/$topic"
                style={{ fontFamily: 'var(--mono)' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>订阅主题所属客户端</label>
              <select
                className="form-input"
                value={form.subscribeClientId}
                onChange={(e) => setForm({ ...form, subscribeClientId: e.target.value })}
              >
                <option value="">请选择</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>转发主题所属客户端</label>
              <select
                className="form-input"
                value={form.forwardClientId}
                onChange={(e) => setForm({ ...form, forwardClientId: e.target.value })}
              >
                <option value="">请选择</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="button" className="btn-secondary btn-sm" onClick={addRule} style={{ marginTop: 12 }}>
            + 添加至列表
          </button>

          {rules.length > 0 && (
            <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>待保存的订阅列表：</div>
              {rules.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < rules.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                  <div style={{ fontSize: 13 }}>
                    <code style={{ fontFamily: 'var(--mono)', color: 'var(--primary)' }}>{r.subscribeTopic}</code>
                    <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                    <code style={{ fontFamily: 'var(--mono)' }}>{r.forwardTopic}</code>
                    <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>|</span>
                    <span>{clientName(r.subscribeClientId)}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span>
                    <span>{clientName(r.forwardClientId)}</span>
                  </div>
                  <button type="button" className="btn-danger btn-sm" onClick={() => removeRule(i)}>删除</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>设置规则内容</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              设置转发条件，满足条件时才执行转发。不添加条件则直接转发。
            </p>

            {conditions.map((cond, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                {i > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', minWidth: 30, textAlign: 'center' }}>
                    {conditionLogic === 'and' ? '且' : '或'}
                  </span>
                )}
                <select
                  className="form-input"
                  value={cond.type}
                  onChange={(e) => updateCondition(i, { type: e.target.value, field: '', value: '' })}
                  style={{ width: 170, fontSize: 12 }}
                >
                  {CONDITION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                {cond.type === 'json_field' && (
                  <>
                    <input
                      className="form-input"
                      value={cond.field}
                      onChange={(e) => updateCondition(i, { field: e.target.value })}
                      placeholder="字段名, 如 temperature"
                      style={{ width: 140, fontSize: 12, fontFamily: 'var(--mono)' }}
                    />
                    <select
                      className="form-input"
                      value={cond.operator}
                      onChange={(e) => updateCondition(i, { operator: e.target.value })}
                      style={{ width: 60, fontSize: 12 }}
                    >
                      <option value="==">==</option>
                      <option value="!=">!=</option>
                      <option value=">">&gt;</option>
                      <option value="<">&lt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<=">&lt;=</option>
                    </select>
                  </>
                )}

                {(cond.type === 'body_contains' || cond.type === 'body_equals' || cond.type === 'body_regex' || cond.type === 'json_field') && (
                  <input
                    className="form-input"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder={cond.type === 'body_regex' ? '正则表达式' : '匹配值'}
                    style={{ width: 140, fontSize: 12, fontFamily: 'var(--mono)' }}
                  />
                )}

                {cond.type === 'qos' && (
                  <select
                    className="form-input"
                    value={cond.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    style={{ width: 80, fontSize: 12 }}
                  >
                    <option value="0">QoS 0</option>
                    <option value="1">QoS 1</option>
                    <option value="2">QoS 2</option>
                  </select>
                )}

                <button type="button" className="btn-danger btn-sm" onClick={() => removeCondition(i)} disabled={conditions.length <= 1}>✕</button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {conditions.length > 1 && (
                <select
                  className="form-input"
                  value={conditionLogic}
                  onChange={(e) => setConditionLogic(e.target.value)}
                  style={{ width: 80, fontSize: 12 }}
                >
                  <option value="and">全部满足</option>
                  <option value="or">满足任一</option>
                </select>
              )}
              <button type="button" className="btn-secondary btn-sm" onClick={addCondition}>
                + 添加条件
              </button>
            </div>
          </div>

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onCancel}>取消</button>
            <button type="submit" className="btn-primary" disabled={rules.length === 0}>{editingItems ? '保存修改' : '保存'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
