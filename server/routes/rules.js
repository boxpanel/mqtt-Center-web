import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { loadRules, saveRules } from '../store-rules.js';

const router = Router();

// ── 获取所有规则 ──
router.get('/', (req, res) => {
  try {
    const rules = loadRules();
    res.json(rules);
  } catch (err) {
    next(err);
  }
});

// ── 批量保存规则（替换指定 groupName 的所有规则） ──
router.post('/batch', (req, res, next) => {
  try {
    const { rules: newRules, oldGroupName } = req.body;
    if (!Array.isArray(newRules)) {
      return res.status(400).json({ error: 'rules 必须是数组' });
    }

    let allRules = loadRules();
    let removed = 0;

    if (oldGroupName) {
      // 编辑模式：删除旧组的规则
      const before = allRules.length;
      allRules = allRules.filter((r) => r.groupName !== oldGroupName || !r.groupName);
      removed = before - allRules.length;
    }

    // 为新规则分配 ID
    for (const rule of newRules) {
      rule.id = uuidv4();
    }

    allRules.push(...newRules);
    saveRules(allRules);

    res.json({ success: true, count: newRules.length, removed });
  } catch (err) {
    next(err);
  }
});

// ── 按 groupKey 删除规则 ──
router.delete('/group/:groupKey', (req, res, next) => {
  try {
    const { groupKey } = req.params;
    let rules = loadRules();
    const before = rules.length;

    const key = decodeURIComponent(groupKey);
    rules = rules.filter((r) => {
      const gk = r.groupName || `${r.subscribeClientId}-${r.subscribeTopic}`;
      return gk !== key;
    });

    saveRules(rules);
    res.json({ success: true, removed: before - rules.length });
  } catch (err) {
    next(err);
  }
});

// ── 多组批量删除（用于全选删除） ──
router.post('/batch-delete', (req, res, next) => {
  try {
    const { groupKeys } = req.body;
    if (!Array.isArray(groupKeys)) {
      return res.status(400).json({ error: 'groupKeys 必须是数组' });
    }

    let rules = loadRules();
    const before = rules.length;
    const keySet = new Set(groupKeys);

    rules = rules.filter((r) => {
      const gk = r.groupName || `${r.subscribeClientId}-${r.subscribeTopic}`;
      return !keySet.has(gk);
    });

    saveRules(rules);
    res.json({ success: true, removed: before - rules.length });
  } catch (err) {
    next(err);
  }
});

export default router;
