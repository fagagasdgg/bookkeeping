package com.bookkeeping.app.plugins;

import android.content.ComponentName;
import android.content.Intent;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotifyListener")
public class NotifyListenerPlugin extends Plugin {
    private static NotifyListenerPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    public static void emitNotification(String key, String packageName, String title, String text, long postTime) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("key", key == null ? "" : key);
        data.put("packageName", packageName == null ? "" : packageName);
        data.put("title", title == null ? "" : title);
        data.put("text", text == null ? "" : text);
        data.put("postTime", postTime);
        instance.notifyListeners("notification", data);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enabled", hasNotificationAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getActive(PluginCall call) {
        JSArray notifications = new JSArray();
        StatusBarNotification[] active = PaymentNotificationService.getActiveNotificationsSafe();
        if (active != null) {
            for (StatusBarNotification sbn : active) {
                notifications.put(toJs(sbn));
            }
        }
        JSObject ret = new JSObject();
        ret.put("notifications", notifications);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("started", hasNotificationAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        call.resolve();
    }

    private boolean hasNotificationAccess() {
        String pkgName = getContext().getPackageName();
        String flat = Settings.Secure.getString(
            getContext().getContentResolver(),
            "enabled_notification_listeners"
        );
        if (TextUtils.isEmpty(flat)) return false;
        String[] names = flat.split(":");
        for (String name : names) {
            ComponentName cn = ComponentName.unflattenFromString(name);
            if (cn != null && TextUtils.equals(pkgName, cn.getPackageName())) {
                return true;
            }
        }
        return false;
    }

    static JSObject toJs(StatusBarNotification sbn) {
        JSObject data = new JSObject();
        data.put("key", sbn.getKey());
        data.put("packageName", sbn.getPackageName());
        String[] parts = extractTitleAndText(sbn);
        data.put("title", parts[0]);
        data.put("text", parts[1]);
        data.put("postTime", sbn.getPostTime());
        return data;
    }

    /** Prefer bigText / textLines so bank & smart-SMS notifications keep full ledger body. */
    static String[] extractTitleAndText(StatusBarNotification sbn) {
        android.os.Bundle extras = sbn.getNotification().extras;
        CharSequence titleCs = extras.getCharSequence("android.title");
        CharSequence textCs = extras.getCharSequence("android.bigText");
        if (textCs == null) textCs = extras.getCharSequence("android.text");
        if (textCs == null) {
            CharSequence[] lines = extras.getCharSequenceArray("android.textLines");
            if (lines != null && lines.length > 0) {
                StringBuilder sb = new StringBuilder();
                for (CharSequence line : lines) {
                    if (line == null) continue;
                    if (sb.length() > 0) sb.append('\n');
                    sb.append(line);
                }
                textCs = sb;
            }
        }
        if (textCs == null) textCs = extras.getCharSequence("android.subText");
        String title = titleCs == null ? "" : titleCs.toString();
        String text = textCs == null ? "" : textCs.toString();
        // Some OEMs put the whole SMS into title and leave text empty.
        if (text.isEmpty() && title.length() > 0) {
            text = title;
        }
        return new String[]{title, text};
    }
}
