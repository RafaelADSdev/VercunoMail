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

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Map;

public final class MailActivity extends Activity {
    static final String HOST = "mail.vercuno.com.br";
    static final String ORIGIN = "https://" + HOST;
    static final String APP_PATH = "/__vercuno_android__/";
    static final String HOME = ORIGIN + APP_PATH;
    private static final int FILE_PICKER = 1;
    private static final Map<String, String> ASSETS = Map.of(
        "", "text/html", "mail.css", "text/css", "mail.js", "text/javascript",
        "compose.js", "text/javascript", "ui.js", "text/javascript", "brand.webp", "image/webp"
    );
    private static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self'; "
        + "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    private WebView web;
    private LinearLayout root;
    private Button webBack;
    private ProgressBar progress;
    private LinearLayout failure;
    private ValueCallback<Uri[]> fileCallback;
    private AttachmentDownloads downloads;
    private boolean returningFromLogin;
    private boolean clearLoginHistory;
    private String failedUrl;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setDecorFitsSystemWindows(false);
        downloads = new AttachmentDownloads(this);
        setupViews();
        setupWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::goBack);
        }
        if (state == null || web.restoreState(state) == null) openHome();
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

        webBack = new Button(this, null, android.R.attr.borderlessButtonStyle);
        webBack.setText(R.string.back_to_inbox);
        webBack.setAllCaps(false);
        webBack.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
        webBack.setMinHeight(dp(48));
        webBack.setOnClickListener(view -> openHome());
        webBack.setVisibility(View.GONE);
        root.addView(webBack, -1, -2);

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
        webBack.setTextColor(foreground);
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
                progress.setVisibility(percent < 100 && failure.getVisibility() != View.VISIBLE
                    && !isApp(view.getUrl()) ? View.VISIBLE : View.GONE);
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
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!trusted(url)) return null;
            String path = url.getEncodedPath();
            // The app supplies its own offline screen and must receive local
            // navigation requests before the website's service worker.
            if ("/sw.js".equals(path)) return missingAsset();
            if (!path.startsWith(APP_PATH) || !"GET".equals(request.getMethod())) return null;
            String asset = path.substring(APP_PATH.length());
            String mime = ASSETS.get(asset);
            if (mime == null) return missingAsset();
            try {
                InputStream stream = getAssets().open("mail/" + (asset.isEmpty() ? "index.html" : asset));
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", Map.of(
                    "Content-Security-Policy", CSP,
                    "Cache-Control", "no-store",
                    "X-Content-Type-Options", "nosniff",
                    "Referrer-Policy", "same-origin"
                ), stream);
            } catch (IOException ex) {
                return missingAsset();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (!trusted(uri)) {
                openExternal(uri);
                return true;
            }
            return replaceLoginRedirect(uri);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
            Uri uri = parse(url);
            if (!trusted(uri)) return;
            String path = uri.getPath();
            if (isAuth(path)) returningFromLogin = true;
            if (replaceLoginRedirect(uri)) return;
            webBack.setVisibility(!isApp(url) && !isAuth(path) ? View.VISIBLE : View.GONE);
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
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
            if (clearLoginHistory && isApp(url)) {
                view.clearHistory();
                clearLoginHistory = false;
            }
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

    private boolean replaceLoginRedirect(Uri url) {
        if (!returningFromLogin || !"/inbox".equals(url.getPath()) || url.getQuery() != null) return false;
        returningFromLogin = false;
        clearLoginHistory = true;
        web.post(this::openHome);
        return true;
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
        } else if (isApp(web.getUrl())) {
            web.evaluateJavascript("Boolean(window.mailBack && window.mailBack())", handled -> {
                if (!"true".equals(handled)) finish();
            });
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            finish();
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
        web.saveState(state);
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

    private static WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(
            "Cache-Control", "no-store"
        ), new ByteArrayInputStream(new byte[0]));
    }

    static Uri parse(String url) {
        return url == null ? Uri.EMPTY : Uri.parse(url);
    }

    static boolean trusted(Uri uri) {
        return "https".equals(uri.getScheme())
            && (HOST.equalsIgnoreCase(uri.getEncodedAuthority()) || (HOST + ":443").equalsIgnoreCase(uri.getEncodedAuthority()));
    }

    private static boolean isApp(String url) {
        Uri uri = parse(url);
        return trusted(uri) && APP_PATH.equals(uri.getPath());
    }

    private static boolean isAuth(String path) {
        return path != null && (path.equals("/login") || path.equals("/setup") || path.equals("/onboarding")
            || path.startsWith("/forgot-password") || path.startsWith("/reset-password")
            || path.startsWith("/passkey-setup") || path.startsWith("/register"));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
