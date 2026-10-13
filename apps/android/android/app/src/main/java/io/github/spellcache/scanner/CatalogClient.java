package io.github.spellcache.scanner;

import android.net.Uri;
import android.webkit.CookieManager;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Recherche d'une lecture dans le catalogue de l'instance
 * (`GET /api/scanner/lookup`), avec le cookie de session de la WebView :
 * seul le texte reconnu quitte le téléphone. Appels bloquants, hors du fil
 * principal.
 */
final class CatalogClient {

    /** L'instance refuse la lecture : session expirée, outil éteint. */
    static final class RefusedException extends IOException {
        final int status;

        RefusedException(int status) {
            super("HTTP " + status);
            this.status = status;
        }
    }

    private static final int TIMEOUT_MS = 6_000;
    // Liste des impressions comprise (jusqu'à 100).
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;

    private final String origin;

    CatalogClient(String origin) {
        this.origin = origin;
    }

    /** Réponse d'une lecture. */
    static final class Lookup {
        /** `null` : aucune carte retenue. */
        final ScanSession.Match match;
        /** Nom lu confirmé par l'impression trouvée : comptée sans attendre. */
        final boolean confirmed;
        /** Carte trouvée hors des sets choisis dans les réglages de scan. */
        final boolean outsideSets;

        Lookup(ScanSession.Match match, boolean confirmed, boolean outsideSets) {
            this.match = match;
            this.confirmed = confirmed;
            this.outsideSets = outsideSets;
        }
    }

    Lookup lookup(ScanReading reading) throws IOException {
        Uri.Builder uri = Uri.parse(origin).buildUpon().path("/api/scanner/lookup");
        if (reading.setCode != null) uri.appendQueryParameter("set", reading.setCode);
        if (reading.collectorNumber != null) uri.appendQueryParameter("number", reading.collectorNumber);
        if (reading.language != null) uri.appendQueryParameter("lang", reading.language);
        if (reading.token) uri.appendQueryParameter("token", "1");
        for (String name : reading.names) uri.appendQueryParameter("name", name);

        HttpURLConnection connection = (HttpURLConnection) new URL(uri.build().toString()).openConnection();
        try {
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/json");
            String cookies = CookieManager.getInstance().getCookie(origin);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);

            int status = connection.getResponseCode();
            if (status == 401 || status == 403 || status == 404 || status == 429) throw new RefusedException(status);
            if (status != 200) throw new IOException("HTTP " + status);

            JSONObject body = new JSONObject(read(connection.getInputStream()));
            JSONObject match = body.optJSONObject("match");
            if (match == null) return new Lookup(null, false, body.optBoolean("outsideSets", false));
            return new Lookup(matchOf(match), body.optBoolean("confirmed", false), false);
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        } finally {
            connection.disconnect();
        }
    }

    private static ScanSession.Match matchOf(JSONObject match) throws org.json.JSONException {
        java.util.List<String> finishes = new java.util.ArrayList<>();
        org.json.JSONArray array = match.optJSONArray("finishes");
        if (array != null) {
            for (int i = 0; i < array.length(); i++) finishes.add(array.getString(i));
        }
        return new ScanSession.Match(
            match.getString("cardId"),
            match.getString("name"),
            match.getString("setCode"),
            match.getString("collectorNumber"),
            match.getBoolean("exact"),
            match.optString("language", "en"),
            match.isNull("setIconUri") ? null : match.optString("setIconUri", null),
            match.isNull("setName") ? null : match.optString("setName", null),
            finishes
        );
    }

    /** Impressions de cette carte (`/api/scanner/printings`), la plus récente d'abord. */
    java.util.List<ScanSession.Match> printings(String cardId) throws IOException {
        HttpURLConnection connection = open(Uri.parse(origin).buildUpon()
            .path("/api/scanner/printings").appendQueryParameter("cardId", cardId).build());
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new RefusedException(status);
            org.json.JSONArray array = new JSONObject(read(connection.getInputStream())).getJSONArray("printings");
            java.util.List<ScanSession.Match> printings = new java.util.ArrayList<>();
            for (int i = 0; i < array.length(); i++) printings.add(matchOf(array.getJSONObject(i)));
            return printings;
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        } finally {
            connection.disconnect();
        }
    }

    /** Réglages du scanner enregistrés sur le compte (vide : aucun). */
    JSONObject getSettings() throws IOException {
        HttpURLConnection connection = open("/api/scanner/settings");
        try {
            int status = connection.getResponseCode();
            if (status != 200) throw new RefusedException(status);
            JSONObject settings = new JSONObject(read(connection.getInputStream())).optJSONObject("settings");
            return settings == null ? new JSONObject() : settings;
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        } finally {
            connection.disconnect();
        }
    }

    void putSettings(JSONObject settings) throws IOException {
        HttpURLConnection connection = open("/api/scanner/settings");
        try {
            connection.setRequestMethod("PUT");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (java.io.OutputStream out = connection.getOutputStream()) {
                out.write(settings.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            if (status != 200) throw new RefusedException(status);
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection open(String path) throws IOException {
        return open(Uri.parse(origin).buildUpon().path(path).build());
    }

    private HttpURLConnection open(Uri uri) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        String cookies = CookieManager.getInstance().getCookie(origin);
        if (cookies != null) connection.setRequestProperty("Cookie", cookies);
        return connection;
    }

    private static String read(InputStream stream) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                if (out.size() > MAX_RESPONSE_BYTES) throw new IOException("Response too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
