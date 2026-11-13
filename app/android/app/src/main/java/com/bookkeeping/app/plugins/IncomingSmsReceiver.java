package com.bookkeeping.app.plugins;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;

public class IncomingSmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null || pdus.length == 0) return;

        String format = bundle.getString("format");
        StringBuilder body = new StringBuilder();
        String address = null;
        long date = System.currentTimeMillis();

        for (Object pdu : pdus) {
            SmsMessage msg;
            if (format != null) {
                msg = SmsMessage.createFromPdu((byte[]) pdu, format);
            } else {
                msg = SmsMessage.createFromPdu((byte[]) pdu);
            }
            if (msg == null) continue;
            if (address == null) address = msg.getDisplayOriginatingAddress();
            String part = msg.getMessageBody();
            if (part != null) body.append(part);
            date = msg.getTimestampMillis();
        }

        long syntheticId = date;
        SmsReaderPlugin.emitSms(syntheticId, address, body.toString(), date, null);
    }
}
