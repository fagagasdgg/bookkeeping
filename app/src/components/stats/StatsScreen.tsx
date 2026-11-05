import { useEffect, useMemo, useState } from 'react';
import { formatYuan } from '../../lib/money';
import { formatPeriodLabel, shiftPeriod } from '../../lib/time';
import { subscribeDataChange } from '../../services/events';
import { summarizePeriod } from '../../services/stats';
import type { PeriodKind, PeriodSummary } from '../../services/types';

const PERIODS: Array<{ id: PeriodKind; label: string }> = [
  { id: 'day', label: '日' },
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
];

export function StatsScreen() {
  const [kind, setKind] = useState<PeriodKind>('month');
  const [anchor, setAnchor] = useState(Date.now());
  const [summary, setSummary] = useState<PeriodSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await summarizePeriod(kind, anchor);
      if (alive) setSummary(s);
    };
    void load();
    return subscribeDataChange(() => void load());
  }, [kind, anchor]);

  const maxCat = useMemo(
    () => Math.max(1, ...(summary?.byCategory.map((c) => c.expenseCents) ?? [1])),
    [summary],
  );

  return (
    <div className="screen stats-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">本地统计</p>
          <h1>收支概览</h1>
        </div>
        <div className="period-tabs" role="tablist">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={kind === p.id ? 'tab active' : 'tab'}
              onClick={() => setKind(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="period-nav">
        <button type="button" className="ghost-btn" onClick={() => setAnchor((a) => shiftPeriod(kind, a, -1))}>
          上一段
        </button>
        <strong>{formatPeriodLabel(kind, anchor)}</strong>
        <button type="button" className="ghost-btn" onClick={() => setAnchor((a) => shiftPeriod(kind, a, 1))}>
          下一段
        </button>
      </div>

      <section className="stat-cards">
        <article className="stat-card expense">
          <span>支出</span>
          <strong>¥{formatYuan(summary?.expenseCents ?? 0)}</strong>
        </article>
        <article className="stat-card income">
          <span>收入</span>
          <strong>¥{formatYuan(summary?.incomeCents ?? 0)}</strong>
        </article>
        <article className="stat-card balance">
          <span>结余</span>
          <strong>¥{formatYuan(summary?.balanceCents ?? 0)}</strong>
        </article>
      </section>

      <div className="stats-grid">
        <section className="panel">
          <h2>分类支出</h2>
          {(summary?.byCategory.filter((c) => c.expenseCents > 0) ?? []).length === 0 ? (
            <p className="muted">暂无分类数据。授权通知或检索短信后会出现在这里。</p>
          ) : (
            <ul className="bar-list">
              {summary!.byCategory
                .filter((c) => c.expenseCents > 0)
                .map((c) => (
                  <li key={c.category}>
                    <div className="bar-meta">
                      <span>{c.category}</span>
                      <span>¥{formatYuan(c.expenseCents)}</span>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${(c.expenseCents / maxCat) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>渠道占比</h2>
          {(summary?.byChannel ?? []).length === 0 ? (
            <p className="muted">暂无渠道数据。</p>
          ) : (
            <ul className="channel-list">
              {summary!.byChannel.map((c) => {
                const total = Math.max(1, summary!.expenseCents);
                const pct = Math.round((c.expenseCents / total) * 100);
                return (
                  <li key={c.channel}>
                    <div className="channel-head">
                      <span className="chip">{c.channel === 'sms' ? '短信' : '通知'}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill channel" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="muted small">支出 ¥{formatYuan(c.expenseCents)} · 收入 ¥{formatYuan(c.incomeCents)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
