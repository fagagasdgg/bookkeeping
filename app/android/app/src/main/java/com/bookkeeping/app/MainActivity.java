package com.bookkeeping.app;

import android.os.Bundle;

import com.bookkeeping.app.plugins.BackgroundKeepPlugin;
import com.bookkeeping.app.plugins.NotifyListenerPlugin;
import com.bookkeeping.app.plugins.SmsReaderPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        registerPlugin(NotifyListenerPlugin.class);
        registerPlugin(BackgroundKeepPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
