package com.bookkeeping.app.plugins;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public class PaymentNotificationService extends NotificationListenerService {
    private static PaymentNotificationService instance;

    @Override
    public void onListenerConnected() {
        instance = this;
    }

    @Override
    public void onListenerDisconnected() {
        if (instance == this) instance = null;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String[] parts = NotifyListenerPlugin.extractTitleAndText(sbn);
        NotifyListenerPlugin.emitNotification(
            sbn.getKey(),
            sbn.getPackageName(),
            parts[0],
            parts[1],
            sbn.getPostTime()
        );
    }

    public static StatusBarNotification[] getActiveNotificationsSafe() {
        if (instance == null) return null;
        try {
            return instance.getActiveNotifications();
        } catch (Exception e) {
            return null;
        }
    }
}
