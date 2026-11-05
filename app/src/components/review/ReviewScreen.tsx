import { useEffect, useState } from 'react';
import { formatYuan } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { getTransaction } from '../../services/db';
import { subscribeDataChange } from '../../services/events';
import {
  confirmDistinct,
  getOpenReviews,
  mergeReviewIntoExisting,
} from '../../services/reviewActions';
import type { ReviewItem, Transaction } from '../../services/types';
import { toast } from '../common/AppToast';

export function ReviewScreen() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [details, setDetails] = useState<Record<string, { candidate?: Transaction; existing?: Transaction }>>({});

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await getOpenReviews();
      if (!alive) return;
      setItems(rows);
      const map: Record<string, { candidate?: Transaction; existing?: Transaction }> = {};
      for (const r of rows) {
        map[r.id] = {
          candidate: r.candidateTxnId ? await getTransaction(r.candidateTxnId) : undefined,
          existing: r.existingTxnId ? await getTransaction(r.existingTxnId) : undefined,
        };
      }
      if (alive) setDetails(map);
    };
    void load();
    return subscribeDataChange(() => void load());
  }, []);

  return (
    <div className="screen review-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">待确认</p>
          <h1>解析失败与疑似重复</h1>
        </div>
      </header>

      {items.length === 0 ? (
        <section className="panel">
          <p className="muted">没有待办。高置信重复会自动合并；说不清的才会出现在这里。</p>
        </section>
      ) : (
        <ul className="review-list">
          {items.map((item) => {
            const d = details[item.id] ?? {};
            return (
              <li key={item.id} className="panel review-card">
                <div className="chip-row">
                  <span className="chip">{item.kind === 'parse_failed' ? '解析失败' : '疑似重复'}</span>
                  {item.amountCents != null ? <span>¥{formatYuan(item.amountCents)}</span> : null}
                </div>
                <pre className="raw-body">{item.rawPreview}</pre>
                {item.kind === 'suspected_duplicate' ? (
                  <div className="compare">
                    <div>
                      <h3>新记录</h3>
                      <p>{d.candidate?.merchant ?? item.merchant ?? '—'}</p>
                      <p className="muted small">
                        {d.candidate ? formatDateTime(d.candidate.occurredAt) : item.occurredAt ? formatDateTime(item.occurredAt) : '—'}
                      </p>
                    </div>
                    <div>
                      <h3>已有记录</h3>
                      <p>{d.existing?.merchant ?? '—'}</p>
                      <p className="muted small">
                        {d.existing ? formatDateTime(d.existing.occurredAt) : '—'}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="btn-row">
                  {item.kind === 'suspected_duplicate' ? (
                    <>
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={async () => {
                          await mergeReviewIntoExisting(item);
                          toast('已合并为同一笔流水');
                        }}
                      >
                        合并为同一笔
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={async () => {
                          await confirmDistinct(item);
                          toast('已标记为两笔不同消费');
                        }}
                      >
                        这是两笔
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={async () => {
                        await confirmDistinct(item);
                        toast('已忽略该解析失败项');
                      }}
                    >
                      忽略
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
