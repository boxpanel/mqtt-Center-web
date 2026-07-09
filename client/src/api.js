const API = '/api';

export async function fetchClients() {
  const res = await fetch(`${API}/clients`);
  if (!res.ok) throw new Error('获取客户端列表失败');
  return res.json();
}

export async function fetchSystemMetrics() {
  const res = await fetch(`${API}/system`);
  if (!res.ok) throw new Error('获取系统资源失败');
  return res.json();
}

export async function createClient(data) {
  const res = await fetch(`${API}/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.errors?.join(', ') || '创建失败');
  return json;
}

export async function updateClient(id, data) {
  const res = await fetch(`${API}/clients/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.errors?.join(', ') || '更新失败');
  return json;
}

export async function deleteClient(id) {
  const res = await fetch(`${API}/clients/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('删除失败');
  return res.json();
}

export async function deleteClientsBatch(ids) {
  const res = await fetch(`${API}/clients/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '批量删除失败');
  return json;
}

export async function toggleClient(id) {
  const res = await fetch(`${API}/clients/${id}/toggle`, { method: 'POST' });
  if (!res.ok) throw new Error('切换状态失败');
  return res.json();
}

export function subscribeEvents(onEvent) {
  const es = new EventSource(`${API}/events`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {}
  };
  return () => es.close();
}

export function exportClients() {
  window.open(`${API}/clients/export`, '_blank');
}

export async function importClients(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/clients/import`, {
    method: 'POST',
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || '导入失败');
  return json;
}
