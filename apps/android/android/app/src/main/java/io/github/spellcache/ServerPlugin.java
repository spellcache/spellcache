package io.github.spellcache;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Instance spellcache choisie par l'utilisateur.
 *
 * L'adresse n'est connue qu'à l'exécution : elle ne peut pas figurer dans
 * `allowNavigation`. `shouldOverrideLoad` garde dans la WebView la navigation
 * vers cette seule origine ; tout autre domaine suit le comportement par
 * défaut de Capacitor (ouverture dans le navigateur).
 *
 * Seul l'écran local (`www/`) appelle ce plugin : Capacitor n'injecte son
 * pont que dans les pages de l'origine de l'app, jamais dans celles de
 * l'instance.
 */
@CapacitorPlugin(name = "Server")
public class ServerPlugin extends Plugin {

    private static final String PREFS = "spellcache";
    private static final String KEY_ORIGIN = "server_origin";

    @PluginMethod
    public void getOrigin(PluginCall call) {
        JSObject result = new JSObject();
        result.put("origin", savedOrigin());
        call.resolve(result);
    }

    @PluginMethod
    public void setOrigin(PluginCall call) {
        String origin = call.getString("origin");
        if (parseOrigin(origin) == null) {
            call.reject("An https:// address is required");
            return;
        }
        prefs().edit().putString(KEY_ORIGIN, origin).apply();
        call.resolve();
    }

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        Uri server = parseOrigin(savedOrigin());
        if (server == null) return null;

        // `false` : chargée dans la WebView. `null` : décision laissée à
        // Capacitor, qui ouvre les domaines inconnus dans le navigateur.
        boolean sameOrigin =
            "https".equals(url.getScheme()) &&
            server.getHost().equalsIgnoreCase(url.getHost()) &&
            server.getPort() == url.getPort();
        return sameOrigin ? Boolean.FALSE : null;
    }

    private String savedOrigin() {
        return prefs().getString(KEY_ORIGIN, null);
    }

    // Origine HTTPS seule (schéma, hôte, port), telle que la produit
    // `URL.origin` côté écran local : le port par défaut est donc absent.
    private static Uri parseOrigin(String origin) {
        if (origin == null) return null;
        Uri uri = Uri.parse(origin);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null) return null;
        return uri;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
