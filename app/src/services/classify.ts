import { listCategoryRules, putCategoryRule } from './db';
import type { CategoryRule } from './types';

const DEFAULT_RULES: Array<{ keyword: string; category: string }> = [
  { keyword: '美团', category: '餐饮' },
  { keyword: '饿了么', category: '餐饮' },
  { keyword: '肯德基', category: '餐饮' },
  { keyword: '麦当劳', category: '餐饮' },
  { keyword: '星巴克', category: '餐饮' },
  { keyword: '瑞幸', category: '餐饮' },
  { keyword: '食堂', category: '餐饮' },
  { keyword: '外卖', category: '餐饮' },
  { keyword: '滴滴', category: '交通' },
  { keyword: '高德打车', category: '交通' },
  { keyword: '地铁', category: '交通' },
  { keyword: '公交', category: '交通' },
  { keyword: '加油', category: '交通' },
  { keyword: '停车', category: '交通' },
  { keyword: '盒马', category: '日用' },
  { keyword: '超市', category: '日用' },
  { keyword: '便利店', category: '日用' },
  { keyword: '京东', category: '购物' },
  { keyword: '淘宝', category: '购物' },
  { keyword: '天猫', category: '购物' },
  { keyword: '拼多多', category: '购物' },
  { keyword: '电影', category: '娱乐' },
  { keyword: '视频', category: '娱乐' },
  { keyword: '游戏', category: '娱乐' },
  { keyword: '医院', category: '医疗' },
  { keyword: '药店', category: '医疗' },
  { keyword: '房租', category: '居住' },
  { keyword: '水电', category: '居住' },
  { keyword: '物业', category: '居住' },
  { keyword: '工资', category: '工资' },
  { keyword: '转账', category: '转账' },
  { keyword: '红包', category: '社交' },
];

let seeded = false;

export async function ensureDefaultCategoryRules(): Promise<void> {
  if (seeded) return;
  const existing = await listCategoryRules();
  if (existing.length === 0) {
    const now = Date.now();
    for (const [i, rule] of DEFAULT_RULES.entries()) {
      await putCategoryRule({
        id: `default-${i}-${rule.keyword}`,
        keyword: rule.keyword,
        category: rule.category,
        createdAt: now,
      });
    }
  }
  seeded = true;
}

export async function classifyMerchant(merchant: string, rawBody = ''): Promise<string> {
  await ensureDefaultCategoryRules();
  const rules = await listCategoryRules();
  const blob = `${merchant}\n${rawBody}`;
  // User rules first (non-default ids), then defaults — longer keyword wins
  const sorted = [...rules].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const rule of sorted) {
    if (rule.keyword && blob.includes(rule.keyword)) {
      return rule.category;
    }
  }
  return '未分类';
}

export async function learnCategoryFromUser(merchant: string, category: string): Promise<CategoryRule> {
  const keyword = merchant.trim().slice(0, 20);
  const rule: CategoryRule = {
    id: `user-${Date.now()}-${keyword}`,
    keyword: keyword || category,
    category,
    createdAt: Date.now(),
  };
  await putCategoryRule(rule);
  return rule;
}

export const CATEGORY_OPTIONS = [
  '餐饮',
  '交通',
  '日用',
  '购物',
  '娱乐',
  '医疗',
  '居住',
  '工资',
  '转账',
  '社交',
  '未分类',
  '其他',
];
