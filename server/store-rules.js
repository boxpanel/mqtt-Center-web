import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(RULES_FILE)) {
    fs.writeFileSync(RULES_FILE, JSON.stringify({ rules: [] }, null, 2));
  }
}

export function loadRules() {
  ensureFile();
  try {
    const raw = fs.readFileSync(RULES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch (err) {
    logger.error({ err }, '读取规则数据失败');
    return [];
  }
}

export function saveRules(rules) {
  ensureFile();
  const tmp = RULES_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ rules }, null, 2));
    fs.renameSync(tmp, RULES_FILE);
  } catch (err) {
    logger.error({ err }, '保存规则数据失败');
    throw err;
  }
}
