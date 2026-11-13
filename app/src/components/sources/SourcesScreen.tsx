import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { ingestCapture, ingestMany } from '../../services/ingest';
import { subscribeDataChange } from '../../services/events';
import {
  addSmsFilter,
  getSmsFilters,
  removeSmsFilter,
  scanAllSmsFilters,
  scanSmsByAddress,
} from '../../services/smsFilters';
import {
  pickAndPreviewSmsBackup,
  type SmsBackupPreview,
} from '../../services/smsBackupImport';
import type { SmsSourceFilter } from '../../services/types';
import { SmsBackupPreviewPanel } from './SmsBackupPreviewPanel';
import {
  checkSmsPermission,
  openAppSmsPermissionSettings,
  requestSmsPermission,
  startSmsWatching,
  __debugPushWebSms,
} from '../../plugins/smsReader';
import {
  getActiveNotifications,
  isNotifyAccessEnabled,
  openNotifyAccessSettings,
  shouldCaptureNotification,
  startNotifyListener,
} from '../../plugins/notifyListener';
import {
  getBatteryOptimizationStatus,
  needsAggressiveOemGuide,
  openAutostartSettings,
  requestIgnoreBatteryOptimizations,
} from '../../plugins/backgroundKeep';
import { toast } from '../common/AppToast';

interface Props {
  onRerunOnboarding?: () => void | Promise<void>;
}

export function SourcesScreen({ onRerunOnboarding }: Props) {
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [smsGranted, setSmsGranted] = useState(false);
  const [batteryIgnored, setBatteryIgnored] = useState(false);
  const [manufacturer, setManufacturer] = useState('');
  const [brand, setBrand] = useState('');
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<SmsSourceFilter[]>([]);
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [smsPreview, setSmsPreview] = useState<SmsBackupPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setNotifyEnabled(await isNotifyAccessEnabled());
    setSmsGranted(await checkSmsPermission());
    setFilters(await getSmsFilters());
    const battery = await getBatteryOptimizationStatus();
    setBatteryIgnored(battery.ignoring);
    setManufacturer(battery.manufacturer);
    setBrand(battery.brand);
  };

  useEffect(() => {
    void refresh();
    return subscribeDataChange(() => void refresh());
  }, []);

  return (
    <div className="screen sources-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">数据来源</p>
          <h1>通知与短信</h1>
        </div>
        {onRerunOnboarding ? (
          <button type="button" className="ghost-btn" onClick={() => void onRerunOnboarding()}>
            重新引导权限
          </button>
        ) : null}
      </header>

      <div className="sources-grid">
        <section className="panel">
          <h2>通知使用权</h2>
          <p className="muted">
            捕获微信、支付宝、银行 App，以及短信 App 弹出的「动账通知」。历史已消失的通知无法回放。
          </p>
          <p className="status-line">
            状态：{notifyEnabled ? <span className="ok">已开启</span> : <span className="warn">未开启</span>}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                await openNotifyAccessSettings();
                toast('请在系统设置中开启本应用的通知使用权，然后返回');
                window.setTimeout(() => void refresh(), 1200);
              }}
            >
              打开通知使用权
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const ok = await startNotifyListener();
                  const active = await getActiveNotifications();
                  const payment = active.filter((n) => shouldCaptureNotification(n));
                  const results = await ingestMany(
                    payment.map((n) => ({
                      channel: 'notify' as const,
                      packageOrAddress: n.packageName,
                      title: n.title,
                      body: n.text || n.title,
                      occurredAt: n.postTime,
                      nativeId: n.key,
                      meta: { via: 'notification-listener' },
                    })),
                  );
                  toast(
                    ok
                      ? `监听已启动，补扫命中 ${payment.length} 条，写入 ${results.filter((r) => r.action === 'created' || r.action === 'merged').length} 笔`
                      : '监听未就绪，请先开启通知使用权',
                  );
                } catch (e) {
                  toast(e instanceof Error ? e.message : '补扫失败');
                } finally {
                  setBusy(false);
                  await refresh();
                }
              }}
            >
              启动并补扫通知栏
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>短信扫描</h2>
          <p className="muted">
            只需填写发件号码（如工行 95588）。授权后点「扫描动账」，会按该号码定位会话并自动筛出带金额的动账短信。
          </p>
          <div className="callout warn">
            iQOO/vivo 上部分「服务号」动账可能不在标准短信库；若扫描为 0，请同时靠上方通知通道。
          </div>
          <p className="status-line">
            短信权限：{smsGranted ? <span className="ok">已授权</span> : <span className="warn">未授权</span>}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                const ok = await requestSmsPermission();
                setSmsGranted(ok);
                if (ok) {
                  await startSmsWatching();
                  toast('短信权限已授予，可扫描历史并接收新短信');
                } else {
                  toast('未获得短信权限');
                }
                await refresh();
              }}
            >
              申请短信权限
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={async () => {
                await openAppSmsPermissionSettings();
                toast('请在应用权限中开启短信读取后返回');
                window.setTimeout(() => void refresh(), 1200);
              }}
            >
              打开应用权限页
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || filters.length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  const summary = await scanAllSmsFilters();
                  toast(
                    `全部扫描：动账 ${summary.matched}，新建 ${summary.created}，合并 ${summary.merged}，重复 ${summary.duplicate}`,
                  );
                } catch (e) {
                  toast(e instanceof Error ? e.message : '扫描失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              扫描全部已存号码
            </button>
          </div>

          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field">
              <span>发件号码</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="如：95588"
              />
            </label>
            <label className="field">
              <span>备注名（可选）</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="如：工商银行"
              />
            </label>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              disabled={busy || !address.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  if (!smsGranted) {
                    const ok = await requestSmsPermission();
                    if (!ok) {
                      toast('请先授予短信权限');
                      return;
                    }
                    await startSmsWatching();
                    setSmsGranted(true);
                  }
                  const existing = filters.find((f) => f.address === address.trim());
                  if (!existing) {
                    await addSmsFilter({ address: address.trim(), label: label.trim() || undefined });
                  }
                  const r = await scanSmsByAddress(address.trim(), label.trim() || undefined);
                  const created = r.results.filter((x) => x.action === 'created' || x.action === 'merged').length;
                  const dup = r.results.filter((x) => x.action === 'duplicate').length;
                  if (r.scanned === 0) {
                    toast(
                      `号码「${address.trim()}」在标准短信库未读到会话。可再试通知补扫；服务号历史可能读不到。`,
                    );
                  } else {
                    toast(
                      `扫到 ${r.scanned} 条，动账 ${r.matched}，写入 ${created}，重复 ${dup}。发件号：${r.discoveredSenders.slice(0, 3).join(' / ') || '无'}`,
                    );
                  }
                  setAddress('');
                  setLabel('');
                  await refresh();
                } catch (e) {
                  toast(e instanceof Error ? e.message : '扫描失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存并扫描动账
            </button>
          </div>

          <ul className="filter-list">
            {filters.length === 0 ? (
              <li className="muted">还没有短信号码。填发件号后点「保存并扫描动账」即可。</li>
            ) : (
              filters.map((f) => (
                <li key={f.id} className="filter-row">
                  <div>
                    <strong>{f.label}</strong>
                    <p className="muted small">号码 {f.address || '未填'}</p>
                  </div>
                  <div className="filter-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy || !f.address}
                      onClick={async () => {
                        if (!f.address) return;
                        setBusy(true);
                        try {
                          const r = await scanSmsByAddress(f.address, f.label);
                          const created = r.results.filter(
                            (x) => x.action === 'created' || x.action === 'merged',
                          ).length;
                          toast(
                            `「${f.label}」扫到 ${r.scanned}，动账 ${r.matched}，写入 ${created}`,
                          );
                        } catch (e) {
                          toast(e instanceof Error ? e.message : '扫描失败');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      扫描
                    </button>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={async () => {
                        const ok = window.confirm(`删除号码「${f.label}」？不会删除已记账流水。`);
                        if (!ok) return;
                        await removeSmsFilter(f.id);
                        toast(`已删除「${f.label}」`);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>

          <h3 style={{ marginTop: 16 }}>导入短信备份并预览</h3>
          <p className="muted small">
            对齐 read 项目：真机用系统文件选择器（SAF）打开 Downloads 里的{' '}
            <code>.sms</code>；先解析分类展示，确认后再决定是否导入动账。也支持常见 SMS Backup 的{' '}
            <code>.xml</code>。
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sms,.xml,.zip,application/xml,text/xml"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setBusy(true);
              try {
                const preview = await pickAndPreviewSmsBackup(file);
                setSmsPreview(preview);
                toast(
                  preview.total > 0
                    ? `已解析 ${preview.total} 条（动账 ${preview.ledgerCount}）。可预览或复制报告`
                    : '解析到 0 条。请打开下方「解析报告」复制发给开发',
                );
              } catch (err) {
                toast(err instanceof Error ? err.message : '解析失败');
              } finally {
                setBusy(false);
              }
            }}
          />
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              disabled={busy}
              onClick={async () => {
                if (!Capacitor.isNativePlatform()) {
                  fileInputRef.current?.click();
                  return;
                }
                setBusy(true);
                try {
                  const preview = await pickAndPreviewSmsBackup();
                  setSmsPreview(preview);
                  toast(
                    preview.total > 0
                      ? `已解析 ${preview.total} 条（动账 ${preview.ledgerCount}）。可预览或复制报告`
                      : '解析到 0 条。请打开下方「解析报告」复制发给开发',
                  );
                } catch (err) {
                  const msg = err instanceof Error ? err.message : '选择/解析失败';
                  if (!/未选择|cancel/i.test(msg)) toast(msg);
                } finally {
                  setBusy(false);
                }
              }}
            >
              选择 .sms / .xml 并预览
            </button>
          </div>
          <p className="muted small">
            可选：先在上方填发件号码（如 95588），预览里会按该号码过滤；确认后再点「导入当前筛选的动账」。
          </p>
        </section>

        <section className="panel">
          <h2>防杀后台 / 省电</h2>
          <p className="muted">
            建议关闭本应用电池优化；国产机请额外允许自启动或后台运行。
          </p>
          <p className="status-line">
            电池优化白名单：
            {batteryIgnored ? <span className="ok">已忽略优化</span> : <span className="warn">仍受限</span>}
            {manufacturer ? <span className="muted small"> · {brand || manufacturer}</span> : null}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                await requestIgnoreBatteryOptimizations();
                toast('请在系统弹窗中允许不优化');
                window.setTimeout(() => void refresh(), 1000);
              }}
            >
              关闭电池优化
            </button>
            {needsAggressiveOemGuide(manufacturer, brand) ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  const res = await openAutostartSettings();
                  toast(
                    res.fallback === 'appDetails'
                      ? '已打开应用详情，请手动开启自启动/后台'
                      : '请允许自启动或后台运行',
                  );
                }}
              >
                自启动/后台设置
              </button>
            ) : null}
          </div>
        </section>
      </div>

      {smsPreview ? (
        <SmsBackupPreviewPanel
          preview={smsPreview}
          addressFilter={address}
          onClose={() => setSmsPreview(null)}
          onImported={() => void refresh()}
        />
      ) : null}

      {!Capacitor.isNativePlatform() ? (
        <section className="panel">
          <h2>浏览器调试</h2>
          <div className="btn-row">
            <button
              type="button"
              className="ghost-btn"
              onClick={async () => {
                __debugPushWebSms({
                  id: Date.now(),
                  address: '95588',
                  body: '尾号3007卡11月13日14:07支出(消费 支付宝-上海蒜芽信息科技有限公司)16.50元，余额100.00元。【工商银行】',
                  date: Date.now(),
                });
                toast('已注入工行样例短信，号码填 95588 后扫描');
              }}
            >
              注入样例银行短信
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={async () => {
                await ingestCapture({
                  channel: 'notify',
                  packageOrAddress: 'com.eg.android.AlipayGphone',
                  title: '支付成功',
                  body: '你有一笔支出，向美团付款88.00元',
                  occurredAt: Date.now(),
                });
                toast('已注入支付宝通知样例');
              }}
            >
              注入支付宝通知样例
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
