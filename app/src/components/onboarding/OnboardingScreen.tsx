import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useState } from 'react';
import {
  getBatteryOptimizationStatus,
  needsAggressiveOemGuide,
  openAutostartSettings,
  openBatterySettings,
  requestIgnoreBatteryOptimizations,
} from '../../plugins/backgroundKeep';
import { openNotifyAccessSettings, startNotifyListener } from '../../plugins/notifyListener';
import {
  diagnoseSmsInbox,
  openAppSmsPermissionSettings,
  requestSmsPermission,
  startSmsWatching,
} from '../../plugins/smsReader';
import {
  getPermissionSnapshot,
  markOnboardingCompleted,
  type PermissionSnapshot,
} from '../../services/onboarding';
import { toast } from '../common/AppToast';

type Step = 'welcome' | 'notify' | 'sms' | 'battery' | 'done';

const STEPS: Step[] = ['welcome', 'notify', 'sms', 'battery', 'done'];

interface Props {
  onFinished: () => void;
}

export function OnboardingScreen({ onFinished }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [snap, setSnap] = useState<PermissionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getPermissionSnapshot();
    setSnap(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const stepIndex = STEPS.indexOf(step);
  const oemGuide = snap ? needsAggressiveOemGuide(snap.manufacturer, snap.brand) : true;

  const finish = async () => {
    await markOnboardingCompleted();
    await startNotifyListener();
    await startSmsWatching();
    onFinished();
  };

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'dot active' : 'dot'} />
          ))}
        </div>

        {step === 'welcome' ? (
          <>
            <p className="eyebrow">首次设置</p>
            <h1>开始本地记账</h1>
            <p className="lead">
              为了自动捕获支付宝/微信通知和银行短信，需要你开启几项权限。数据只保存在本机，不会上传。
            </p>
            <ul className="onboarding-checklist">
              <li>通知使用权 — 捕获支付 App 通知</li>
              <li>短信权限 — 读取/检索银行动账短信</li>
              <li>电池优化白名单 — 降低被系统杀掉导致漏记的风险</li>
            </ul>
            <div className="callout warn">
              <strong>重要：微信通知内容必须可见。</strong>
              若微信开启了「通知显示详情 / 锁屏显示内容」的关闭项，或仅提示「你收到一条微信消息」而不含金额商户，本应用
              <em>无法</em>
              解析这笔消费。请到微信 → 设置 → 通知，打开通知详情显示；支付宝同理。
            </div>
            {!Capacitor.isNativePlatform() ? (
              <p className="muted small">
                当前是浏览器预览，权限步骤可点「下一步」跳过；真机安装后才会真正生效。
              </p>
            ) : null}
            <div className="btn-row">
              <button type="button" className="primary-btn" onClick={() => setStep('notify')}>
                开始设置
              </button>
            </div>
          </>
        ) : null}

        {step === 'notify' ? (
          <>
            <p className="eyebrow">步骤 1 / 3</p>
            <h1>开启通知使用权</h1>
            <p className="lead">
              系统不会开放微信/支付宝账单 API。开启通知使用权后，才能在付款成功时自动记账。历史通知无法回放，只捕获授权之后的新通知。
            </p>
            <div className="callout warn">
              若微信/支付宝把通知隐藏成「收到一条消息」而不含金额，软件同样读不到交易内容。请保持通知详情展示开启。
            </div>
            <p className="status-line">
              状态：
              {snap?.notifyEnabled ? <span className="ok">已开启</span> : <span className="warn">未开启</span>}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await openNotifyAccessSettings();
                    toast('请在系统列表中找到「本地记账」并开启');
                    window.setTimeout(() => void refresh(), 800);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                打开通知使用权设置
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  const latest = await refresh();
                  if (!latest.notifyEnabled && Capacitor.isNativePlatform()) {
                    toast('尚未检测到通知使用权，可稍后再开，或先进入下一步');
                  }
                  setStep('sms');
                }}
              >
                {snap?.notifyEnabled ? '下一步' : '暂时跳过'}
              </button>
            </div>
          </>
        ) : null}

        {step === 'sms' ? (
          <>
            <p className="eyebrow">步骤 2 / 3</p>
            <h1>授予短信权限</h1>
            <p className="lead">
              用于读取收件箱中的银行/支付短信，并支持按号码或备注「检索历史短信」。也会在新短信到达时尝试自动入库。
            </p>
            <div className="callout warn">
              <strong>银行短信（如 95588）常被标成「通知类短信」。</strong>
              小米/红米等机型：系统「读取短信」开了还不够，必须再到应用权限里手动打开「通知类短信 /
              服务短信」。否则 App 会显示权限已开，却一条工行短信都读不到。
            </div>
            <p className="status-line">
              状态：
              {snap?.smsGranted ? <span className="ok">已授权系统短信</span> : <span className="warn">未授权</span>}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const ok = await requestSmsPermission();
                    if (ok) {
                      await startSmsWatching();
                      toast('系统短信权限已授予；请继续开启通知类短信');
                    } else {
                      toast('未获得短信权限，可在系统设置中手动开启');
                    }
                    await refresh();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                申请系统短信权限
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={async () => {
                  await openAppSmsPermissionSettings();
                  toast('请打开「通知类短信/服务短信」后返回');
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
                onClick={async () => {
                  await refresh();
                  setStep('battery');
                }}
              >
                {snap?.smsGranted ? '下一步' : '暂时跳过'}
              </button>
            </div>
          </>
        ) : null}

        {step === 'battery' ? (
          <>
            <p className="eyebrow">步骤 3 / 3</p>
            <h1>减少被系统杀掉</h1>
            <p className="lead">
              通知监听由系统托管，但短信广播和部分国产机的省电策略仍可能影响捕获稳定性。建议关闭本应用的电池优化；小米/华为/OPPO/vivo
              等机型还需允许自启动或后台运行。
            </p>
            <p className="status-line">
              电池优化白名单：
              {snap?.batteryIgnored ? (
                <span className="ok">已忽略优化</span>
              ) : (
                <span className="warn">仍受省电限制</span>
              )}
              {snap?.manufacturer ? (
                <span className="muted small"> · {snap.brand || snap.manufacturer}</span>
              ) : null}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="primary-btn"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await requestIgnoreBatteryOptimizations();
                    toast('请在弹窗中允许「不优化」或加入白名单');
                    window.setTimeout(async () => {
                      const status = await getBatteryOptimizationStatus();
                      setSnap((prev) =>
                        prev
                          ? { ...prev, batteryIgnored: status.ignoring }
                          : prev,
                      );
                    }, 1000);
                  } catch (e) {
                    toast(e instanceof Error ? e.message : '无法打开电池设置');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                关闭电池优化
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  try {
                    await openBatterySettings();
                  } catch {
                    toast('无法打开电池优化列表');
                  }
                }}
              >
                打开电池优化列表
              </button>
              {oemGuide ? (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={async () => {
                    const res = await openAutostartSettings();
                    toast(
                      res.fallback === 'appDetails'
                        ? '已打开应用详情，请在其中找到自启动/后台运行并允许'
                        : '请在打开的页面中允许自启动或后台运行',
                    );
                  }}
                >
                  打开自启动/后台设置
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-btn"
                onClick={async () => {
                  await refresh();
                  setStep('done');
                }}
              >
                {snap?.batteryIgnored ? '下一步' : '暂时跳过'}
              </button>
            </div>
            <p className="muted small">
              额外建议：在系统多任务界面锁定本应用；勿从设置里「强制停止」。这些无法由 App
              一键完成，需手动操作一次。
            </p>
          </>
        ) : null}

        {step === 'done' ? (
          <>
            <p className="eyebrow">就绪</p>
            <h1>权限设置完成</h1>
            <ul className="onboarding-checklist">
              <li>
                通知使用权：
                {snap?.notifyEnabled ? <span className="ok">已开</span> : <span className="warn">未开</span>}
              </li>
              <li>
                短信权限：
                {snap?.smsGranted ? <span className="ok">已开</span> : <span className="warn">未开</span>}
              </li>
              <li>
                电池优化白名单：
                {snap?.batteryIgnored ? <span className="ok">已开</span> : <span className="warn">未开</span>}
              </li>
            </ul>
            <p className="muted">
              未开启的项目可稍后在「来源」页继续设置。进入应用后，建议先添加短信来源并点「检索短信」。
            </p>
            <div className="btn-row">
              <button type="button" className="primary-btn" onClick={() => void finish()}>
                进入应用
              </button>
              <button type="button" className="ghost-btn" onClick={() => setStep('notify')}>
                返回重设
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
