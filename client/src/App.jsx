import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchClients,
  createClient,
  updateClient,
  deleteClient,
  deleteClientsBatch,
  toggleClient,
  subscribeEvents,
  exportClients,
  importClients,
} from './api';
import { ClientListRow } from './ClientListRow';
import { ClientForm } from './ClientForm';
import { TopicForm } from './TopicForm';
import { SystemDashboard } from './SystemDashboard';
import './App.css';

export default function App() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [topicFormOpen, setTopicFormOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState(null);
  const [editingTopicClient, setEditingTopicClient] = useState(null);
  const [editingTopicItems, setEditingTopicItems] = useState(null);
  const [editingTopicGroupName, setEditingTopicGroupName] = useState('');
  const [editingTopicConditions, setEditingTopicConditions] = useState(null);
  const [selectedTopicIds, setSelectedTopicIds] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const headerCheckRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const data = await fetchClients();
      setClients(data);
      setSelectedIds((prev) => {
        const next = new Set();
        const idSet = new Set(data.map((c) => c.id));
        prev.forEach((id) => {
          if (idSet.has(id)) next.add(id);
        });
        return next;
      });
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = subscribeEvents((event) => {
      if (event.type === 'status') {
        const statuses = Array.isArray(event.data) ? event.data : [event.data];
        setClients((prev) =>
          prev.map((c) => {
            const s = statuses.find((st) => st.id === c.id);
            return s ? { ...c, runtime: s } : c;
          })
        );
      }
    });
    return unsubscribe;
  }, [load]);

  const handleSave = async (data) => {
    try {
      if (editingClient) {
        await updateClient(editingClient.id, data);
        showToast('客户端已更新');
      } else {
        await createClient(data);
        showToast('客户端已创建');
      }
      setFormOpen(false);
      setEditingClient(null);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleTopicSave = async (rules, oldGroupName, conditions) => {
    try {
      // 如果是在编辑，先删除旧组的规则
      if (oldGroupName) {
        for (const c of clients) {
          const remaining = c.rules.filter((r) => r.groupName !== oldGroupName || !r.groupName);
          if (remaining.length !== c.rules.length) {
            await updateClient(c.id, { ...c, rules: remaining });
          }
        }
      }
      // 按客户端分组保存新规则
      const grouped = {};
      for (const rule of rules) {
        if (!grouped[rule.subscribeClientId]) grouped[rule.subscribeClientId] = [];
        grouped[rule.subscribeClientId].push({ ...rule, conditions: conditions || null });
      }
      for (const [clientId, clientRules] of Object.entries(grouped)) {
        const client = clients.find((c) => c.id === clientId);
        if (!client) continue;
        // 编辑模式下需保留不在旧组中的其他规则
        const existing = client.rules.filter((r) => r.groupName !== oldGroupName || !r.groupName);
        await updateClient(clientId, {
          ...client,
          rules: [...existing, ...clientRules],
        });
      }
      showToast(`已保存 ${rules.length} 条订阅主题`);
      setTopicFormOpen(false);
      setEditingTopic(null);
      setEditingTopicClient(null);
      setEditingTopicItems(null);
      setEditingTopicGroupName('');
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleTopicSelect = (topicKey, checked) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(topicKey);
      else next.delete(topicKey);
      return next;
    });
  };

  const handleTopicSelectAll = () => {
    const allKeys = [];
    const groups = {};
    for (const c of clients) {
      for (const r of c.rules) {
        if (!r.subscribeTopic) continue;
        const gk = r.groupName || `${c.id}-${r.subscribeTopic}`;
        if (!groups[gk]) {
          groups[gk] = true;
          allKeys.push(gk);
        }
      }
    }
    setSelectedTopicIds((prev) => prev.size === allKeys.length ? new Set() : new Set(allKeys));
  };

  const handleTopicBatchDelete = async () => {
    if (selectedTopicIds.size === 0) return;
    try {
      // 收集要删除的规则（按客户端分组）
      const toDelete = {};
      for (const gk of selectedTopicIds) {
        for (const c of clients) {
          for (const r of c.rules) {
            if (!r.subscribeTopic) continue;
            const ruleGk = r.groupName || `${c.id}-${r.subscribeTopic}`;
            if (ruleGk === gk) {
              if (!toDelete[c.id]) toDelete[c.id] = new Set();
              toDelete[c.id].add(r.subscribeTopic);
            }
          }
        }
      }
      for (const [clientId, topics] of Object.entries(toDelete)) {
        const client = clients.find((c) => c.id === clientId);
        if (!client) continue;
        const remaining = client.rules.filter((r) => !topics.has(r.subscribeTopic));
        await updateClient(clientId, { ...client, rules: remaining });
      }
      showToast(`已删除 ${selectedTopicIds.size} 组订阅`);
      setSelectedTopicIds(new Set());
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleTopicGroupDelete = async (groupKey) => {
    try {
      for (const c of clients) {
        const remaining = c.rules.filter((r) => {
          const gk = r.groupName || `${c.id}-${r.subscribeTopic}`;
          return gk !== groupKey;
        });
        if (remaining.length !== c.rules.length) {
          await updateClient(c.id, { ...c, rules: remaining });
        }
      }
      showToast('已删除该组订阅');
      setSelectedTopicIds(new Set());
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleDelete = async (client) => {
    if (!confirm(`确定删除客户端「${client.name}」？`)) return;
    try {
      await deleteClient(client.id);
      showToast('客户端已删除');
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleToggle = async (id) => {
    try {
      await toggleClient(id);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleSelect = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (clients.length === 0) return;
    const allSelected = selectedIds.size === clients.length;
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(clients.map((c) => c.id)));
    }
  };

  const handleBatchDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      showToast('请先勾选要删除的客户端', true);
      return;
    }
    if (!confirm(`确定删除选中的 ${ids.length} 个客户端？`)) return;
    try {
      const result = await deleteClientsBatch(ids);
      showToast(`已删除 ${result.deleted} 个客户端`);
      setSelectedIds(new Set());
      load();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleExport = () => {
    exportClients();
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await importClients(file);
      showToast(`导入完成：新增 ${result.added} 个，更新 ${result.updated} 个`);
      load();
    } catch (err) {
      showToast(err.message, true);
    }
    e.target.value = '';
  };

  const openCreate = () => {
    setEditingClient(null);
    setFormOpen(true);
  };

  const openEdit = (client) => {
    setEditingClient(client);
    setFormOpen(true);
  };

  const allSelected = clients.length > 0 && selectedIds.size === clients.length;
  const someSelected = selectedIds.size > 0;

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  return (
    <div className="app">
      <header className="header">
        <div className="page-container">
          <div className="header-top">
            <div>
              <h1>MQTT Center</h1>
              <p className="subtitle">独立 MQTT 客户端管理与主题转发</p>
            </div>
          </div>
          <SystemDashboard clients={clients} />
          <div className="toolbar-row">
            <button type="button" className="btn-secondary btn-sm" onClick={handleExport}>导出</button>
            <button type="button" className="btn-secondary btn-sm" onClick={handleImportClick}>导入</button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
        </div>
      </header>

      <main className="main">
        <div className="page-container">
          <section className="section-container">
            <div className="section-header">
              <h2 className="section-title">MQTT 客户端列表</h2>
              <div className="section-header-actions">
                <button type="button" className="btn-primary btn-sm" onClick={openCreate}>+ 新建</button>
                {clients.length > 0 && (
                  <>
                    <button type="button" className="btn-secondary btn-sm" onClick={handleSelectAll}>
                      {allSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={handleBatchDelete}
                      disabled={!someSelected}
                    >
                      删除{someSelected ? ` (${selectedIds.size})` : ''}
                    </button>
                  </>
                )}
              </div>
            </div>
            {loading ? (
              <div className="empty-state">加载中...</div>
            ) : clients.length === 0 ? (
              <div className="empty-state"></div>
            ) : (
              <div className="client-table-wrap">
                <table className="client-table">
                  <thead>
                    <tr>
                      <th className="col-check">
                        <input
                          ref={headerCheckRef}
                          type="checkbox"
                          className="row-checkbox"
                          checked={allSelected}
                          onChange={handleSelectAll}
                          aria-label="全选"
                        />
                      </th>
                      <th>序号</th>
                      <th>名称</th>
                      <th>IP</th>
                      <th>端口</th>
                      <th>Client ID</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c, i) => (
                      <ClientListRow
                        key={c.id}
                        index={i + 1}
                        client={c}
                        selected={selectedIds.has(c.id)}
                        onSelect={handleSelect}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                        onToggle={handleToggle}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section-container">
            <div className="section-header">
              <h2 className="section-title">订阅主题</h2>
              <div className="section-header-actions">
                <button type="button" className="btn-primary btn-sm" onClick={() => { setEditingTopic(null); setEditingTopicClient(null); setTopicFormOpen(true); }}>+ 新建</button>
                {(() => {
                  const groupKeys = [];
                  const groups = {};
                  for (const c of clients) {
                    for (const r of c.rules) {
                      if (!r.subscribeTopic) continue;
                      const gk = r.groupName || `${c.id}-${r.subscribeTopic}`;
                      if (!groups[gk]) {
                        groups[gk] = true;
                        groupKeys.push(gk);
                      }
                    }
                  }
                  const allSelected = groupKeys.length > 0 && selectedTopicIds.size === groupKeys.length;
                  const someSelected = selectedTopicIds.size > 0;
                  return groupKeys.length > 0 ? (
                    <>
                      <button type="button" className="btn-secondary btn-sm" onClick={handleTopicSelectAll}>
                        {allSelected ? '取消全选' : '全选'}
                      </button>
                      <button type="button" className="btn-danger btn-sm" onClick={handleTopicBatchDelete} disabled={!someSelected}>
                        删除{someSelected ? ` (${selectedTopicIds.size})` : ''}
                      </button>
                    </>
                  ) : null;
                })()}
              </div>
            </div>
            {clients.length === 0 ? (
              <div className="empty-state-mini"></div>
            ) : (
              (() => {
                const groups = {};
                for (const c of clients) {
                  for (const r of c.rules) {
                    if (!r.subscribeTopic) continue;
                    const gk = r.groupName || `${c.id}-${r.subscribeTopic}`;
                    if (!groups[gk]) groups[gk] = { name: r.groupName || '', items: [] };
                    groups[gk].items.push({ rule: r, client: c });
                  }
                }
                const entries = Object.entries(groups);
                if (entries.length === 0) return <div className="empty-state-mini"></div>;
                return (
                   <div className="client-table-wrap">
                     <table className="client-table">
                       <thead>
                         <tr>
                            <th className="col-check"></th>
                            <th>主题名称</th>
                            <th>订阅主题</th>
                            <th>订阅客户端</th>
                            <th>转发主题</th>
                            <th>转发客户端</th>
                            <th>规则</th>
                            <th>操作</th>
                          </tr>
                       </thead>
                       <tbody>
                          {entries.map(([gk, { name, items }]) => {
                            const isGrouped = !!name;
                            const groupKey = isGrouped ? gk : items[0]?.rule?.subscribeTopic || gk;
                            const checked = selectedTopicIds.has(groupKey);
                            return (
                              <tr key={gk} className={selectedTopicIds.has(groupKey) ? 'row-selected' : ''}>
                                <td className="col-check" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    className="row-checkbox"
                                    checked={checked}
                                    onChange={(e) => handleTopicSelect(groupKey, e.target.checked)}
                                  />
                                </td>
                                <td>{isGrouped ? name : '-'}</td>
                                <td className="col-topic">
                                  {items.map(({ rule, client }, idx) => (
                                    <div key={idx} className="cell-line">{rule.subscribeTopic}</div>
                                  ))}
                                </td>
                                <td>
                                  {items.map(({ rule, client }, idx) => {
                                    const subName = rule.subscribeClientId ? (clients.find(cc => cc.id === rule.subscribeClientId)?.name || client.name) : client.name;
                                    return <div key={idx} className="cell-line">{subName}</div>;
                                  })}
                                </td>
                                <td className="col-topic">
                                  {items.map(({ rule, client }, idx) => (
                                    <div key={idx} className="cell-line">{rule.forwardTopic}</div>
                                  ))}
                                </td>
                                <td>
                                  {items.map(({ rule, client }, idx) => {
                                    const fwdName = rule.forwardClientId ? (clients.find(cc => cc.id === rule.forwardClientId)?.name || client.name) : client.name;
                                    return <div key={idx} className="cell-line">{fwdName}</div>;
                                  })}
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  {(() => {
                                    const hasRules = items.some(({ rule }) => rule.conditions && rule.conditions.items && rule.conditions.items.length > 0 && rule.conditions.items[0]?.type !== 'always');
                                    return hasRules
                                      ? <span style={{ color: '#22c55e', fontWeight: 600 }}>有</span>
                                      : <span style={{ color: 'var(--text-muted)' }}>无</span>;
                                  })()}
                                </td>
                                <td className="col-actions">
                                   <button className="btn-secondary btn-sm" onClick={() => {
                                     setEditingTopicItems(items.map(({ rule }) => rule));
                                     setEditingTopicGroupName(name);
                                     setEditingTopicConditions(items[0]?.rule?.conditions || null);
                                     setTopicFormOpen(true);
                                   }}>编辑</button>
                                   <button className="btn-danger btn-sm" onClick={() => handleTopicGroupDelete(groupKey)} style={{ marginLeft: 4 }}>删除</button>
                                 </td>
                              </tr>
                            );
                          })}
                        </tbody>
                     </table>
                   </div>
                );
              })()
            )}
          </section>
        </div>
      </main>

      {formOpen && (
        <ClientForm
          client={editingClient}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditingClient(null); }}
        />
      )}

      {topicFormOpen && (
        <TopicForm
          clients={clients}
          editingItems={editingTopicItems}
          editingGroupName={editingTopicGroupName}
          editingConditions={editingTopicConditions}
          onSave={handleTopicSave}
          onCancel={() => { setTopicFormOpen(false); setEditingTopic(null); setEditingTopicClient(null); setEditingTopicItems(null); setEditingTopicGroupName(''); setEditingTopicConditions(null); }}
        />
      )}

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}
