package io.github.spellcache;

import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ouverture du scanner de cartes depuis l'instance. Le pont Capacitor
 * n'existe pas dans ses pages (`ServerPlugin`) : l'écran du scanner navigue
 * vers `spellcache://scanner`, navigation interceptée ici, et `MainActivity`
 * lui rend les cartes scannées (`window.__spellcacheScanned`).
 */
@CapacitorPlugin(name = "Scanner")
public class ScannerPlugin extends Plugin {

    static final String SCHEME = "spellcache";
    static final String HOST = "scanner";

    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (!SCHEME.equals(url.getScheme()) || !HOST.equals(url.getHost())) return null;
        ((MainActivity) getActivity()).openScanner();
        return Boolean.TRUE;
    }
}
