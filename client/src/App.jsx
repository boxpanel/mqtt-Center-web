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
import { SystemDashboard } from './SystemDashboard';
import './App.css';

export default function App() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
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
        </div>
      </header>

      <main className="main">
        <div className="page-container">
          <section className="section-container">
            <h2 className="section-title">MQTT 客户端列表</h2>
            <div className="content-toolbar">
              <div className="toolbar-left">
                <button type="button" className="btn-primary" onClick={openCreate}>+ 新建</button>
                <button type="button" className="btn-secondary" onClick={handleExport}>导出</button>
                <button type="button" className="btn-secondary" onClick={handleImportClick}>导入</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleImportFile}
                />
              </div>
              {clients.length > 0 && (
                <div className="toolbar-actions">
                  <button type="button" className="btn-secondary" onClick={handleSelectAll}>
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleBatchDelete}
                    disabled={!someSelected}
                  >
                    删除{someSelected ? ` (${selectedIds.size})` : ''}
                  </button>
                </div>
              )}
            </div>
            {loading ? (
              <div className="empty-state">加载中...</div>
            ) : clients.length === 0 ? (
              <div className="empty-state">
                <p>还没有 MQTT 客户端</p>
                <button className="btn-primary" onClick={openCreate}>创建第一个客户端</button>
              </div>
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
                      <th>订阅主题</th>
                      <th>转发主题</th>
                      <th>接收</th>
                      <th>转发</th>
                      <th>错误</th>
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
            <h2 className="section-title">订阅主题</h2>
            <div className="topics-grid">
              {clients.length === 0 ? (
                <div className="empty-state-mini">暂无订阅主题</div>
              ) : (
                (() => {
                  const topicMap = {};
                  for (const c of clients) {
                    for (const r of c.rules) {
                      if (!r.subscribeTopic) continue;
                      if (!topicMap[r.subscribeTopic]) topicMap[r.subscribeTopic] = [];
                      topicMap[r.subscribeTopic].push(c.name);
                    }
                  }
                  return Object.entries(topicMap).map(([topic, names]) => (
                    <div key={topic} className="topic-card">
                      <code className="topic-name">{topic}</code>
                      <span className="topic-clients">{names.join('、')}</span>
                    </div>
                  ));
                })()
              )}
            </div>
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

      {toast && (
        <div className={`toast ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}
