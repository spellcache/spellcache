package io.github.spellcache;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Locale;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import io.github.spellcache.scanner.ScannerActivity;

public class MainActivity extends BridgeActivity {

    // Luminance (0 à 1) du fond de la page affichée, -1 si indéterminée
    // (fond transparent, format de couleur inattendu).
    private static final String PAGE_BACKGROUND_LUMINANCE_JS =
        "(function () {" +
        "  var el = document.body || document.documentElement;" +
        "  var c = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g);" +
        "  if (!c || c.length < 3 || (c.length > 3 && Number(c[3]) === 0)) return -1;" +
        "  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;" +
        "})()";

    // Hauteur du clavier publiée à la page (`--keyboard-inset`, celle que
    // `components/ui/keyboard-inset.tsx` calcule dans un navigateur) ; un
    // champ que le clavier recouvre est ramené en vue.
    private static final String KEYBOARD_INSET_JS =
        "(function () {" +
        "  var k = %d;" +
        "  document.documentElement.style.setProperty('--keyboard-inset', k + 'px');" +
        "  var a = document.activeElement;" +
        "  if (k > 0 && a && a !== document.body && a.getBoundingClientRect().bottom > innerHeight - k) {" +
        "    a.scrollIntoView({ block: 'center' });" +
        "  }" +
        "})()";

    // Couche du dessus refermée par l'instance : `true`. Une instance plus
    // ancienne, sans ce point d'entrée, renvoie `false` et garde le retour par
    // l'historique de la WebView.
    private static final String CLOSE_TOP_LAYER_JS =
        "(function () {" +
        "  return typeof window.__spellcacheBack === 'function' && window.__spellcacheBack() === true;" +
        "})()";

    // Cartes rendues par le scanner à l'écran qui l'a ouvert
    // (`app/(app)/tools/scanner/scanner-view.tsx`). Le JSON vient de
    // `ScannerActivity` : identifiants, quantités et langues seulement.
    private static final String SCANNED_JS =
        "(function () {" +
        "  return typeof window.__spellcacheScanned === 'function' && window.__spellcacheScanned({ cards: %s }) === true;" +
        "})()";

    // Garde-fou : instance lente ou injoignable, l'écran local prend le relais.
    private static final long SPLASH_TIMEOUT_MS = 10_000;

    private int publishedKeyboardInset = -1;

    private OnBackPressedCallback backCallback;

    // Le logo de lancement reste affiché jusqu'à la première page de
    // l'instance, ou jusqu'à ce que l'écran local affiche son formulaire.
    private volatile boolean keepSplash = true;

    private final ActivityResultLauncher<Intent> scanner = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(), this::onScannerResult);

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this).setKeepOnScreenCondition(() -> keepSplash);
        new Handler(Looper.getMainLooper()).postDelayed(this::hideSplash, SPLASH_TIMEOUT_MS);

        registerPlugin(ServerPlugin.class);
        registerPlugin(ScannerPlugin.class);
        super.onCreate(savedInstanceState);

        // Retour : l'instance referme d'abord sa feuille, sa visionneuse ou sa
        // sélection (`window.__spellcacheBack`) ; sans rien d'ouvert, page
        // précédente de la WebView. Depuis la première page de l'instance, il
        // ramène à l'écran de choix du serveur ; de là, il quitte l'app.
        backCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                String url = webView.getUrl();
                if (url == null || url.startsWith(getBridge().getLocalUrl())) {
                    goBackInWebView();
                    return;
                }
                webView.evaluateJavascript(CLOSE_TOP_LAYER_JS, (closed) -> {
                    if (!"true".equals(closed)) goBackInWebView();
                });
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                String url = webView.getUrl();
                if (url != null && !url.startsWith(getBridge().getLocalUrl())) hideSplash();
                publishedKeyboardInset = -1;
                syncSystemBarsWithPage();
            }
        });

        // Le clavier recouvre la page au lieu de la redimensionner (SystemBars
        // n'ajuste plus les marges, capacitor.config.ts) : la WebView garde
        // toute la hauteur et ne reçoit que la hauteur du clavier.
        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (view, insets) -> {
            publishKeyboardInset(insets);
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
    }

    void hideSplash() {
        keepSplash = false;
    }

    // Seulement depuis une page de l'instance enregistrée : c'est elle qui
    // reçoit les cartes et à qui le scanner envoie le texte lu.
    void openScanner() {
        String origin = ServerPlugin.savedOrigin(this);
        String url = getBridge().getWebView().getUrl();
        if (origin == null || url == null || !url.startsWith(origin + "/")) return;
        scanner.launch(ScannerActivity.intent(this, origin));
    }

    private void onScannerResult(ActivityResult result) {
        Intent data = result.getData();
        String cards = data == null ? null : data.getStringExtra(ScannerActivity.EXTRA_CARDS);
        if (cards == null) return;
        getBridge().getWebView().evaluateJavascript(String.format(Locale.US, SCANNED_JS, cards), null);
    }

    private void goBackInWebView() {
        WebView webView = getBridge().getWebView();
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        // Aucune page avant : retour système (l'app passe en arrière-plan).
        backCallback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        backCallback.setEnabled(true);
    }

    private void publishKeyboardInset(WindowInsetsCompat insets) {
        boolean visible = insets.isVisible(WindowInsetsCompat.Type.ime());
        int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
        float density = getResources().getDisplayMetrics().density;
        int inset = visible ? Math.round(imeBottom / density) : 0;
        if (inset == publishedKeyboardInset) return;
        publishedKeyboardInset = inset;
        getBridge().getWebView().evaluateJavascript(String.format(Locale.US, KEYBOARD_INSET_JS, inset), null);
    }

    @Override
    public void onResume() {
        super.onResume();
        syncSystemBarsWithPage();
    }

    // Le thème de l'instance (sombre par défaut, clair ou celui de l'OS selon
    // le compte) n'est pas connu du shell : les icônes des barres système
    // suivent le fond réellement affiché. Lecture seule, sans pont exposé à
    // la page.
    private void syncSystemBarsWithPage() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        getBridge().getWebView().evaluateJavascript(PAGE_BACKGROUND_LUMINANCE_JS, (value) -> {
            double luminance;
            try {
                luminance = Double.parseDouble(value);
            } catch (NumberFormatException e) {
                return;
            }
            if (luminance < 0) return;

            boolean lightBackground = luminance > 0.5;
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setAppearanceLightStatusBars(lightBackground);
            controller.setAppearanceLightNavigationBars(lightBackground);
        });
    }
}
