package com.bookkeeping.app.plugins;

import android.Manifest;
import android.content.ContentResolver;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
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

    @PluginMethod
    public void queryInbox(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }

        String address = call.getString("address");
        String bodyContains = call.getString("bodyContains");
        int limit = call.getInt("limit", 2000);

        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.PERSON
        };

        // Prefer SQL LIKE so OEM-prefixed numbers like 1069...95588 still hit.
        String selection = null;
        String[] selectionArgs = null;
        boolean hasAddress = address != null && !address.isEmpty();
        boolean hasBody = bodyContains != null && !bodyContains.isEmpty();
        if (hasAddress && hasBody) {
            selection = "(" + Telephony.Sms.ADDRESS + " LIKE ? OR " + Telephony.Sms.BODY + " LIKE ? OR "
                + Telephony.Sms.BODY + " LIKE ?)";
            selectionArgs = new String[]{
                "%" + address + "%",
                "%" + bodyContains + "%",
                "%" + address + "%"
            };
        } else if (hasAddress) {
            selection = "(" + Telephony.Sms.ADDRESS + " LIKE ? OR " + Telephony.Sms.BODY + " LIKE ?)";
            selectionArgs = new String[]{"%" + address + "%", "%" + address + "%"};
        } else if (hasBody) {
            selection = Telephony.Sms.BODY + " LIKE ?";
            selectionArgs = new String[]{"%" + bodyContains + "%"};
        }

        JSArray messages = new JSArray();
        try (Cursor cursor = resolver.query(
            uri,
            projection,
            selection,
            selectionArgs,
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    String addr = cursor.getString(1);
                    String body = cursor.getString(2);
                    // Extra normalized digit check for address filters.
                    if (hasAddress) {
                        String normWant = normalizePhone(address);
                        String normHave = normalizePhone(addr == null ? "" : addr);
                        boolean addrMatch =
                            normHave.equals(normWant)
                                || normHave.contains(normWant)
                                || normWant.contains(normHave)
                                || (addr != null && addr.contains(address));
                        boolean bodyMatch = hasBody && body != null
                            && body.toLowerCase().contains(bodyContains.toLowerCase());
                        boolean addressInBody = body != null && body.contains(address);
                        if (!addrMatch && !bodyMatch && !addressInBody) {
                            continue;
                        }
                    } else if (hasBody) {
                        String blob = ((addr == null ? "" : addr) + "\n" + (body == null ? "" : body)).toLowerCase();
                        if (!blob.contains(bodyContains.toLowerCase())) continue;
                    }

                    JSObject msg = new JSObject();
                    msg.put("id", cursor.getLong(0));
                    msg.put("address", addr == null ? "" : addr);
                    msg.put("body", body == null ? "" : body);
                    msg.put("date", cursor.getLong(3));
                    String person = cursor.isNull(4) ? null : cursor.getString(4);
                    if (person != null) msg.put("person", person);
                    messages.put(msg);
                    count++;
                }
            }
        } catch (Exception e) {
            call.reject("queryInbox failed: " + e.getMessage(), e);
            return;
        }

        JSObject ret = new JSObject();
        ret.put("messages", messages);
        call.resolve(ret);
    }

    @PluginMethod
    public void probeSenders(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }
        int limit = call.getInt("limit", 80);
        String needle = call.getString("needle", "");
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.PERSON
        };
        JSArray samples = new JSArray();
        try (Cursor cursor = resolver.query(uri, projection, null, null, Telephony.Sms.DATE + " DESC")) {
            if (cursor != null) {
                int seen = 0;
                while (cursor.moveToNext() && seen < limit) {
                    String addr = cursor.getString(0);
                    String body = cursor.getString(1);
                    if (needle != null && !needle.isEmpty()) {
                        String blob = ((addr == null ? "" : addr) + "\n" + (body == null ? "" : body));
                        if (!blob.contains(needle)) continue;
                    }
                    JSObject row = new JSObject();
                    row.put("address", addr == null ? "" : addr);
                    row.put("person", cursor.isNull(3) ? "" : cursor.getString(3));
                    row.put("date", cursor.getLong(2));
                    String preview = body == null ? "" : body;
                    if (preview.length() > 60) preview = preview.substring(0, 60) + "…";
                    row.put("preview", preview);
                    samples.put(row);
                    seen++;
                }
            }
        } catch (Exception e) {
            call.reject("probeSenders failed: " + e.getMessage(), e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("samples", samples);
        call.resolve(ret);
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

    private static String normalizePhone(String address) {
        String digits = address.replaceAll("\\D", "");
        if (digits.length() == 13 && digits.startsWith("86")) {
            return digits.substring(2);
        }
        return digits;
    }
}
