import { useEffect, useState } from 'react';
import { ensureDefaultCategoryRules } from '../../services/classify';
import { ingestCapture } from '../../services/ingest';
import {
  isPaymentPackage,
  onNotificationCaptured,
  startNotifyListener,
  getActiveNotifications,
} from '../../plugins/notifyListener';
import { startSmsWatching } from '../../plugins/smsReader';
import { LedgerScreen } from '../ledger/LedgerScreen';
import { ReviewScreen } from '../review/ReviewScreen';
import { SourcesScreen } from '../sources/SourcesScreen';
import { StatsScreen } from '../stats/StatsScreen';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { listOpenReviews } from '../../services/db';
import { subscribeDataChange } from '../../services/events';
import { bindNativeCaptureEvents } from '../../plugins/nativeBridge';
import {
  getPermissionSnapshot,
  hasCriticalPermissions,
  isOnboardingCompleted,
  resetOnboarding,
} from '../../services/onboarding';

type TabId = 'stats' | 'ledger' | 'sources' | 'review';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'stats', label: '统计' },
  { id: 'ledger', label: '明细' },
  { id: 'sources', label: '来源' },
  { id: 'review', label: '待确认' },
];

export function HomeShell() {
  const [tab, setTab] = useState<TabId>('stats');
  const [reviewCount, setReviewCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [permWarn, setPermWarn] = useState(false);

  useEffect(() => {
    void (async () => {
      await ensureDefaultCategoryRules();
      const done = await isOnboardingCompleted();
      setShowOnboarding(!done);
      setReady(true);
      if (done) {
        const snap = await getPermissionSnapshot();
        setPermWarn(!hasCriticalPermissions(snap));
      }
    })();
  }, []);

  useEffect(() => {
    if (showOnboarding || !ready) return;
    void ensureDefaultCategoryRules();
    bindNativeCaptureEvents();
    void startNotifyListener();
    void startSmsWatching();
    void getActiveNotifications().then(async (list) => {
      for (const n of list) {
        if (!isPaymentPackage(n.packageName)) continue;
        await ingestCapture({
          channel: 'notify',
          packageOrAddress: n.packageName,
          title: n.title,
          body: n.text,
          occurredAt: n.postTime,
          nativeId: n.key,
        });
      }
    });

    const off = onNotificationCaptured((n) => {
      if (!isPaymentPackage(n.packageName)) return;
      void ingestCapture({
        channel: 'notify',
        packageOrAddress: n.packageName,
        title: n.title,
        body: n.text,
        occurredAt: n.postTime,
        nativeId: n.key,
      });
    });
    return off;
  }, [showOnboarding, ready]);

  useEffect(() => {
    const load = async () => setReviewCount((await listOpenReviews()).length);
    void load();
    return subscribeDataChange(() => void load());
  }, []);

  if (!ready) {
    return (
      <div className="app-shell boot">
        <p className="muted">正在准备本地记账…</p>
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingScreen
        onFinished={() => {
          setShowOnboarding(false);
          void getPermissionSnapshot().then((snap) => setPermWarn(!hasCriticalPermissions(snap)));
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      {permWarn ? (
        <div className="perm-banner">
          <span>通知或短信权限未齐，自动记账可能漏记。</span>
          <button type="button" className="ghost-btn" onClick={() => setTab('sources')}>
            去设置
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={async () => {
              await resetOnboarding();
              setShowOnboarding(true);
            }}
          >
            重新引导
          </button>
        </div>
      ) : null}
      <main className="app-main">
        {tab === 'stats' ? <StatsScreen /> : null}
        {tab === 'ledger' ? <LedgerScreen /> : null}
        {tab === 'sources' ? (
          <SourcesScreen
            onRerunOnboarding={async () => {
              await resetOnboarding();
              setShowOnboarding(true);
            }}
          />
        ) : null}
        {tab === 'review' ? <ReviewScreen /> : null}
      </main>
      <nav className="bottom-nav" aria-label="主导航">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'nav-item active' : 'nav-item'}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            {t.id === 'review' && reviewCount > 0 ? <em className="badge">{reviewCount}</em> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}
