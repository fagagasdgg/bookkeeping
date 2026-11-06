import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { ingestCapture, ingestMany } from '../../services/ingest';
import { subscribeDataChange } from '../../services/events';
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
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [batteryIgnored, setBatteryIgnored] = useState(false);
  const [manufacturer, setManufacturer] = useState('');
  const [brand, setBrand] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setNotifyEnabled(await isNotifyAccessEnabled());
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
          <h1>微信 / 支付宝通知</h1>
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
            只捕获支付宝、微信付款成功后的新通知；历史通知无法回放。监听由系统绑定，不必一直停留在前台，但需保持通知使用权开启，并尽量关闭对本应用的电池优化。
          </p>
          <div className="callout warn">
            <strong>微信通知详情必须可见。</strong>
            若只显示「你收到一条微信消息」而不含金额/商户，本应用无法解析。请到微信 → 设置 → 通知，打开通知详情显示；支付宝同理。
          </div>
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
                      ? `监听已启动，补扫通知栏 ${payment.length} 条，新建/合并 ${results.filter((r) => r.action === 'created' || r.action === 'merged').length} 笔`
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
          <h2>防杀后台 / 省电</h2>
          <p className="muted">
            通知监听服务由系统托管，一般不用把应用一直开在前台。建议关闭本应用电池优化；国产机请额外允许自启动或后台运行，并在多任务里锁定应用，减少漏记。
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

      {!Capacitor.isNativePlatform() ? (
        <section className="panel">
          <h2>浏览器调试</h2>
          <p className="muted">当前为 Web 预览，原生通知不可用。可用下面按钮注入样例数据验证解析与去重。</p>
          <div className="btn-row">
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
            <button
              type="button"
              className="ghost-btn"
              onClick={async () => {
                await ingestCapture({
                  channel: 'notify',
                  packageOrAddress: 'com.tencent.mm',
                  title: '微信支付',
                  body: '你已支付￥12.50给美团外卖',
                  occurredAt: Date.now(),
                });
                toast('已注入微信通知样例');
              }}
            >
              注入微信通知样例
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
