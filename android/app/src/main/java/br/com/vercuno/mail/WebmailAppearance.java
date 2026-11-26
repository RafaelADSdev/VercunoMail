package br.com.vercuno.mail;

import android.content.res.AssetManager;
import android.util.Log;
import android.webkit.WebView;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class WebmailAppearance {
    private final String install;

    WebmailAppearance(AssetManager assets) {
        String script = null;
        try {
            String javascript = read(assets, "mail/appearance.js");
            String css = read(assets, "mail/appearance.css");
            script = javascript + "(" + JSONObject.quote(css) + "," + JSONObject.quote(MailActivity.ORIGIN) + ");";
        } catch (IOException error) {
            Log.e("VercunoMail", "Could not read the bundled webmail theme", error);
        }
        install = script;
    }

    void apply(WebView web) {
        if (install != null) web.evaluateJavascript(install, null);
    }

    private static String read(AssetManager assets, String path) throws IOException {
        StringBuilder result = new StringBuilder();
        try (InputStreamReader reader = new InputStreamReader(assets.open(path), StandardCharsets.UTF_8)) {
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) != -1) result.append(buffer, 0, count);
        }
        return result.toString();
    }
}
