package com.bookkeeping.app.plugins;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundKeep")
public class BackgroundKeepPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring());
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("brand", Build.BRAND == null ? "" : Build.BRAND);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (isIgnoring()) {
            JSObject ret = new JSObject();
            ret.put("ignoring", true);
            call.resolve(ret);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
            } catch (Exception ignored) {
                call.reject("无法打开电池优化设置: " + e.getMessage());
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring());
        call.resolve(ret);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context context = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开电池优化列表: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openAutostartSettings(PluginCall call) {
        Context context = getContext();
        String brand = (Build.MANUFACTURER == null ? "" : Build.MANUFACTURER).toLowerCase();
        Intent[] candidates = buildAutostartIntents(context, brand);
        for (Intent intent : candidates) {
            try {
                if (intent.resolveActivity(context.getPackageManager()) != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("opened", true);
                    call.resolve(ret);
                    return;
                }
            } catch (Exception ignored) {
            }
        }
        // Fallback: app details page where users can find battery / autostart
        try {
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            details.setData(Uri.parse("package:" + context.getPackageName()));
            details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(details);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            ret.put("fallback", "appDetails");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("无法打开自启动/应用详情设置: " + e.getMessage());
        }
    }

    private boolean isIgnoring() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) return false;
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private Intent[] buildAutostartIntents(Context context, String brand) {
        return new Intent[]{
            // Xiaomi / Redmi / POCO
            new Intent().setComponent(new ComponentName(
                "com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity")),
            // Huawei / Honor
            new Intent().setComponent(new ComponentName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")),
            new Intent().setComponent(new ComponentName(
                "com.huawei.systemmanager",
                "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")),
            // OPPO / Realme
            new Intent().setComponent(new ComponentName(
                "com.coloros.safecenter",
                "com.coloros.safecenter.permission.startup.StartupAppListActivity")),
            new Intent().setComponent(new ComponentName(
                "com.oppo.safe",
                "com.oppo.safe.permission.startup.StartupAppListActivity")),
            // Vivo
            new Intent().setComponent(new ComponentName(
                "com.iqoo.secure",
                "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")),
            new Intent().setComponent(new ComponentName(
                "com.vivo.permissionmanager",
                "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")),
            // Samsung
            new Intent().setComponent(new ComponentName(
                "com.samsung.android.lool",
                "com.samsung.android.sm.battery.ui.BatteryActivity")),
            // OnePlus
            new Intent().setComponent(new ComponentName(
                "com.oneplus.security",
                "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")),
            // Generic app details as last resort is handled separately
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + context.getPackageName())),
        };
    }
}
