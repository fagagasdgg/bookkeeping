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
        String address = "";
        long date = System.currentTimeMillis();

        for (Object pdu : pdus) {
            SmsMessage message;
            if (format != null) {
                message = SmsMessage.createFromPdu((byte[]) pdu, format);
            } else {
                message = SmsMessage.createFromPdu((byte[]) pdu);
            }
            if (message == null) continue;
            if (address.isEmpty()) address = message.getDisplayOriginatingAddress();
            body.append(message.getMessageBody());
            date = message.getTimestampMillis();
        }

        long syntheticId = (address + ":" + date + ":" + body).hashCode() & 0xffffffffL;
        SmsReaderPlugin.emitSms(syntheticId, address, body.toString(), date, null);
    }
}
