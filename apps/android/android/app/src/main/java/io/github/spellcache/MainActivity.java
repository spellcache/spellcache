package io.github.spellcache;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

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
                syncSystemBarsWithPage();
            }
        });
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
