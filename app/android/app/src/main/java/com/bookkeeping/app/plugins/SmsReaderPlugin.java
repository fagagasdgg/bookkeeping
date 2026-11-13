package com.bookkeeping.app.plugins;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = {
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS
            }
        )
    }
)
public class SmsReaderPlugin extends Plugin {
    private static SmsReaderPlugin instance;
    private IncomingSmsReceiver receiver;
    private boolean watching = false;

    @Override
    public void load() {
        instance = this;
    }

    public static void emitSms(long id, String address, String body, long date, String person) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("id", id);
        data.put("address", address == null ? "" : address);
        data.put("body", body == null ? "" : body);
        data.put("date", date);
        if (person != null) data.put("person", person);
        instance.notifyListeners("sms", data);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasSmsPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasSmsPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermCallback");
    }

    @PermissionCallback
    private void smsPermCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasSmsPermission());
        call.resolve(ret);
    }

    /**
     * Pull messages for a sender needle (e.g. 95588): match address, then pull full threads.
     */
    @PluginMethod
    public void queryBySender(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }
        String address = call.getString("address", "");
        if (address == null) address = "";
        address = address.trim();
        if (address.isEmpty()) {
            call.reject("address is required");
            return;
        }
        int limit = call.getInt("limit", 5000);
        ContentResolver resolver = getContext().getContentResolver();
        Uri uri = Telephony.Sms.CONTENT_URI;
        String[] projection = new String[]{
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.PERSON,
            Telephony.Sms.TYPE,
            Telephony.Sms.THREAD_ID
        };

        String like = "%" + address + "%";
        java.util.LinkedHashSet<Long> threadIds = new java.util.LinkedHashSet<>();
        java.util.LinkedHashMap<Long, JSObject> byId = new java.util.LinkedHashMap<>();
        java.util.LinkedHashSet<String> discovered = new java.util.LinkedHashSet<>();

        // Seed: address or body contains needle → collect thread ids
        try (Cursor cursor = resolver.query(
            uri,
            projection,
            "(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL) AND ("
                + Telephony.Sms.ADDRESS + " LIKE ? OR " + Telephony.Sms.BODY + " LIKE ?)",
            new String[]{like, like},
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                int seeds = 0;
                while (cursor.moveToNext() && seeds < 800) {
                    seeds++;
                    if (!cursor.isNull(6)) threadIds.add(cursor.getLong(6));
                    putMessage(byId, discovered, cursor, limit);
                }
            }
        } catch (Exception e) {
            call.reject("queryBySender seed failed: " + e.getMessage(), e);
            return;
        }

        // Full conversation for discovered threads
        if (!threadIds.isEmpty()) {
            StringBuilder in = new StringBuilder();
            java.util.ArrayList<String> args = new java.util.ArrayList<>();
            for (Long tid : threadIds) {
                if (in.length() > 0) in.append(",");
                in.append("?");
                args.add(String.valueOf(tid));
            }
            try (Cursor cursor = resolver.query(
                uri,
                projection,
                "(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL) AND "
                    + Telephony.Sms.THREAD_ID + " IN (" + in + ")",
                args.toArray(new String[0]),
                Telephony.Sms.DATE + " DESC"
            )) {
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        putMessage(byId, discovered, cursor, limit);
                    }
                }
            } catch (Exception e) {
                call.reject("queryBySender thread failed: " + e.getMessage(), e);
                return;
            }
        }

        JSArray messages = new JSArray();
        for (JSObject msg : byId.values()) {
            messages.put(msg);
            if (messages.length() >= limit) break;
        }
        JSArray addrs = new JSArray();
        for (String a : discovered) addrs.put(a);

        JSObject ret = new JSObject();
        ret.put("messages", messages);
        ret.put("discoveredAddresses", addrs);
        ret.put("count", messages.length());
        call.resolve(ret);
    }

    private static void putMessage(
        java.util.LinkedHashMap<Long, JSObject> byId,
        java.util.LinkedHashSet<String> discovered,
        Cursor cursor,
        int limit
    ) {
        if (byId.size() >= limit) return;
        long id = cursor.getLong(0);
        if (byId.containsKey(id)) return;
        String addr = cursor.getString(1);
        String body = cursor.getString(2);
        // Soft filter: keep if address digits overlap needle already applied in SQL,
        // or always keep thread messages once seeded.
        JSObject msg = new JSObject();
        msg.put("id", id);
        msg.put("address", addr == null ? "" : addr);
        msg.put("body", body == null ? "" : body);
        msg.put("date", cursor.getLong(3));
        String person = cursor.isNull(4) ? null : cursor.getString(4);
        if (person != null) msg.put("person", person);
        if (!cursor.isNull(6)) msg.put("threadId", cursor.getLong(6));
        byId.put(id, msg);
        if (addr != null && !addr.isEmpty()) discovered.add(addr);
    }

    @PluginMethod
    public void openAppPermissionSettings(PluginCall call) {
        try {
            String pkg = getContext().getPackageName();
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            details.setData(Uri.parse("package:" + pkg));
            details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(details);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开应用权限页: " + e.getMessage());
        }
    }

    @PluginMethod
    public void startWatching(PluginCall call) {
        if (!hasSmsPermission()) {
            JSObject ret = new JSObject();
            ret.put("watching", false);
            call.resolve(ret);
            return;
        }
        if (!watching) {
            receiver = new IncomingSmsReceiver();
            IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
            filter.setPriority(1000);
            if (Build.VERSION.SDK_INT >= 33) {
                getContext().registerReceiver(receiver, filter, ContextCompat.RECEIVER_EXPORTED);
            } else {
                getContext().registerReceiver(receiver, filter);
            }
            watching = true;
        }
        JSObject ret = new JSObject();
        ret.put("watching", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopWatching(PluginCall call) {
        if (watching && receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {
            }
            receiver = null;
            watching = false;
        }
        call.resolve();
    }

    private boolean hasSmsPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }
}
