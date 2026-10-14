package de.roemer.weihnachtsmarktbacken;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import org.json.JSONObject;

public class MainActivity extends Activity {
    private static final String LOCAL_HOST = "app.local";
    private static final String WEB_HOST = "weihnachtsmarkt-backen.vercel.app";
    private static final String RELEASE_MANIFEST = "https://" + WEB_HOST + "/mobile-release.json";
    private static final String RELEASE_URL_KEY = "released_web_url";
    private static final String RELEASE_VERSION_KEY = "released_web_version";
    private static final int CURRENT_NATIVE_VERSION = 10500;
    private static final int FILE_CHOOSER_REQUEST = 101;
    private static final int EXPORT_REQUEST = 102;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri pendingCameraUri;
    private String pendingExportJson;
    private String launchFragment = "";
    private boolean fallbackInProgress;
    private volatile boolean releaseCheckRunning;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(142, 31, 45));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 249, 248));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new LocalWebClient());
        webView.setWebChromeClient(new AppChromeClient());
        loadStartPage(getIntent());
        checkReleasedVersion();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadStartPage(intent);
    }

    private void loadStartPage(Intent intent) {
        Uri incoming = intent == null ? null : intent.getData();
        if (incoming != null && "https".equals(incoming.getScheme()) && WEB_HOST.equals(incoming.getHost())) {
            String encodedFragment = incoming.getEncodedFragment();
            if (encodedFragment != null && !encodedFragment.isEmpty()) launchFragment = "#" + encodedFragment;
        }
        String releasedUrl = getPreferences(MODE_PRIVATE).getString(RELEASE_URL_KEY, "");
        if (isAllowedReleaseUrl(releasedUrl)) webView.loadUrl(withFragment(releasedUrl, launchFragment));
        else webView.loadUrl("https://" + LOCAL_HOST + "/index.html" + launchFragment);
    }

    private final class LocalWebClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!LOCAL_HOST.equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            while (path.startsWith("/")) path = path.substring(1);
            if (path.contains("..")) return response(403, "text/plain", null);
            try {
                return response(200, mimeType(path), getAssets().open("www/" + path));
            } catch (IOException error) {
                return response(404, "text/plain", null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (LOCAL_HOST.equals(uri.getHost())) return false;
            if (WEB_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/mobile-releases/")) return false;
            if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            fallbackInProgress = false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (request.isForMainFrame() && WEB_HOST.equals(request.getUrl().getHost())) loadLocalFallback();
        }
    }

    private void checkReleasedVersion() {
        if (releaseCheckRunning) return;
        releaseCheckRunning = true;
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(RELEASE_MANIFEST).openConnection();
                    connection.setConnectTimeout(5000);
                    connection.setReadTimeout(5000);
                    connection.setRequestProperty("Cache-Control", "no-cache");
                    if (connection.getResponseCode() != 200) return;
                    BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder json = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) json.append(line);
                    reader.close();
                    JSONObject release = new JSONObject(json.toString());
                    final String version = release.optString("version", "");
                    final String path = release.optString("path", "");
                    final String releaseUrl = path.startsWith("/") ? "https://" + WEB_HOST + path : path;
                    if (version.isEmpty() || !isAllowedReleaseUrl(releaseUrl)) return;
                    int nativeVersion = release.optInt("nativeVersion", CURRENT_NATIVE_VERSION);
                    String apkPath = release.optString("apkPath", "");
                    String apkSha256 = release.optString("apkSha256", "");
                    if (nativeVersion > CURRENT_NATIVE_VERSION && !apkPath.isEmpty() && !apkSha256.isEmpty()) {
                        String apkUrl = apkPath.startsWith("/") ? "https://" + WEB_HOST + apkPath : apkPath;
                        if (isAllowedApkUrl(apkUrl)) downloadAndOfferApk(apkUrl, apkSha256);
                    }
                    getPreferences(MODE_PRIVATE).edit().putString(RELEASE_VERSION_KEY, version).putString(RELEASE_URL_KEY, releaseUrl).apply();
                    webView.post(new Runnable() {
                        @Override public void run() {
                            String current = webView.getUrl();
                            if (current == null || !stripFragment(current).equals(stripFragment(releaseUrl))) {
                                String fragment = current == null ? launchFragment : Uri.parse(current).getEncodedFragment();
                                webView.loadUrl(withFragment(releaseUrl, fragment == null || fragment.isEmpty() ? "" : "#" + fragment));
                            }
                        }
                    });
                } catch (Exception ignored) {
                } finally {
                    if (connection != null) connection.disconnect();
                    releaseCheckRunning = false;
                }
            }
        }, "mobile-release-check").start();
    }

    private boolean isAllowedReleaseUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        Uri uri = Uri.parse(value);
        return "https".equals(uri.getScheme()) && WEB_HOST.equals(uri.getHost()) && uri.getPath() != null && uri.getPath().startsWith("/mobile-releases/");
    }

    private boolean isAllowedApkUrl(String value) {
        if (value == null || value.isEmpty()) return false;
        Uri uri = Uri.parse(value);
        return "https".equals(uri.getScheme()) && WEB_HOST.equals(uri.getHost()) && uri.getPath() != null
                && uri.getPath().startsWith("/mobile-releases/") && uri.getPath().endsWith(".apk");
    }

    private void downloadAndOfferApk(String apkUrl, String expectedSha256) throws Exception {
        File updateDirectory = new File(getCacheDir(), "updates");
        if (!updateDirectory.exists() && !updateDirectory.mkdirs()) return;
        File apk = new File(updateDirectory, "app-update.apk");
        HttpURLConnection download = (HttpURLConnection) new URL(apkUrl).openConnection();
        download.setConnectTimeout(10000);
        download.setReadTimeout(20000);
        try {
            if (download.getResponseCode() != 200) return;
            try (InputStream input = download.getInputStream(); OutputStream output = new FileOutputStream(apk)) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
        } finally {
            download.disconnect();
        }
        if (!sha256(apk).equalsIgnoreCase(expectedSha256)) {
            apk.delete();
            return;
        }
        runOnUiThread(new Runnable() {
            @Override public void run() {
                offerApkInstallation();
            }
        });
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder value = new StringBuilder();
        for (byte item : digest.digest()) value.append(String.format("%02x", item));
        return value.toString();
    }

    private void offerApkInstallation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        Uri apkUri = Uri.parse("content://de.roemer.weihnachtsmarktbacken.updates/app-update.apk");
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(apkUri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(install);
    }

    private String stripFragment(String value) {
        int index = value.indexOf('#');
        return index < 0 ? value : value.substring(0, index);
    }

    private String withFragment(String url, String fragment) {
        return stripFragment(url) + (fragment == null ? "" : fragment);
    }

    private void loadLocalFallback() {
        if (fallbackInProgress) return;
        fallbackInProgress = true;
        String current = webView.getUrl();
        String fragment = current == null ? launchFragment : Uri.parse(current).getEncodedFragment();
        webView.loadUrl("https://" + LOCAL_HOST + "/index.html" + (fragment == null || fragment.isEmpty() ? "" : "#" + fragment));
    }

    private WebResourceResponse response(int status, String mime, InputStream stream) {
        if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
        return new WebResourceResponse(mime, "UTF-8", status, status == 200 ? "OK" : "Not Found", Collections.<String, String>emptyMap(), stream);
    }

    private String mimeType(String path) {
        if (path.endsWith(".txt")) return "text/plain";
        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return mime == null ? "application/octet-stream" : mime;
    }

    private final class AppChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent picker = params.createIntent();
            Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            boolean acceptsImages = false;
            for (String type : params.getAcceptTypes()) {
                if (type != null && (type.startsWith("image/") || type.equals("*/*"))) acceptsImages = true;
            }
            pendingCameraUri = acceptsImages ? createCameraUri() : null;
            if (pendingCameraUri != null) {
                camera.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            try {
                if (params.isCaptureEnabled() && pendingCameraUri != null) {
                    startActivityForResult(camera, FILE_CHOOSER_REQUEST);
                } else {
                    Intent chooser = Intent.createChooser(picker, "Datei oder Bonfoto auswählen");
                    if (pendingCameraUri != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                    startActivityForResult(chooser, FILE_CHOOSER_REQUEST);
                }
                return true;
            } catch (RuntimeException error) {
                fileCallback = null;
                discardPendingCameraUri();
                return false;
            }
        }
    }

    private Uri createCameraUri() {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "bonfoto-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        try {
            return getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        } catch (RuntimeException error) {
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) {
                    result = new Uri[]{data.getData()};
                    discardPendingCameraUri();
                }
                else if (pendingCameraUri != null) result = new Uri[]{pendingCameraUri};
            } else discardPendingCameraUri();
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            pendingCameraUri = null;
        } else if (requestCode == EXPORT_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportJson != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output != null) output.write(pendingExportJson.getBytes(StandardCharsets.UTF_8));
                } catch (IOException error) {
                    webView.post(new Runnable() {
                        @Override public void run() {
                            webView.evaluateJavascript("alert('Sicherung konnte nicht gespeichert werden.')", null);
                        }
                    });
                }
            }
            pendingExportJson = null;
        }
    }

    private void discardPendingCameraUri() {
        if (pendingCameraUri == null) return;
        try {
            getContentResolver().delete(pendingCameraUri, null, null);
        } catch (RuntimeException ignored) {
        }
        pendingCameraUri = null;
    }

    public final class AndroidBridge {
        @JavascriptInterface
        public void saveJson(String filename, String json) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    pendingExportJson = json;
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, filename);
                    startActivityForResult(intent, EXPORT_REQUEST);
                }
            });
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) checkReleasedVersion();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
