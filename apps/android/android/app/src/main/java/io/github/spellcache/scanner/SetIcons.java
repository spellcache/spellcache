package io.github.spellcache.scanner;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.RectF;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;

import androidx.core.content.ContextCompat;

import com.caverock.androidsvg.SVG;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import io.github.spellcache.R;

/**
 * Icônes de set affichées par le scanner, comme dans l'app (`SetIcon`) :
 * le SVG de Scryfall, rendu à la taille du texte et teinté. Chargées une
 * fois par set, hors du fil principal ; seul le CDN de Scryfall est accepté.
 */
final class SetIcons {

    private static final String ALLOWED_PREFIX = "https://svgs.scryfall.io/";
    private static final int TIMEOUT_MS = 6_000;
    private static final int MAX_BYTES = 64 * 1024;
    // Taille dans le texte du panneau du bas, et sur un bouton d'action.
    static final int TEXT_SIZE_DP = 15;
    static final int BUTTON_SIZE_DP = 24;

    private final Context context;
    // SVG téléchargés, puis icônes rendues par taille et couleur.
    private final Map<String, String> sources = new ConcurrentHashMap<>();
    private final Map<String, Drawable> icons = new ConcurrentHashMap<>();

    SetIcons(Context context) {
        this.context = context.getApplicationContext();
    }

    /** Icône du texte déjà chargée, `null` sinon. */
    Drawable cached(String uri) {
        return uri == null ? null : icons.get(key(uri, TEXT_SIZE_DP, textColor()));
    }

    /** Icône du texte (appel bloquant) ; `null` si elle n'est pas disponible. */
    Drawable load(String uri) {
        return load(uri, TEXT_SIZE_DP, textColor());
    }

    /** Icône à cette taille et cette couleur (appel bloquant). */
    Drawable load(String uri, int sizeDp, int color) {
        if (uri == null || !uri.startsWith(ALLOWED_PREFIX)) return null;
        String key = key(uri, sizeDp, color);
        Drawable known = icons.get(key);
        if (known != null) return known;
        try {
            String source = sources.get(uri);
            if (source == null) {
                source = fetch(uri);
                sources.put(uri, source);
            }
            Drawable icon = render(SVG.getFromString(source), sizeDp, color);
            icons.put(key, icon);
            return icon;
        } catch (Exception e) {
            return null;
        }
    }

    private static String key(String uri, int sizeDp, int color) {
        return uri + "@" + sizeDp + "#" + color;
    }

    private int textColor() {
        return ContextCompat.getColor(context, R.color.scanner_text_2);
    }

    private Drawable render(SVG svg, int sizeDp, int color) throws com.caverock.androidsvg.SVGParseException {
        int size = Math.round(sizeDp * context.getResources().getDisplayMetrics().density);
        float ratio = svg.getDocumentAspectRatio();
        int width = size;
        int height = size;
        if (ratio > 0 && ratio >= 1f) height = Math.max(1, Math.round(size / ratio));
        else if (ratio > 0) width = Math.max(1, Math.round(size * ratio));
        svg.setDocumentWidth("100%");
        svg.setDocumentHeight("100%");
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        svg.renderToCanvas(new Canvas(bitmap), new RectF(0, 0, width, height));
        BitmapDrawable drawable = new BitmapDrawable(context.getResources(), bitmap);
        drawable.setBounds(0, 0, width, height);
        drawable.setTint(color);
        return drawable;
    }

    private static String fetch(String uri) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(uri).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) throw new IOException("HTTP " + connection.getResponseCode());
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    if (out.size() > MAX_BYTES) throw new IOException("Icon too large");
                }
                return new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }
}
