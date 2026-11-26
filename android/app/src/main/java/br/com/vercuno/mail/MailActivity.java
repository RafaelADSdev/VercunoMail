package br.com.vercuno.mail;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Arrays;

public final class MailActivity extends Activity {
    static final String HOST = "mail.vercuno.com.br";
    static final String ORIGIN = "https://" + HOST;
    static final String HOME = ORIGIN + "/inbox";
    private static final int FILE_PICKER = 1;
    private static final String WEB_STATE = "vercuno-webmail-state";

    private WebView web;
    private LinearLayout root;
    private ProgressBar progress;
    private LinearLayout failure;
    private ValueCallback<Uri[]> fileCallback;
    private AttachmentDownloads downloads;
    private WebmailAppearance appearance;
    private String failedUrl;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setDecorFitsSystemWindows(false);
        downloads = new AttachmentDownloads(this);
        appearance = new WebmailAppearance(getAssets());
        setupViews();
        setupWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
        }
        Bundle webState = state == null ? null : state.getBundle(WEB_STATE);
        if (webState == null || web.restoreState(webState) == null) openHome();
    }

    private void setupViews() {
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            var bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            var keyboard = insets.getInsets(WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsets.CONSUMED;
        });

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, -1, dp(2));
        progress.setVisibility(View.GONE);

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        failure = new LinearLayout(this);
        failure.setOrientation(LinearLayout.VERTICAL);
        failure.setGravity(android.view.Gravity.CENTER);
        failure.setPadding(dp(24), dp(24), dp(24), dp(24));
        TextView explanation = new TextView(this);
        explanation.setText(R.string.connection_failed);
        explanation.setTextSize(16);
        explanation.setGravity(android.view.Gravity.CENTER);
        failure.addView(explanation, -1, -2);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> open(failedUrl == null ? HOME : failedUrl));
        failure.addView(retry, -2, -2);
        failure.setVisibility(View.GONE);
        root.addView(failure, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        applyColors();
    }

    private void applyColors() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        int background = Color.parseColor(dark ? "#211A29" : "#F7F4FA");
        int foreground = Color.parseColor(dark ? "#E9D8FC" : "#623393");
        root.setBackgroundColor(background);
        web.setBackgroundColor(background);
        ((TextView) failure.getChildAt(0)).setTextColor(foreground);
        ((Button) failure.getChildAt(1)).setTextColor(foreground);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        WindowInsetsController controller = getWindow().getInsetsController();
        if (controller != null) controller.setSystemBarsAppearance(dark ? 0 : lightBars, lightBars);
    }

    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        applyColors();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        var settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new MailClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int percent) {
                progress.setProgress(percent);
                progress.setVisibility(percent < 100 && failure.getVisibility() != View.VISIBLE ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!trusted(parse(view.getUrl()))) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(picker, FILE_PICKER);
                } catch (ActivityNotFoundException ex) {
                    finishFileSelection(null);
                    toast("Não foi possível abrir o seletor de arquivos.");
                }
                return true;
            }
        });
        DownloadListener listener = (url, agent, disposition, mime, size) -> {
            String filename = URLUtil.guessFileName(url, disposition, mime);
            downloads.chooseDestination(url, filename);
        };
        web.setDownloadListener(listener);
    }

    private final class MailClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (!trusted(uri)) {
                openExternal(uri);
                return true;
            }
            return false;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
            failure.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            if (!trusted(parse(url))) {
                view.stopLoading();
                openHome();
            }
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            if (trusted(parse(url))) appearance.apply(view);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            if (trusted(parse(url))) appearance.apply(view);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showFailure(request.getUrl());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) showFailure(request.getUrl());
        }
    }

    private void showFailure(Uri uri) {
        failedUrl = trusted(uri) ? uri.toString() : HOME;
        progress.setVisibility(View.GONE);
        web.setVisibility(View.GONE);
        failure.setVisibility(View.VISIBLE);
    }

    private void openHome() {
        open(HOME);
    }

    private void open(String url) {
        if (trusted(parse(url))) web.loadUrl(url);
    }

    private void goBack() {
        if (failure.getVisibility() == View.VISIBLE) {
            openHome();
        } else {
            web.evaluateJavascript("Boolean(window.vercunoAndroid?.back())", handled -> {
                if ("true".equals(handled)) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            });
        }
    }

    @Override
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        // Android 13+ uses the OnBackInvoked callback registered in onCreate.
        if (Build.VERSION.SDK_INT < 33) goBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        Bundle webState = new Bundle();
        web.saveState(webState);
        state.putBundle(WEB_STATE, webState);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_PICKER) finishFileSelection(WebChromeClient.FileChooserParams.parseResult(result, data));
        if (request == AttachmentDownloads.SAVE_REQUEST) downloads.onDestination(result, data);
    }

    private void finishFileSelection(Uri[] files) {
        if (fileCallback == null) return;
        ValueCallback<Uri[]> callback = fileCallback;
        fileCallback = null;
        Uri[] selected = files == null ? null : Arrays.stream(files)
            .filter(uri -> uri != null && "content".equals(uri.getScheme()))
            .toArray(Uri[]::new);
        callback.onReceiveValue(selected != null && selected.length > 0 ? selected : null);
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme) && !"tel".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ex) {
            toast("Nenhum aplicativo disponível para abrir este link.");
        }
    }

    static Uri parse(String url) {
        return url == null ? Uri.EMPTY : Uri.parse(url);
    }

    static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme())
            && (HOST.equalsIgnoreCase(uri.getEncodedAuthority()) || (HOST + ":443").equalsIgnoreCase(uri.getEncodedAuthority()));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
