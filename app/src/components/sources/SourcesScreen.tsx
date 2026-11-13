import { Capacitor } from '@capacitor/core';
import { useEffect, useState } from 'react';
import { ingestCapture, ingestMany } from '../../services/ingest';
import { subscribeDataChange } from '../../services/events';
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
          <h1>通知记账</h1>
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
            捕获微信、支付宝、银行 App，以及短信 App 弹出的「动账通知」。不读短信数据库（服务号历史仍读不到），但通知栏里那种带「尾号/支出/xx.xx」的提醒可以记账。历史已消失的通知无法回放。
          </p>
          <div className="callout warn">
            <strong>你截图那种「工商银行 + 动账通知」正是这条路。</strong>
            装新版后保持通知使用权开启；通知还在栏里时可点「启动并补扫通知栏」。微信请打开通知详情显示。
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
                  const pkgs = [...new Set(payment.map((n) => n.packageName))].slice(0, 4).join(' / ');
                  toast(
                    ok
                      ? `监听已启动，补扫命中 ${payment.length} 条${pkgs ? `（${pkgs}）` : ''}，写入 ${results.filter((r) => r.action === 'created' || r.action === 'merged').length} 笔`
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
