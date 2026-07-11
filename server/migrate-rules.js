import { loadClients, saveClients } from './store.js';
import { loadRules, saveRules } from './store-rules.js';
import logger from './logger.js';

/**
 * 启动时运行：将客户端内嵌的 rules 迁移到独立的 rules.json
 * 并在每个客户端中清空 rules 字段
 */
export function migrateRulesIfNeeded() {
  const rules = loadRules();
  if (rules.length > 0) {
    logger.info({ count: rules.length }, '规则数据已独立存储，跳过迁移');
    return;
  }

  const clients = loadClients();
  let total = 0;

  const extracted = [];
  for (const c of clients) {
    if (c.rules && c.rules.length > 0) {
      for (const r of c.rules) {
        extracted.push({ ...r });
        total++;
      }
      c.rules = [];
    }
  }

  if (extracted.length > 0) {
    saveRules(extracted);
    saveClients(clients);
    logger.info({ count: extracted.length }, '已将规则从客户端迁移到独立存储');
  } else {
    logger.info('没有需要迁移的规则');
  }
}
