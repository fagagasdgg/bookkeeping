import { useEffect, useState } from 'react';
import { formatYuan } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { CATEGORY_OPTIONS } from '../../services/classify';
import { listSourcesByTxn } from '../../services/db';
import { subscribeDataChange } from '../../services/events';
import { updateTxnCategory } from '../../services/reviewActions';
import { searchTransactions } from '../../services/stats';
import type { Transaction, TransactionSource } from '../../services/types';
import { toast } from '../common/AppToast';

export function LedgerScreen() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [sources, setSources] = useState<TransactionSource[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await searchTransactions(query);
      if (alive) setItems(rows);
    };
    void load();
    return subscribeDataChange(() => void load());
  }, [query]);

  useEffect(() => {
    if (!selected) {
      setSources([]);
      return;
    }
    void listSourcesByTxn(selected.id).then(setSources);
  }, [selected]);

  return (
    <div className="screen ledger-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">流水明细</p>
          <h1>记账列表</h1>
        </div>
      </header>

      <div className="search-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索商户、分类、原文…"
          aria-label="搜索流水"
        />
      </div>

      <div className="ledger-layout">
        <section className="panel list-panel">
          {items.length === 0 ? (
            <p className="muted">还没有流水。去「来源」页开启通知或检索短信。</p>
          ) : (
            <ul className="txn-list">
              {items.map((txn) => (
                <li key={txn.id}>
                  <button
                    type="button"
                    className={selected?.id === txn.id ? 'txn-row active' : 'txn-row'}
                    onClick={() => setSelected(txn)}
                  >
                    <div>
                      <strong>{txn.merchant}</strong>
                      <p className="muted small">
                        {txn.category} · {formatDateTime(txn.occurredAt)} ·{' '}
                        {txn.primaryChannel === 'sms' ? '短信' : '通知'}
                        {txn.status !== 'confirmed' ? ` · ${statusLabel(txn.status)}` : ''}
                      </p>
                    </div>
                    <strong className={txn.direction === 'expense' ? 'amt expense' : 'amt income'}>
                      {txn.direction === 'expense' ? '-' : '+'}¥{formatYuan(txn.amountCents)}
                    </strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel detail-panel">
          {!selected ? (
            <p className="muted">选择一笔流水查看详情、改分类或查看来源证据。</p>
          ) : (
            <div className="detail">
              <h2>{selected.merchant}</h2>
              <p className="detail-amt">
                {selected.direction === 'expense' ? '支出' : '收入'} ¥{formatYuan(selected.amountCents)}
              </p>
              <p className="muted">{formatDateTime(selected.occurredAt)}</p>

              <label className="field">
                <span>分类</span>
                <select
                  value={selected.category}
                  onChange={async (e) => {
                    const category = e.target.value;
                    await updateTxnCategory(selected, category);
                    setSelected({ ...selected, category, status: 'confirmed' });
                    toast('已更新分类，并写入本地规则');
                  }}
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <h3>关联来源</h3>
              {sources.length === 0 ? (
                <p className="muted">无来源记录</p>
              ) : (
                <ul className="source-evidence">
                  {sources.map((s) => (
                    <li key={s.id}>
                      <div className="chip-row">
                        <span className="chip">{s.channel === 'sms' ? '短信' : '通知'}</span>
                        <span className="muted small">{s.packageOrAddress}</span>
                      </div>
                      {s.title ? <p className="small">{s.title}</p> : null}
                      <pre className="raw-body">{s.rawBody}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function statusLabel(status: Transaction['status']): string {
  if (status === 'needs_review') return '待确认';
  if (status === 'parse_failed') return '解析失败';
  return '已确认';
}
