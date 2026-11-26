package br.com.vercuno.mail;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.webkit.CookieManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

final class AttachmentDownloads {
    static final int SAVE_REQUEST = 2;
    private static final Pattern DOWNLOAD_PATH = Pattern.compile(
        "/api/messages/[^/]+/(?:attachments/[^/]+|attachments\\.zip|original)"
    );
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private final MailActivity activity;
    private String pendingUrl;

    AttachmentDownloads(MailActivity activity) {
        this.activity = activity;
    }

    void chooseDestination(String url, String filename) {
        Uri uri = MailActivity.parse(url);
        String path = uri.getEncodedPath();
        if (!MailActivity.trusted(uri) || path == null || !DOWNLOAD_PATH.matcher(path).matches()) {
            activity.toast("Use o botão de download do anexo na mensagem.");
            return;
        }
        if (pendingUrl != null) return;
        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("application/octet-stream");
        picker.putExtra(Intent.EXTRA_TITLE, filename.replace('/', '_').replace('\\', '_'));
        pendingUrl = url;
        try {
            activity.startActivityForResult(picker, SAVE_REQUEST);
        } catch (ActivityNotFoundException ex) {
            pendingUrl = null;
            activity.toast("Não foi possível abrir o seletor de arquivos.");
        }
    }

    void onDestination(int result, Intent data) {
        String url = pendingUrl;
        pendingUrl = null;
        if (url == null || result != Activity.RESULT_OK || data == null || data.getData() == null) return;
        Uri destination = data.getData();
        String cookies = CookieManager.getInstance().getCookie(MailActivity.ORIGIN);
        IO.execute(() -> save(url, destination, cookies));
    }

    private void save(String url, Uri destination, String cookies) {
        HttpsURLConnection connection = null;
        String feedback;
        try {
            connection = (HttpsURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            if (connection.getResponseCode() != 200) throw new IOException("Download refused");

            long copied = 0;
            try (InputStream source = connection.getInputStream();
                 OutputStream target = activity.getContentResolver().openOutputStream(destination, "wt")) {
                if (target == null) throw new IOException("Unavailable document");
                byte[] buffer = new byte[32_768];
                int count;
                while ((count = source.read(buffer)) != -1) {
                    target.write(buffer, 0, count);
                    copied += count;
                }
            }
            long expected = connection.getContentLengthLong();
            if (expected >= 0 && copied != expected) throw new IOException("Incomplete attachment");
            feedback = "Anexo salvo.";
        } catch (IOException | SecurityException ex) {
            try {
                DocumentsContract.deleteDocument(activity.getContentResolver(), destination);
            } catch (IOException | RuntimeException ignored) {
                // The chosen document provider may not support deletion.
            }
            feedback = "Não foi possível salvar o anexo. Abra a mensagem e tente novamente.";
        } finally {
            if (connection != null) connection.disconnect();
        }
        String message = feedback;
        activity.runOnUiThread(() -> activity.toast(message));
    }
}
