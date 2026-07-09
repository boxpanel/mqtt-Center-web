import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'clients.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ clients: [] }, null, 2));
  }
}

export function loadClients() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.clients) ? parsed.clients : [];
  } catch (err) {
    logger.error({ err }, '读取客户端数据失败，返回空列表');
    return [];
  }
}

export function saveClients(clients) {
  ensureDataFile();
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ clients }, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    logger.error({ err }, '保存客户端数据失败');
    throw err;
  }
}
