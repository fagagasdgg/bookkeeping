package com.bookkeeping.app.plugins;

import android.Manifest;
import android.content.ActivityNotFoundException;
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

    @PluginMethod
    public void queryInbox(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }

        String address = call.getString("address");
        String bodyContains = call.getString("bodyContains");
        int limit = call.getInt("limit", 2000);

        // Use all-sms table (not only inbox view) — some OEMs classify differently.
        Uri uri = Telephony.Sms.CONTENT_URI;
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.PERSON,
            Telephony.Sms.TYPE
        };

        // Prefer SQL LIKE so OEM-prefixed numbers like 1069...95588 still hit.
        // Restrict to inbox-like types (1=inbox, also accept unknown).
        StringBuilder sel = new StringBuilder("(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL)");
        java.util.ArrayList<String> args = new java.util.ArrayList<>();
        boolean hasAddress = address != null && !address.isEmpty();
        boolean hasBody = bodyContains != null && !bodyContains.isEmpty();
        if (hasAddress && hasBody) {
            sel.append(" AND (").append(Telephony.Sms.ADDRESS).append(" LIKE ? OR ")
                .append(Telephony.Sms.BODY).append(" LIKE ? OR ")
                .append(Telephony.Sms.BODY).append(" LIKE ?)");
            args.add("%" + address + "%");
            args.add("%" + bodyContains + "%");
            args.add("%" + address + "%");
        } else if (hasAddress) {
            sel.append(" AND (").append(Telephony.Sms.ADDRESS).append(" LIKE ? OR ")
                .append(Telephony.Sms.BODY).append(" LIKE ?)");
            args.add("%" + address + "%");
            args.add("%" + address + "%");
        } else if (hasBody) {
            sel.append(" AND ").append(Telephony.Sms.BODY).append(" LIKE ?");
            args.add("%" + bodyContains + "%");
        }
        String selection = sel.toString();
        String[] selectionArgs = args.toArray(new String[0]);

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
    public void queryRecent(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }
        int limit = call.getInt("limit", 300);
        Uri uri = Telephony.Sms.CONTENT_URI;
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.PERSON,
            Telephony.Sms.TYPE
        };
        JSArray messages = new JSArray();
        try (Cursor cursor = resolver.query(
            uri,
            projection,
            Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL",
            null,
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                int count = 0;
                while (cursor.moveToNext() && count < limit) {
                    JSObject msg = new JSObject();
                    msg.put("id", cursor.getLong(0));
                    String addr = cursor.getString(1);
                    msg.put("address", addr == null ? "" : addr);
                    String body = cursor.getString(2);
                    msg.put("body", body == null ? "" : body);
                    msg.put("date", cursor.getLong(3));
                    String person = cursor.isNull(4) ? null : cursor.getString(4);
                    if (person != null) msg.put("person", person);
                    messages.put(msg);
                    count++;
                }
            }
        } catch (Exception e) {
            call.reject("queryRecent failed: " + e.getMessage(), e);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("messages", messages);
        call.resolve(ret);
    }

    /**
     * Locate SMS conversations by needle (e.g. 95588) then pull ALL messages in those threads.
     * Mirrors the phone SMS app UX: one list row → many messages inside the chat.
     */
    @PluginMethod
    public void queryConversation(PluginCall call) {
        if (!hasSmsPermission()) {
            call.reject("READ_SMS permission not granted");
            return;
        }
        String needle = call.getString("needle", "");
        if (needle == null) needle = "";
        needle = needle.trim();
        if (needle.isEmpty()) {
            call.reject("needle is required, e.g. 95588");
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

        java.util.LinkedHashSet<Long> threadIds = new java.util.LinkedHashSet<>();
        java.util.LinkedHashSet<String> seedAddresses = new java.util.LinkedHashSet<>();
        int seedHits = 0;

        // Pass 1: find any inbox-ish rows whose address/body mentions the needle → collect thread_ids.
        String like = "%" + needle + "%";
        try (Cursor cursor = resolver.query(
            uri,
            projection,
            "(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL) AND ("
                + Telephony.Sms.ADDRESS + " LIKE ? OR " + Telephony.Sms.BODY + " LIKE ?)",
            new String[]{like, like},
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    seedHits++;
                    if (!cursor.isNull(6)) {
                        threadIds.add(cursor.getLong(6));
                    }
                    String addr = cursor.getString(1);
                    if (addr != null && !addr.isEmpty()) seedAddresses.add(addr);
                    // Cap seed scan so we don't hang on huge DBs; thread pull is the real source.
                    if (seedHits >= 800) break;
                }
            }
        } catch (Exception e) {
            call.reject("queryConversation seed failed: " + e.getMessage(), e);
            return;
        }

        JSArray messages = new JSArray();
        java.util.LinkedHashMap<Long, JSObject> byId = new java.util.LinkedHashMap<>();
        java.util.LinkedHashSet<String> discoveredAddresses = new java.util.LinkedHashSet<>();

        // Pass 2a: pull every message belonging to discovered threads (full conversation).
        if (!threadIds.isEmpty()) {
            StringBuilder in = new StringBuilder();
            java.util.ArrayList<String> args = new java.util.ArrayList<>();
            for (Long tid : threadIds) {
                if (in.length() > 0) in.append(",");
                in.append("?");
                args.add(String.valueOf(tid));
            }
            String selection =
                "(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL) AND "
                    + Telephony.Sms.THREAD_ID + " IN (" + in + ")";
            try (Cursor cursor = resolver.query(
                uri,
                projection,
                selection,
                args.toArray(new String[0]),
                Telephony.Sms.DATE + " DESC"
            )) {
                if (cursor != null) {
                    while (cursor.moveToNext() && byId.size() < limit) {
                        putConversationMessage(byId, discoveredAddresses, cursor);
                    }
                }
            } catch (Exception e) {
                call.reject("queryConversation thread pull failed: " + e.getMessage(), e);
                return;
            }
        }

        // Pass 2b: fallback / supplement — address LIKE needle (covers OEMs with null thread_id).
        try (Cursor cursor = resolver.query(
            uri,
            projection,
            "(" + Telephony.Sms.TYPE + "=1 OR " + Telephony.Sms.TYPE + " IS NULL) AND "
                + Telephony.Sms.ADDRESS + " LIKE ?",
            new String[]{like},
            Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                while (cursor.moveToNext() && byId.size() < limit) {
                    putConversationMessage(byId, discoveredAddresses, cursor);
                }
            }
        } catch (Exception e) {
            call.reject("queryConversation address pull failed: " + e.getMessage(), e);
            return;
        }

        for (JSObject msg : byId.values()) {
            messages.put(msg);
            if (messages.length() >= limit) break;
        }

        JSArray threads = new JSArray();
        for (Long tid : threadIds) threads.put(tid);
        JSArray addrs = new JSArray();
        for (String a : discoveredAddresses) addrs.put(a);
        JSArray seeds = new JSArray();
        for (String a : seedAddresses) seeds.put(a);

        JSObject ret = new JSObject();
        ret.put("messages", messages);
        ret.put("threadIds", threads);
        ret.put("discoveredAddresses", addrs);
        ret.put("seedAddresses", seeds);
        ret.put("seedHits", seedHits);
        ret.put("conversationCount", messages.length());
        call.resolve(ret);
    }

    private static void putConversationMessage(
        java.util.LinkedHashMap<Long, JSObject> byId,
        java.util.LinkedHashSet<String> discoveredAddresses,
        Cursor cursor
    ) {
        long id = cursor.getLong(0);
        if (byId.containsKey(id)) return;
        String addr = cursor.getString(1);
        String body = cursor.getString(2);
        JSObject msg = new JSObject();
        msg.put("id", id);
        msg.put("address", addr == null ? "" : addr);
        msg.put("body", body == null ? "" : body);
        msg.put("date", cursor.getLong(3));
        String person = cursor.isNull(4) ? null : cursor.getString(4);
        if (person != null) msg.put("person", person);
        if (!cursor.isNull(6)) msg.put("threadId", cursor.getLong(6));
        byId.put(id, msg);
        if (addr != null && !addr.isEmpty()) discoveredAddresses.add(addr);
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
    public void diagnoseInbox(PluginCall call) {
        JSObject ret = new JSObject();
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String brand = Build.BRAND == null ? "" : Build.BRAND;
        ret.put("manufacturer", manufacturer);
        ret.put("brand", brand);
        ret.put("permissionGranted", hasSmsPermission());
        ret.put("oemLikelyXiaomiFamily", isXiaomiFamily(manufacturer, brand));
        ret.put("oemLikelyVivoFamily", isVivoFamily(manufacturer, brand));
        JSArray rawAddresses = new JSArray();

        if (!hasSmsPermission()) {
            ret.put("totalInbox", 0);
            ret.put("bankLikeCount", 0);
            ret.put("likelyMissingNotificationSms", false);
            ret.put("rawAddresses", rawAddresses);
            ret.put("hint", "系统短信权限未授予。请先申请读取短信。");
            call.resolve(ret);
            return;
        }

        int total = 0;
        int bankLike = 0;
        int icbcAddrCount = 0;
        int icbcLedgerCount = 0;
        // Scan full sms table — classic SMS only; OEM「服务号/智能短信」often NOT here.
        Uri uri = Telephony.Sms.CONTENT_URI;
        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = new String[]{
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.TYPE
        };
        try (Cursor cursor = resolver.query(uri, projection, null, null, Telephony.Sms.DATE + " DESC")) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    total++;
                    String addr = cursor.getString(0);
                    String body = cursor.getString(1);
                    if (rawAddresses.length() < 15) {
                        rawAddresses.put(addr == null ? "(空地址)" : addr);
                    }
                    String blob = ((addr == null ? "" : addr) + "\n" + (body == null ? "" : body));
                    boolean addr95588 = addr != null && addr.contains("95588");
                    boolean body95588 = body != null && body.contains("95588");
                    if (addr95588 || body95588) icbcAddrCount++;
                    boolean hasAmount = body != null && (body.contains("元") || body.contains("￥") || body.contains("¥"));
                    boolean ledgerHint = body != null && (
                        body.contains("支出") || body.contains("收入") || body.contains("入账")
                            || body.contains("扣款") || body.contains("尾号") || body.contains("工商银行")
                    );
                    if ((addr95588 || (body != null && body.contains("工商银行"))) && hasAmount && ledgerHint) {
                        icbcLedgerCount++;
                    }
                    if (blob.contains("95588")
                        || blob.contains("工商银行")
                        || blob.contains("财付通")
                        || blob.contains("支出")
                        || blob.contains("支付宝")
                        || blob.contains("【") && blob.contains("银行")) {
                        bankLike++;
                    }
                }
            }
        } catch (Exception e) {
            ret.put("totalInbox", 0);
            ret.put("bankLikeCount", 0);
            ret.put("icbcAddrCount", 0);
            ret.put("icbcLedgerCount", 0);
            ret.put("likelyMissingNotificationSms", true);
            ret.put("likelyServiceNumberIsolation", false);
            ret.put("rawAddresses", rawAddresses);
            ret.put("hint", "读取短信库失败：" + e.getMessage());
            call.resolve(ret);
            return;
        }

        // Classic SMS rows exist for 95588, but none look like ledger → OEM service-number UI.
        boolean serviceIsolation = icbcAddrCount > 0 && icbcLedgerCount == 0;
        boolean likelyMissing = bankLike == 0 || serviceIsolation;
        ret.put("totalInbox", total);
        ret.put("bankLikeCount", bankLike);
        ret.put("icbcAddrCount", icbcAddrCount);
        ret.put("icbcLedgerCount", icbcLedgerCount);
        ret.put("likelyMissingNotificationSms", likelyMissing);
        ret.put("likelyServiceNumberIsolation", serviceIsolation);
        ret.put("rawAddresses", rawAddresses);
        if (serviceIsolation) {
            ret.put(
                "hint",
                "标准短信库能看到 " + icbcAddrCount
                    + " 条与 95588 相关，但 0 条动账正文。短信 App 里点开后的大量动账多半在「服务号/通知短信/智能短信」分区，厂商不开放给第三方读取。"
                    + "历史动账读不到；请开通知使用权，靠之后短信通知实时记账。支付宝/微信走通知通道更稳。"
            );
        } else if (bankLike == 0 && isXiaomiFamily(manufacturer, brand)) {
            ret.put(
                "hint",
                "可读短信库 " + total + " 条，银行类 0。小米路径：设置→应用设置→本应用→其他权限→打开「通知类短信」。可再试「按正文扫描」。"
            );
        } else if (bankLike == 0 && isVivoFamily(manufacturer, brand)) {
            ret.put(
                "hint",
                "可读短信库 " + total + " 条，银行类 0。iQOO/vivo 动账常在「服务号」里，标准短信库读不到。"
                    + "请开通知使用权做实时兜底；历史服务号消息无法回放。"
            );
        } else if (bankLike == 0) {
            ret.put(
                "hint",
                "可读短信库 " + total + " 条，银行类 0。请开通知类/服务短信权限，或改用通知使用权捕获之后的动账通知。"
            );
        } else {
            ret.put(
                "hint",
                "可读短信库 " + total + " 条，其中疑似银行/支付相关 " + bankLike
                    + " 条（95588 相关 " + icbcAddrCount + "，动账正文 " + icbcLedgerCount + "）。"
            );
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppPermissionSettings(PluginCall call) {
        try {
            openMiuiOrAppDetails();
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开应用权限页: " + e.getMessage());
        }
    }

    private void openMiuiOrAppDetails() {
        String pkg = getContext().getPackageName();
        if (isXiaomiFamily(Build.MANUFACTURER, Build.BRAND)) {
            try {
                Intent intent = new Intent("miui.intent.action.APP_PERM_EDITOR");
                intent.setClassName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity"
                );
                intent.putExtra("extra_pkgname", pkg);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                return;
            } catch (ActivityNotFoundException e1) {
                try {
                    Intent intent = new Intent("miui.intent.action.APP_PERM_EDITOR");
                    intent.setClassName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.permissions.AppPermissionsEditorActivity"
                    );
                    intent.putExtra("extra_pkgname", pkg);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    return;
                } catch (Exception ignored) {
                }
            } catch (Exception ignored) {
            }
        }
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        details.setData(Uri.parse("package:" + pkg));
        details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(details);
    }

    private static boolean isXiaomiFamily(String manufacturer, String brand) {
        String blob = ((manufacturer == null ? "" : manufacturer) + " " + (brand == null ? "" : brand)).toLowerCase();
        return blob.contains("xiaomi") || blob.contains("redmi") || blob.contains("poco");
    }

    private static boolean isVivoFamily(String manufacturer, String brand) {
        String blob = ((manufacturer == null ? "" : manufacturer) + " " + (brand == null ? "" : brand)).toLowerCase();
        return blob.contains("vivo") || blob.contains("iqoo");
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
        if (address == null) return "";
        String s = address.trim();
        s = s.replaceAll("[（(]\\s*卡\\s*[12]\\s*[)）]", "");
        s = s.replaceAll("(?i)[-_]?sim\\s*[12]\\b", "");
        s = s.replaceAll("[-_][12]$", "");
        String digits = s.replaceAll("\\D", "");
        if (digits.length() == 13 && digits.startsWith("86")) {
            return digits.substring(2);
        }
        if (digits.length() == 14 && digits.startsWith("086")) {
            return digits.substring(3);
        }
        return digits;
    }
}
