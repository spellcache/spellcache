package io.github.spellcache.scanner;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Réglages du scanner : mode (cadre ou auto) et taille du cadre, affichage,
 * caméra, zoom, mise au point, luminosité et flash. Enregistrés sur le compte
 * (`/api/scanner/settings`, `toJson`/`applyJson`) comme toute préférence, et
 * gardés sur le téléphone pour ouvrir le scanner sans attendre le serveur.
 */
final class CameraSettings {

    private static final String PREFS = "scanner_camera";
    private static final String KEY_CAMERA_ID = "camera_id";
    private static final String KEY_ZOOM_RATIO = "zoom_ratio";
    private static final String KEY_FOCUS_MODE = "focus_mode";
    private static final String KEY_SCAN_MODE = "scan_mode";
    private static final String KEY_FRAME_SIZE = "frame_size";
    private static final String KEY_VIEW_MODE = "view_mode";
    private static final String KEY_TORCH_ON = "torch_on";
    private static final String KEY_EXPOSURE_MODE = "exposure_mode";

    /** Exposition de la caméra, sans correction. */
    static final String EXPOSURE_AUTO = "auto";
    /** Exposition décalée à la glissière (`exposureIndex`). */
    static final String EXPOSURE_MANUAL = "manual";
    private static final String KEY_TORCH_LEVEL = "torch_level";
    private static final String KEY_SOUND = "sound";
    private static final String KEY_DEFAULT_LANGUAGE = "default_language";
    private static final String KEY_FOIL_DEFAULT = "foil_default";
    private static final String KEY_VIBRATION = "vibration";

    /** La caméra remplit l'écran, côtés de l'image rognés. */
    static final String VIEW_FILL = "fill";
    /** L'image entière, sous la barre du haut. */
    static final String VIEW_WHOLE = "whole";

    /** Seule la carte du cadre est lue ; la taille du cadre se règle. */
    static final String MODE_FRAME = "frame";
    /** Sans cadre : la carte la plus proche du centre, dans tous les sens. */
    static final String MODE_AUTO = "auto";

    /** Mise au point continue ; toucher le cadre la refait, puis elle reprend seule. */
    static final String FOCUS_CONTINUOUS = "continuous";
    /** Mise au point sur le point touché, gardée jusqu'au toucher suivant. */
    static final String FOCUS_TAP = "tap";
    /** Distance fixée à la glissière. */
    static final String FOCUS_MANUAL = "manual";
    private static final String KEY_FOCUS_POSITION = "focus_position";
    private static final String KEY_EXPOSURE_INDEX = "exposure_index";

    /** `null` : la caméra arrière par défaut. */
    String cameraId;
    float zoomRatio = 1f;
    String focusMode = FOCUS_CONTINUOUS;
    String scanMode = MODE_FRAME;
    /** Largeur du cadre sur la largeur de l'image (`ScanFrameView`). */
    float frameSize = ScanFrameView.DEFAULT_WIDTH_OF_IMAGE;
    String viewMode = VIEW_FILL;
    boolean torchOn;
    String exposureMode = EXPOSURE_AUTO;
    /** Intensité du flash, `0` : celle de l'appareil. */
    int torchLevel;
    // Réglages de scan, choisis dans l'écran de revue : lus ici, jamais
    // renvoyés par l'app (`toJson`), pour ne pas écraser un changement fait
    // pendant que le scanner est ouvert.
    boolean sound = true;
    boolean vibration = true;
    /** Langue d'une carte comptée ; `auto` : celle imprimée sur la carte. */
    String defaultLanguage = "auto";
    boolean foilDefault;
    /** 0 : au plus près, 1 : à l'infini. Une carte tenue à la main est près. */
    float focusPosition = 0.2f;
    /** Pas de compensation d'exposition, 0 : celle de la caméra. */
    int exposureIndex;

    static CameraSettings load(Context context) {
        SharedPreferences prefs = prefs(context);
        CameraSettings settings = new CameraSettings();
        settings.cameraId = prefs.getString(KEY_CAMERA_ID, null);
        settings.zoomRatio = prefs.getFloat(KEY_ZOOM_RATIO, 1f);
        settings.focusMode = prefs.getString(KEY_FOCUS_MODE, FOCUS_CONTINUOUS);
        settings.scanMode = prefs.getString(KEY_SCAN_MODE, MODE_FRAME);
        settings.frameSize = prefs.getFloat(KEY_FRAME_SIZE, ScanFrameView.DEFAULT_WIDTH_OF_IMAGE);
        settings.viewMode = prefs.getString(KEY_VIEW_MODE, VIEW_FILL);
        settings.torchOn = prefs.getBoolean(KEY_TORCH_ON, false);
        settings.exposureMode = prefs.getString(KEY_EXPOSURE_MODE, EXPOSURE_AUTO);
        settings.torchLevel = prefs.getInt(KEY_TORCH_LEVEL, 0);
        settings.sound = prefs.getBoolean(KEY_SOUND, true);
        settings.vibration = prefs.getBoolean(KEY_VIBRATION, true);
        settings.defaultLanguage = prefs.getString(KEY_DEFAULT_LANGUAGE, "auto");
        settings.foilDefault = prefs.getBoolean(KEY_FOIL_DEFAULT, false);
        settings.focusPosition = prefs.getFloat(KEY_FOCUS_POSITION, settings.focusPosition);
        settings.exposureIndex = prefs.getInt(KEY_EXPOSURE_INDEX, 0);
        return settings;
    }

    void save(Context context) {
        prefs(context).edit()
            .putString(KEY_CAMERA_ID, cameraId)
            .putFloat(KEY_ZOOM_RATIO, zoomRatio)
            .putString(KEY_FOCUS_MODE, focusMode)
            .putString(KEY_SCAN_MODE, scanMode)
            .putFloat(KEY_FRAME_SIZE, frameSize)
            .putString(KEY_VIEW_MODE, viewMode)
            .putBoolean(KEY_TORCH_ON, torchOn)
            .putString(KEY_EXPOSURE_MODE, exposureMode)
            .putInt(KEY_TORCH_LEVEL, torchLevel)
            .putBoolean(KEY_SOUND, sound)
            .putBoolean(KEY_VIBRATION, vibration)
            .putString(KEY_DEFAULT_LANGUAGE, defaultLanguage)
            .putBoolean(KEY_FOIL_DEFAULT, foilDefault)
            .putFloat(KEY_FOCUS_POSITION, focusPosition)
            .putInt(KEY_EXPOSURE_INDEX, exposureIndex)
            .apply();
    }

    /** Forme enregistrée sur le compte (`apps/web/lib/scanner/settings.ts`). */
    JSONObject toJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("scanMode", scanMode)
                .put("viewMode", viewMode)
                .put("frameSize", frameSize)
                .put("cameraId", cameraId == null ? JSONObject.NULL : cameraId)
                .put("zoomRatio", zoomRatio)
                .put("focusMode", focusMode)
                .put("focusPosition", focusPosition)
                .put("exposureIndex", exposureIndex)
                .put("exposureMode", exposureMode)
                .put("torchOn", torchOn)
                .put("torchLevel", torchLevel);
        } catch (JSONException e) {
            // Valeurs finies et clés fixes : jamais levée.
        }
        return json;
    }

    /** Réglages du compte ; une clé absente garde la valeur actuelle. */
    void applyJson(JSONObject json) {
        scanMode = json.optString("scanMode", scanMode);
        viewMode = json.optString("viewMode", viewMode);
        frameSize = (float) json.optDouble("frameSize", frameSize);
        if (json.has("cameraId")) cameraId = json.isNull("cameraId") ? null : json.optString("cameraId", cameraId);
        zoomRatio = (float) json.optDouble("zoomRatio", zoomRatio);
        focusMode = json.optString("focusMode", focusMode);
        focusPosition = (float) json.optDouble("focusPosition", focusPosition);
        exposureIndex = json.optInt("exposureIndex", exposureIndex);
        exposureMode = json.optString("exposureMode", exposureMode);
        torchOn = json.optBoolean("torchOn", torchOn);
        torchLevel = json.optInt("torchLevel", torchLevel);
        sound = json.optBoolean("sound", sound);
        vibration = json.optBoolean("vibration", vibration);
        defaultLanguage = json.optString("language", defaultLanguage);
        foilDefault = json.optBoolean("foilDefault", foilDefault);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
