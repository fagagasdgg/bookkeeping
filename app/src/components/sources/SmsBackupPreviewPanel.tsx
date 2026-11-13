import { useMemo, useState } from 'react';
import { formatDateTime } from '../../lib/time';
import {
  importPreviewMessages,
  type SmsBackupPreview,
} from '../../services/smsBackupImport';
import { toast } from '../common/AppToast';

type ViewMode = 'groups' | 'ledger' | 'all';

interface Props {
  preview: SmsBackupPreview;
  addressFilter?: string;
  onClose: () => void;
  onImported?: () => void;
}

export function SmsBackupPreviewPanel({ preview, addressFilter, onClose, onImported }: Props) {
  const [mode, setMode] = useState<ViewMode>('groups');
  const [openAddress, setOpenAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filteredMessages = useMemo(() => {
    let list = preview.messages;
    const needle = addressFilter?.trim();
    if (needle) {
      list = list.filter((m) => m.address.includes(needle) || m.body.includes(needle));
    }
    if (mode === 'ledger') list = list.filter((m) => m.ledgerLike);
    return list;
  }, [preview.messages, addressFilter, mode]);

  const groups = useMemo(() => {
    if (!addressFilter?.trim()) return preview.groups;
    const needle = addressFilter.trim();
    return preview.groups.filter(
      (g) => g.address.includes(needle) || g.messages.some((m) => m.body.includes(needle)),
    );
  }, [preview.groups, addressFilter]);

  return (
    <section className="panel sms-preview-panel">
      <header className="screen-header compact">
        <div>
          <p className="eyebrow">短信备份预览</p>
          <h2>{preview.fileName}</h2>
          <p className="muted small">
            共 {preview.total} 条 · 疑似动账 {preview.ledgerCount} · 其他 {preview.otherCount}
            {addressFilter?.trim() ? ` · 号码过滤「${addressFilter.trim()}」` : ''}
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={onClose}>
          关闭预览
        </button>
      </header>

      <div className="period-tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={mode === 'groups' ? 'tab active' : 'tab'}
          onClick={() => setMode('groups')}
        >
          按发件人（{groups.length}）
        </button>
        <button
          type="button"
          className={mode === 'ledger' ? 'tab active' : 'tab'}
          onClick={() => setMode('ledger')}
        >
          疑似动账（{preview.ledgerCount}）
        </button>
        <button
          type="button"
          className={mode === 'all' ? 'tab active' : 'tab'}
          onClick={() => setMode('all')}
        >
          全部短信
        </button>
      </div>

      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="primary-btn"
          disabled={busy || preview.ledgerCount === 0}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await importPreviewMessages(preview, {
                addressFilter: addressFilter?.trim() || undefined,
                ledgerOnly: true,
              });
              const created = r.results.filter((x) => x.action === 'created' || x.action === 'merged').length;
              const dup = r.results.filter((x) => x.action === 'duplicate').length;
              toast(`导入动账 ${r.matched} 条：写入 ${created}，重复 ${dup}`);
              onImported?.();
            } catch (e) {
              toast(e instanceof Error ? e.message : '导入失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          导入当前筛选的动账
        </button>
      </div>

      {mode === 'groups' ? (
        <ul className="filter-list sms-group-list">
          {groups.length === 0 ? (
            <li className="muted">没有匹配的发件人分组</li>
          ) : (
            groups.map((g) => {
              const open = openAddress === g.address;
              return (
                <li key={g.address} className="sms-group-card">
                  <button
                    type="button"
                    className="sms-group-head"
                    onClick={() => setOpenAddress(open ? null : g.address)}
                  >
                    <div>
                      <strong>{g.contactName || g.address}</strong>
                      {g.contactName ? <p className="muted small">{g.address}</p> : null}
                    </div>
                    <div className="sms-group-meta">
                      <span className="chip">{g.total} 条</span>
                      {g.ledgerCount > 0 ? (
                        <span className="chip ok">动账 {g.ledgerCount}</span>
                      ) : (
                        <span className="chip">无动账</span>
                      )}
                      <span className="muted small">{open ? '收起' : '展开'}</span>
                    </div>
                  </button>
                  {open ? (
                    <ul className="sms-msg-list">
                      {g.messages.slice(0, 80).map((m, i) => (
                        <li key={`${m.date}-${i}`} className={m.ledgerLike ? 'sms-msg ledger' : 'sms-msg'}>
                          <div className="sms-msg-meta">
                            <span>{formatDateTime(m.date)}</span>
                            {m.ledgerLike ? <span className="chip ok">动账</span> : null}
                            {m.type != null ? <span className="muted small">type={m.type}</span> : null}
                          </div>
                          <p className="sms-msg-body">{m.body}</p>
                        </li>
                      ))}
                      {g.messages.length > 80 ? (
                        <li className="muted small">仅显示前 80 条，共 {g.messages.length} 条</li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      ) : (
        <ul className="sms-msg-list flat">
          {filteredMessages.length === 0 ? (
            <li className="muted">没有可显示的短信</li>
          ) : (
            filteredMessages.slice(0, 200).map((m, i) => (
              <li key={`${m.address}-${m.date}-${i}`} className={m.ledgerLike ? 'sms-msg ledger' : 'sms-msg'}>
                <div className="sms-msg-meta">
                  <strong>{m.address}</strong>
                  <span>{formatDateTime(m.date)}</span>
                  {m.ledgerLike ? <span className="chip ok">动账</span> : null}
                </div>
                <p className="sms-msg-body">{m.body}</p>
              </li>
            ))
          )}
          {filteredMessages.length > 200 ? (
            <li className="muted small">仅显示前 200 条，共 {filteredMessages.length} 条</li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
