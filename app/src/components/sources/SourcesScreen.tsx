import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { ingestCapture, ingestMany } from '../../services/ingest';
import {
  addSmsFilter,
  getSmsFilters,
  removeSmsFilter,
  probeFilterSenders,
  scanAllSmsFilters,
  scanSmsByFilter,
} from '../../services/smsFilters';
import { subscribeDataChange } from '../../services/events';
import type { SmsSourceFilter } from '../../services/types';
import {
  checkSmsPermission,
  diagnoseSmsInbox,
  openAppSmsPermissionSettings,
  requestSmsPermission,
  startSmsWatching,
  type SmsInboxDiagnosis,
  __debugPushWebSms,
} from '../../plugins/smsReader';
import {
  getActiveNotifications,
  isNotifyAccessEnabled,
  isPaymentPackage,
  openNotifyAccessSettings,
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
  const [filters, setFilters] = useState<SmsSourceFilter[]>([]);
  const [smsGranted, setSmsGranted] = useState(false);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [batteryIgnored, setBatteryIgnored] = useState(false);
  const [manufacturer, setManufacturer] = useState('');
  const [brand, setBrand] = useState('');
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [smsDiag, setSmsDiag] = useState<SmsInboxDiagnosis | null>(null);

  const refresh = async () => {
    setFilters(await getSmsFilters());
    setSmsGranted(await checkSmsPermission());
    setNotifyEnabled(await isNotifyAccessEnabled());
    const battery = await getBatteryOptimizationStatus();
    setBatteryIgnored(battery.ignoring);
    setManufacturer(battery.manufacturer);
    setBrand(battery.brand);
    try {
      setSmsDiag(await diagnoseSmsInbox());
    } catch {
      setSmsDiag(null);
    }
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
          <h1>权限与短信检索</h1>
        </div>
        {onRerunOnboarding ? (
          <button type="button" className="ghost-btn" onClick={() => void onRerunOnboarding()}>
            重新引导权限
          </button>
        ) : null}
      </header>

      <div className="sources-grid">
        <section className="panel">
          <h2>支付宝 / 微信通知</h2>
          <p className="muted">
            仅捕获授权之后的新通知；历史通知无法回放。监听由系统绑定，不必始终停留在前台，但需保持通知使用权开启。
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
              onClick={async () => {
                const ok = await startNotifyListener();
                const active = await getActiveNotifications();
                const payment = active.filter((n) => isPaymentPackage(n.packageName));
                const results = await ingestMany(
                  payment.map((n) => ({
                    channel: 'notify' as const,
                    packageOrAddress: n.packageName,
                    title: n.title,
                    body: n.text,
                    occurredAt: n.postTime,
                    nativeId: n.key,
                  })),
                );
                toast(
                  ok
                    ? `监听已启动，补扫 ${payment.length} 条，新建/合并 ${results.filter((r) => r.action === 'created' || r.action === 'merged').length} 笔`
                    : '监听未就绪，请先开启通知使用权',
                );
                await refresh();
              }}
            >
              启动并补扫通知栏
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>银行 / 支付短信</h2>
          <p className="muted">
            可读取收件箱历史短信。配置号码或备注后点「检索」，与实时监听共用指纹去重，不会把同一条短信记两遍。
          </p>
          <div className="callout warn">
            <strong>重要：95588/银行短信常被厂商标成「通知类短信」。</strong>
            小米/红米等即使系统「读取短信」已开，默认仍读不到银行通知短信。请到应用权限里额外打开「通知类短信 / 服务短信 / 读写通知类短信」。这不是匹配规则问题。
          </div>
          <p className="status-line">
            短信权限：{smsGranted ? <span className="ok">已授权</span> : <span className="warn">未授权</span>}
            {smsDiag ? (
              <>
                {' · '}
                可读 {smsDiag.totalInbox} 条 / 银行类 {smsDiag.bankLikeCount} 条
              </>
            ) : null}
          </p>
          {smsDiag?.hint ? <p className="muted small">{smsDiag.hint}</p> : null}
          <div className="btn-row">
            <button
              type="button"
              className="primary-btn"
              onClick={async () => {
                const ok = await requestSmsPermission();
                setSmsGranted(ok);
                if (ok) {
                  await startSmsWatching();
                  toast('短信权限已授予，可检索历史并接收新短信');
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
              className="primary-btn"
              onClick={async () => {
                await openAppSmsPermissionSettings();
                toast('请开启「通知类短信/服务短信」后返回，再点诊断或检索');
                window.setTimeout(() => void refresh(), 1200);
              }}
            >
              打开通知类短信权限
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const d = await diagnoseSmsInbox();
                  setSmsDiag(d);
                  toast(d.hint);
                } catch (e) {
                  toast(e instanceof Error ? e.message : '诊断失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              诊断能否读到银行短信
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
                    `检索完成：匹配 ${summary.matched}，新建 ${summary.created}，合并 ${summary.merged}，重复跳过 ${summary.duplicate}，待确认 ${summary.queued}`,
                  );
                } catch (e) {
                  toast(e instanceof Error ? e.message : '检索失败');
                } finally {
                  setBusy(false);
                }
              }}
            >
              检索全部来源短信
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>防杀后台 / 省电</h2>
          <p className="muted">
            建议关闭本应用电池优化；国产机请额外允许自启动或后台运行，并在多任务里锁定应用，减少漏记。
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

      <section className="panel">
        <h2>短信来源</h2>
        <p className="muted small">
          显示名称会参与正文匹配（如「工商银行」可匹配短信里的【工商银行】）。银行号码请填短信发件号码（工行常见
          95588），不要填你自己的手机号。号码与关键词为「或」关系，命中任一即可。
        </p>
        <div className="form-grid">
          <label className="field">
            <span>显示名称</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="如：工商银行" />
          </label>
          <label className="field">
            <span>发件号码（可选）</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="如：95588" />
          </label>
          <label className="field">
            <span>备注关键词（可选）</span>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="如：工商银行 / 财付通" />
          </label>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="primary-btn"
            onClick={async () => {
              try {
                await addSmsFilter({ label, address, remark });
                setLabel('');
                setAddress('');
                setRemark('');
                toast('已添加短信来源');
              } catch (e) {
                toast(e instanceof Error ? e.message : '添加失败');
              }
            }}
          >
            添加来源
          </button>
        </div>

        <ul className="filter-list">
          {filters.length === 0 ? (
            <li className="muted">还没有短信来源。名称、号码、备注可任填一项或多项。</li>
          ) : (
            filters.map((f) => (
              <li key={f.id} className="filter-row">
                <div>
                  <strong>{f.label}</strong>
                  <p className="muted small">
                    {f.address ? `号码 ${f.address}` : '未填号码'}
                    {' · '}
                    {f.remark ? `备注 ${f.remark}` : '未填备注'}
                    {' · '}
                    id {f.id.slice(-6)}
                  </p>
                </div>
                <div className="filter-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const samples = await probeFilterSenders(f);
                        if (samples.length === 0) {
                          toast(
                            `未探测到含「${f.address || f.label}」的短信。请确认已授权短信权限，并到系统短信里点开该会话看真实发件号码。`,
                          );
                        } else {
                          const addrs = [...new Set(samples.map((s) => s.address))].slice(0, 6).join(' / ');
                          toast(`探测到 ${samples.length} 条相关短信，真实发件号示例：${addrs}`);
                        }
                      } catch (e) {
                        toast(e instanceof Error ? e.message : '探测失败（多半是短信权限未开）');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    探测发件号
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const { matched, results, scanned, sampleAddresses } = await scanSmsByFilter(f);
                        const created = results.filter((r) => r.action === 'created' || r.action === 'merged').length;
                        const dup = results.filter((r) => r.action === 'duplicate').length;
                        const failed = results.filter((r) => r.action === 'parse_failed').length;
                        if (matched === 0) {
                          toast(
                            scanned === 0
                              ? `「${f.label}」收件箱未读到相关短信（权限？或真实发件号不是 ${f.address || '所填号码'}）。请先点「探测发件号」。`
                              : `「${f.label}」初筛 ${scanned} 条但未通过匹配。读到的发件号示例：${sampleAddresses.join(' / ') || '无'}`,
                          );
                        } else {
                          toast(
                            `「${f.label}」匹配 ${matched}，写入 ${created}，跳过重复 ${dup}${failed ? `，解析失败 ${failed}` : ''}`,
                          );
                        }
                      } catch (e) {
                        toast(e instanceof Error ? e.message : '检索失败');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    检索短信
                  </button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={async () => {
                      const ok = window.confirm(
                        `确认删除短信来源「${f.label}」？\n号码：${f.address || '无'}\n备注：${f.remark || '无'}\n仅删除来源配置，不会删除已记账流水。`,
                      );
                      if (!ok) return;
                      await removeSmsFilter(f.id);
                      toast(`已删除来源「${f.label}」`);
                    }}
                  >
                    删除此来源
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {!Capacitor.isNativePlatform() ? (
        <section className="panel">
          <h2>浏览器调试</h2>
          <p className="muted">当前为 Web 预览，原生短信/通知不可用。可用下面按钮注入样例数据验证解析与去重。</p>
          <div className="btn-row">
            <button
              type="button"
              className="ghost-btn"
              onClick={async () => {
                __debugPushWebSms({
                  id: Date.now(),
                  address: '95588',
                  body: '尾号1234卡11月5日12:33支出(转账财付通-微信红包)200元，余额1,234.56元。【工商银行】',
                  date: Date.now(),
                  person: '工商银行',
                });
                toast('已注入工行样例短信，请用名称「工商银行」或号码 95588 添加来源后检索');
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
                toast('已注入支付宝通知样例（可与短信同金额测试合并）');
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
