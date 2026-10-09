package io.github.spellcache;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Locale;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

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

    private int publishedKeyboardInset = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServerPlugin.class);
        super.onCreate(savedInstanceState);

        // Retour = historique de la WebView. Depuis la première page de
        // l'instance, il ramène à l'écran de choix du serveur ; de là, il
        // quitte l'app comme d'habitude.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });

        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
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
