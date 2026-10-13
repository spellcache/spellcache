package io.github.spellcache.scanner;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Drawable;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraMetadata;
import android.hardware.camera2.CaptureRequest;
import android.media.SoundPool;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.util.Range;
import android.util.Size;
import android.util.SizeF;
import android.view.LayoutInflater;
import android.media.AudioAttributes;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.camera2.interop.Camera2CameraControl;
import androidx.camera.camera2.interop.Camera2CameraInfo;
import androidx.camera.camera2.interop.CaptureRequestOptions;
import androidx.camera.camera2.interop.ExperimentalCamera2Interop;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraInfo;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ExposureState;
import androidx.camera.core.ZoomState;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import io.github.spellcache.R;

/**
 * Scanner de cartes en rafale. La reconnaissance de texte tourne sur le
 * téléphone (ML Kit, modèle embarqué) ; seul le texte lu part vers
 * l'instance, qui répond par la carte du catalogue. En se refermant,
 * l'activité rend la pile scannée (`EXTRA_CARDS`, JSON) à l'écran de revue.
 *
 * Réglages de la caméra (`CameraSettings`) : caméra arrière quand le
 * téléphone en expose plusieurs, zoom, mise au point, luminosité
 * (compensation d'exposition). La caméra frontale n'est jamais proposée.
 *
 * Objectifs : la plupart des téléphones récents regroupent leurs objectifs
 * dans une seule caméra arrière « logique » et choisissent l'objectif selon
 * le zoom (sous 1×, l'ultra grand-angle) ; le zoom suffit alors. D'autres
 * exposent chaque objectif comme une caméra distincte : elles sont listées.
 * Imposer un objectif physique d'une caméra logique n'est pas tenté : ignoré
 * par certains téléphones (Pixel), mal pris en charge ailleurs.
 */
@OptIn(markerClass = ExperimentalCamera2Interop.class)
public final class ScannerActivity extends AppCompatActivity {

    public static final String EXTRA_ORIGIN = "origin";
    public static final String EXTRA_CARDS = "cards";

    // Marge autour du cadre, en fraction de sa taille : une carte qui en
    // dépasse un peu reste lue.
    private static final float FRAME_MARGIN = 0.08f;
    // Mode Auto : en dessous, l'image est sans doute de travers.
    private static final int MIN_READABLE_LINES = 3;
    private static final int UNREADABLE_FRAMES_BEFORE_TURN = 2;
    // Mode Auto : écart toléré entre le bord gauche du nom et celui de la
    // ligne de set, en fraction de la largeur de l'image.
    private static final float COLUMN_TOLERANCE = 0.06f;

    // Pause après un refus pour excès de lectures.
    private static final long RATE_LIMIT_PAUSE_MS = 30_000;
    // Vibration d'une carte comptée.
    private static final long VIBRATION_MS = 40;

    private final ExecutorService analysisExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService lookupExecutor = Executors.newSingleThreadExecutor();
    private final ScanSession session = new ScanSession();
    private SetIcons setIcons;
    // Carte affichée dans le panneau du bas : son icône de set s'y ajoute
    // une fois chargée.
    private ScanSession.Match shownMatch;
    // Ligne de la pile dont le panneau du bas montre les exemplaires.
    private ScanSession.Entry shownEntry;
    private View quickActions;
    private ImageButton quickSet;
    private TextView quickLanguage;
    private ImageButton quickFoil;
    private View qtyStepper;
    private TextView qtyValue;
    private Button qtyMinus;

    private TextRecognizer recognizer;
    private CatalogClient catalog;
    private SoundPool sounds;
    private int countedSound;
    private Camera camera;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    // Écriture des réglages sur le compte, regroupée après le dernier changement.
    private final Runnable pushSettings = this::pushSettings;
    private static final long SETTINGS_PUSH_DELAY_MS = 800;
    // Réglage changé avant la réponse du compte : la version locale gagne.
    private boolean settingsTouched;
    private boolean pushPending;
    private View flashSection;
    private Button flashOff;
    private Button flashOn;
    private View flashLevelRow;
    private SeekBar flashLevel;
    private TextView flashLevelValue;
    private ProcessCameraProvider cameraProvider;
    private final List<CameraInfo> backCameras = new ArrayList<>();
    // Objectif physique pour lequel la mise au point a été appliquée.
    private String focusedPhysicalId;
    private CameraSettings settings;

    private PreviewView preview;
    private View cameraArea;
    private View topBar;
    private View bottomPanel;
    private Button viewFill;
    private Button viewWhole;
    private TextView viewHint;
    private ScanFrameView frame;
    private TextView status;
    private TextView detail;
    private Button undo;
    private Button done;
    private ImageButton torch;
    private View settingsPanel;
    private LinearLayout cameraChips;
    private LinearLayout zoomChips;
    private SeekBar zoom;
    private TextView zoomValue;
    private Button focusContinuous;
    private Button focusTap;
    private Button focusManual;
    private TextView focusHint;
    private Button modeAuto;
    private Button modeFrame;
    private TextView modeHint;
    private SeekBar frameSize;
    private TextView frameSizeValue;

    // Mode Auto : quart de tour ajouté à l'image tant qu'elle ne contient
    // presque pas de texte lisible (carte de travers ou à l'envers).
    private int extraRotation;
    private int unreadableFrames;
    private SeekBar focusDistance;
    private SeekBar exposure;
    private TextView exposureValue;
    private Button exposureAuto;
    private Button exposureManual;
    private TextView exposureHint;

    // Lectures suspendues : session expirée, outil éteint, ou pause.
    private boolean stopped;
    // Build debug : texte lu et lecture déduite dans logcat (`SpellcacheScanner`).
    private boolean debuggable;
    private long pausedUntil;

    private final ActivityResultLauncher<String> cameraPermission =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (granted) startCamera();
            else showStatus(getString(R.string.scanner_camera_denied), null);
        });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String origin = getIntent().getStringExtra(EXTRA_ORIGIN);
        if (origin == null) {
            finish();
            return;
        }
        catalog = new CatalogClient(origin);
        setIcons = new SetIcons(this);
        settings = CameraSettings.load(this);
        debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.activity_scanner);

        preview = findViewById(R.id.scanner_preview);
        cameraArea = findViewById(R.id.scanner_camera_area);
        frame = findViewById(R.id.scanner_frame);
        status = findViewById(R.id.scanner_status);
        detail = findViewById(R.id.scanner_detail);
        qtyStepper = findViewById(R.id.scanner_qty);
        quickActions = findViewById(R.id.scanner_quick_actions);
        quickSet = findViewById(R.id.scanner_quick_set);
        quickLanguage = findViewById(R.id.scanner_quick_language);
        quickFoil = findViewById(R.id.scanner_quick_foil);
        quickSet.setOnClickListener(v -> choosePrinting());
        quickLanguage.setOnClickListener(v -> chooseLanguage());
        quickFoil.setOnClickListener(v -> toggleFoil());
        qtyValue = findViewById(R.id.scanner_qty_value);
        qtyMinus = findViewById(R.id.scanner_qty_minus);
        undo = findViewById(R.id.scanner_undo);
        done = findViewById(R.id.scanner_done);
        torch = findViewById(R.id.scanner_torch);
        topBar = findViewById(R.id.scanner_top_bar);
        bottomPanel = findViewById(R.id.scanner_bottom_panel);

        // Plein écran : les barres de l'écran s'écartent des barres système,
        // le cadre se centre entre elles.
        int topPadding = topBar.getPaddingTop();
        int bottomPadding = bottomPanel.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content), (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            topBar.setPadding(topBar.getPaddingLeft(), topPadding + bars.top, topBar.getPaddingRight(), topBar.getPaddingBottom());
            bottomPanel.setPadding(bottomPanel.getPaddingLeft(), bottomPanel.getPaddingTop(), bottomPanel.getPaddingRight(), bottomPadding + bars.bottom);
            return insets;
        });
        // Barres de hauteur constante : la zone de la caméra et le cadre sont
        // placés une fois pour toutes (les réglages s'affichent par-dessus,
        // sans les déplacer).
        bottomPanel.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) ->
            layoutCameraArea());
        topBar.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) ->
            layoutCameraArea());
        // Toucher la carte dans le cadre y refait la mise au point.
        frame.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && frame.frameContains(event.getX(), event.getY())) {
                focusAt(event.getX(), event.getY());
                view.performClick();
            }
            return true;
        });
        initSettingsPanel();

        // Retour à l'écran de revue, avec les cartes scannées.
        findViewById(R.id.scanner_back).setOnClickListener(v -> finishWithCards());
        done.setOnClickListener(v -> finishWithCards());
        undo.setOnClickListener(v -> undoLast());
        qtyMinus.setOnClickListener(v -> changeQty(-1));
        findViewById(R.id.scanner_qty_plus).setOnClickListener(v -> changeQty(1));
        torch.setOnClickListener(v -> setTorch(!settings.torchOn));
        fetchSettings();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                finishWithCards();
            }
        });
        updateButtons();

        // Son d'une carte comptée : « pluck_001 » du pack Interface Sounds de
        // Kenney (www.kenney.nl, CC0). En usage média : c'est un choix des
        // réglages de scan, il ne se tait pas avec la sonnerie (mode
        // silencieux).
        sounds = new SoundPool.Builder()
            .setMaxStreams(2)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .build();
        countedSound = sounds.load(this, R.raw.scanner_pluck, 1);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Écriture en attente envoyée tout de suite.
        if (pushPending) {
            mainHandler.removeCallbacks(pushSettings);
            pushSettings();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        analysisExecutor.shutdown();
        lookupExecutor.shutdownNow();
        if (recognizer != null) recognizer.close();
        if (sounds != null) sounds.release();
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                bindCamera(future.get());
            } catch (Exception e) {
                showStatus(getString(R.string.scanner_camera_failed), null);
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void listBackCameras(ProcessCameraProvider provider) {
        backCameras.clear();
        for (CameraInfo info : provider.getAvailableCameraInfos()) {
            if (info.getLensFacing() != CameraSelector.LENS_FACING_FRONT) backCameras.add(info);
        }
        // Du plus grand angle au téléobjectif.
        Collections.sort(backCameras, Comparator.comparingInt(this::equivalentFocalLength));
    }

    // Objectif physique en service sur une caméra logique, déduit du zoom :
    // celui dont le zoom équivalent (rapport des focales, 14 / 25 mm ≈ 0,55×
    // pour l'ultra grand-angle) est le plus grand sans dépasser le zoom
    // actuel. `null` : caméra d'un seul objectif.
    private CameraInfo activePhysical() {
        if (camera == null) return null;
        CameraInfo logical = camera.getCameraInfo();
        List<CameraInfo> physicals = new ArrayList<>(logical.getPhysicalCameraInfos());
        int cameraFocal = equivalentFocalLength(logical);
        if (physicals.size() < 2 || cameraFocal <= 0) return null;
        ZoomState state = logical.getZoomState().getValue();
        float ratio = state == null ? settings.zoomRatio : state.getZoomRatio();
        float min = state == null ? 0f : state.getMinZoomRatio();
        CameraInfo best = null;
        float bestZoom = -1f;
        for (CameraInfo physical : physicals) {
            int focal = equivalentFocalLength(physical);
            if (focal <= 0) continue;
            float zoomFor = (float) focal / cameraFocal;
            // Juste au-dessus du minimum : c'est le zoom minimum.
            if (zoomFor < 1f && zoomFor - min < 0.1f) zoomFor = min;
            if (zoomFor <= ratio + 0.01f && zoomFor > bestZoom) {
                best = physical;
                bestZoom = zoomFor;
            }
        }
        return best;
    }

    private void bindCamera(ProcessCameraProvider provider) {
        cameraProvider = provider;
        listBackCameras(provider);
        if (backCameras.isEmpty()) {
            showStatus(getString(R.string.scanner_camera_failed), null);
            return;
        }

        // Aperçu et analyse en 4:3, le format du capteur : tout le champ de
        // l'objectif, et le cadre posé sur l'image (`ScanFrameView`).
        Preview previewCase = new Preview.Builder()
            .setResolutionSelector(new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build())
            .build();
        previewCase.setSurfaceProvider(preview.getSurfaceProvider());

        // Le numéro de collection est petit et la carte n'occupe qu'une partie
        // de l'image : analyse en 1920 × 1440.
        ResolutionSelector resolution = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
            .setResolutionStrategy(new ResolutionStrategy(
                new Size(1920, 1440), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
            .build();
        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        analysis.setAnalyzer(analysisExecutor, this::analyze);

        // Caméra enregistrée, sinon la caméra arrière par défaut du système.
        CameraSelector selector = CameraSelector.DEFAULT_BACK_CAMERA;
        for (CameraInfo info : backCameras) {
            if (cameraIdOf(info).equals(settings.cameraId)) selector = info.getCameraSelector();
        }
        if (camera != null) camera.getCameraInfo().getZoomState().removeObservers(this);
        provider.unbindAll();
        camera = provider.bindToLifecycle(this, selector, previewCase, analysis);
        focusedPhysicalId = null;
        camera.getCameraInfo().getZoomState().observe(this, this::renderZoom);
        torch.setVisibility(camera.getCameraInfo().hasFlashUnit() ? View.VISIBLE : View.INVISIBLE);
        applyTorch();
        applyZoom();
        applyFocus();
        applyExposure();
        renderSettings();
    }

    private void initSettingsPanel() {
        settingsPanel = findViewById(R.id.scanner_settings);
        // Contenu et barre de défilement coupés aux coins arrondis du panneau.
        settingsPanel.setClipToOutline(true);
        flashSection = findViewById(R.id.scanner_flash_section);
        flashOff = findViewById(R.id.scanner_flash_off);
        flashOn = findViewById(R.id.scanner_flash_on);
        flashLevelRow = findViewById(R.id.scanner_flash_level_row);
        flashLevel = findViewById(R.id.scanner_flash_level);
        flashLevelValue = findViewById(R.id.scanner_flash_level_value);
        flashOff.setOnClickListener(v -> setTorch(false));
        flashOn.setOnClickListener(v -> setTorch(true));
        flashLevel.setOnSeekBarChangeListener(new SliderListener() {
            @Override
            void onChanged(int progress) {
                settings.torchLevel = progress + 1;
                applyTorch();
                renderFlash();
            }
        });
        viewFill = findViewById(R.id.scanner_view_fill);
        viewWhole = findViewById(R.id.scanner_view_whole);
        viewHint = findViewById(R.id.scanner_view_hint);
        viewFill.setOnClickListener(v -> setViewMode(CameraSettings.VIEW_FILL));
        viewWhole.setOnClickListener(v -> setViewMode(CameraSettings.VIEW_WHOLE));
        applyViewMode();
        modeAuto = findViewById(R.id.scanner_mode_auto);
        modeFrame = findViewById(R.id.scanner_mode_frame);
        modeHint = findViewById(R.id.scanner_mode_hint);
        frameSize = findViewById(R.id.scanner_frame_size);
        frameSizeValue = findViewById(R.id.scanner_frame_size_value);
        modeAuto.setOnClickListener(v -> setScanMode(CameraSettings.MODE_AUTO));
        modeFrame.setOnClickListener(v -> setScanMode(CameraSettings.MODE_FRAME));
        frameSize.setMax(Math.round((ScanFrameView.MAX_WIDTH_OF_IMAGE - ScanFrameView.MIN_WIDTH_OF_IMAGE) * 100));
        frameSize.setOnSeekBarChangeListener(new SliderListener() {
            @Override
            void onChanged(int progress) {
                settings.frameSize = ScanFrameView.MIN_WIDTH_OF_IMAGE + progress / 100f;
                frame.setFrameSize(settings.frameSize);
                renderMode();
            }
        });
        applyScanMode();
        cameraChips = findViewById(R.id.scanner_cameras);
        zoomChips = findViewById(R.id.scanner_zoom_presets);
        zoom = findViewById(R.id.scanner_zoom);
        zoomValue = findViewById(R.id.scanner_zoom_value);
        focusContinuous = findViewById(R.id.scanner_focus_continuous);
        focusTap = findViewById(R.id.scanner_focus_tap);
        focusManual = findViewById(R.id.scanner_focus_manual);
        focusHint = findViewById(R.id.scanner_focus_hint);
        focusDistance = findViewById(R.id.scanner_focus_distance);
        exposure = findViewById(R.id.scanner_exposure);
        exposureValue = findViewById(R.id.scanner_exposure_value);
        exposureAuto = findViewById(R.id.scanner_exposure_auto);
        exposureManual = findViewById(R.id.scanner_exposure_manual);
        exposureHint = findViewById(R.id.scanner_exposure_hint);
        exposureAuto.setOnClickListener(v -> setExposureMode(CameraSettings.EXPOSURE_AUTO));
        exposureManual.setOnClickListener(v -> setExposureMode(CameraSettings.EXPOSURE_MANUAL));

        findViewById(R.id.scanner_settings_button).setOnClickListener(v -> {
            settingsPanel.setVisibility(settingsPanel.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
            settingsPanel.post(this::layoutCameraArea);
        });
        zoom.setOnSeekBarChangeListener(new SliderListener() {
            @Override
            void onChanged(int progress) {
                if (camera == null) return;
                ZoomState state = camera.getCameraInfo().getZoomState().getValue();
                if (state == null) return;
                camera.getCameraControl().setZoomRatio(zoomAt(state, progress / 100f));
            }
        });
        focusContinuous.setOnClickListener(v -> setFocusMode(CameraSettings.FOCUS_CONTINUOUS));
        focusTap.setOnClickListener(v -> setFocusMode(CameraSettings.FOCUS_TAP));
        focusManual.setOnClickListener(v -> setFocusMode(CameraSettings.FOCUS_MANUAL));
        focusDistance.setOnSeekBarChangeListener(new SliderListener() {
            @Override
            void onChanged(int progress) {
                settings.focusPosition = progress / 100f;
                applyFocus();
            }
        });
        exposure.setOnSeekBarChangeListener(new SliderListener() {
            @Override
            void onChanged(int progress) {
                if (camera == null) return;
                Range<Integer> range = camera.getCameraInfo().getExposureState().getExposureCompensationRange();
                settings.exposureIndex = range.getLower() + progress;
                applyExposure();
                renderExposureValue();
            }
        });
    }

    /** Glissière : seuls les mouvements de l'utilisateur comptent, enregistrés au lâcher. */
    private abstract class SliderListener implements SeekBar.OnSeekBarChangeListener {
        abstract void onChanged(int progress);

        @Override
        public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
            if (fromUser) onChanged(progress);
        }

        @Override
        public void onStartTrackingTouch(SeekBar seekBar) {}

        @Override
        public void onStopTrackingTouch(SeekBar seekBar) {
            persistSettings();
        }
    }

    private void selectCamera(CameraInfo info) {
        if (camera != null && cameraIdOf(camera.getCameraInfo()).equals(cameraIdOf(info))) return;
        settings.cameraId = cameraIdOf(info);
        // Zoom et luminosité d'une caméra ne valent pas pour une autre.
        settings.zoomRatio = 1f;
        settings.exposureIndex = 0;
        persistSettings();
        if (cameraProvider != null) bindCamera(cameraProvider);
    }

    // Zoom minimum utile. Sous 1×, une caméra logique passe sur l'ultra
    // grand-angle ; souvent sans autofocus (Pixel), il reste flou à la
    // distance d'une carte tenue en main. Le zoom s'arrête alors au plus
    // petit objectif qui fait la mise au point.
    private float minUsableZoom(ZoomState state) {
        float min = state.getMinZoomRatio();
        CameraInfo logical = camera.getCameraInfo();
        List<CameraInfo> physicals = new ArrayList<>(logical.getPhysicalCameraInfos());
        int cameraFocal = equivalentFocalLength(logical);
        if (physicals.size() < 2 || cameraFocal <= 0) return min;
        float lowest = Float.MAX_VALUE;
        for (CameraInfo physical : physicals) {
            int focal = equivalentFocalLength(physical);
            if (focal <= 0 || minimumFocusDistanceOf(physical) <= 0) continue;
            float zoomFor = (float) focal / cameraFocal;
            if (zoomFor < 1f && zoomFor - min < 0.1f) zoomFor = min;
            lowest = Math.min(lowest, zoomFor);
        }
        if (lowest == Float.MAX_VALUE) return min;
        return Math.max(min, Math.min(lowest, 1f));
    }

    // Glissière en échelle logarithmique (comme l'appli photo), entre le zoom
    // minimum utile et le maximum.
    private float zoomAt(ZoomState state, float position) {
        float low = minUsableZoom(state);
        float high = Math.max(low, state.getMaxZoomRatio());
        return (float) (low * Math.pow(high / low, position));
    }

    private float positionOf(ZoomState state, float ratio) {
        float low = minUsableZoom(state);
        float high = state.getMaxZoomRatio();
        if (high <= low) return 0f;
        return (float) (Math.log(ratio / low) / Math.log(high / low));
    }

    private void applyZoom() {
        ZoomState state = camera.getCameraInfo().getZoomState().getValue();
        float ratio = settings.zoomRatio;
        if (state != null) ratio = Math.max(minUsableZoom(state), Math.min(state.getMaxZoomRatio(), ratio));
        camera.getCameraControl().setZoomRatio(ratio);
    }

    private void setZoomRatio(float ratio) {
        settings.zoomRatio = ratio;
        persistSettings();
        applyZoom();
    }

    // Suit l'état réel de la caméra (glissière, préréglage, bornes de
    // l'objectif) ; le rapport est enregistré pour la prochaine ouverture.
    private void renderZoom(ZoomState state) {
        if (state == null) return;
        settings.zoomRatio = state.getZoomRatio();
        zoomValue.setText(String.format(Locale.US, "%.1f×", state.getZoomRatio()));
        // Zoom enregistré sous le minimum utile (version précédente) : ramené.
        float low = minUsableZoom(state);
        if (state.getZoomRatio() < low - 0.01f) {
            camera.getCameraControl().setZoomRatio(low);
            return;
        }
        if (!zoom.isPressed()) zoom.setProgress(Math.round(positionOf(state, state.getZoomRatio()) * 100));

        // Le zoom peut changer d'objectif (sous 1×, l'ultra grand-angle à
        // focale fixe) : la mise au point n'est réappliquée qu'à ce moment.
        CameraInfo physical = activePhysical();
        String physicalId = physical == null ? null : cameraIdOf(physical);
        if (!java.util.Objects.equals(physicalId, focusedPhysicalId)) {
            focusedPhysicalId = physicalId;
            applyFocus();
            renderFocus();
        }

        // Préréglages comme dans l'appli photo, du zoom minimum utile au
        // maximum de la caméra.
        float[] presets = {low, 1f, 2f, 4f};
        zoomChips.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        float previous = -1f;
        for (float preset : presets) {
            if (preset < low - 0.01f || preset > state.getMaxZoomRatio()) continue;
            if (Math.abs(preset - previous) < 0.05f) continue;
            previous = preset;
            Button chip = (Button) inflater.inflate(R.layout.item_scanner_chip, zoomChips, false);
            chip.setText(String.format(Locale.US, preset < 1f ? "%.1f×" : "%.0f×", preset));
            styleChip(chip, Math.abs(state.getZoomRatio() - preset) < 0.05f);
            chip.setOnClickListener(v -> setZoomRatio(preset));
            zoomChips.addView(chip);
        }
    }

    private void setFocusMode(String mode) {
        settings.focusMode = mode;
        persistSettings();
        applyFocus();
        renderSettings();
    }

    // Mise au point sur le point touché. En continu, la caméra reprend la
    // main au bout de quelques secondes ; en « Tap to focus », elle reste
    // sur ce point jusqu'au toucher suivant. Rien en manuel, ni sur un
    // objectif à focale fixe.
    private void focusAt(float x, float y) {
        if (camera == null || !hasAutofocus() || usesManualFocus()) return;
        FocusMeteringAction.Builder builder = new FocusMeteringAction.Builder(
            preview.getMeteringPointFactory().createPoint(x, y), FocusMeteringAction.FLAG_AF);
        if (CameraSettings.FOCUS_TAP.equals(settings.focusMode)) builder.disableAutoCancel();
        else builder.setAutoCancelDuration(4, TimeUnit.SECONDS);
        frame.showFocus(x, y);
        ListenableFuture<androidx.camera.core.FocusMeteringResult> result =
            camera.getCameraControl().startFocusAndMetering(builder.build());
        result.addListener(() -> {
            boolean success;
            try {
                success = result.get().isFocusSuccessful();
            } catch (Exception e) {
                success = false;
            }
            frame.focusDone(success);
        }, ContextCompat.getMainExecutor(this));
    }

    private boolean hasAutofocus() {
        return minimumFocusDistance() > 0;
    }

    // Distance minimale de mise au point en dioptries, de l'objectif en
    // service ; 0 : focale fixe, sans mise au point manuelle.
    private float minimumFocusDistance() {
        CameraInfo physical = activePhysical();
        return minimumFocusDistanceOf(physical != null ? physical : camera.getCameraInfo());
    }

    private static float minimumFocusDistanceOf(CameraInfo info) {
        Float distance = Camera2CameraInfo.from(info)
            .getCameraCharacteristic(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE);
        return distance == null ? 0f : distance;
    }

    private boolean usesManualFocus() {
        return CameraSettings.FOCUS_MANUAL.equals(settings.focusMode) && camera != null && hasAutofocus();
    }

    private void applyFocus() {
        if (camera == null) return;
        Camera2CameraControl control = Camera2CameraControl.from(camera.getCameraControl());
        if (usesManualFocus()) {
            camera.getCameraControl().cancelFocusAndMetering();
            control.setCaptureRequestOptions(new CaptureRequestOptions.Builder()
                .setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
                .setCaptureRequestOption(CaptureRequest.LENS_FOCUS_DISTANCE,
                    minimumFocusDistance() * (1f - settings.focusPosition))
                .build());
        } else {
            camera.getCameraControl().cancelFocusAndMetering();
            control.clearCaptureRequestOptions();
        }
    }

    private void applyExposure() {
        if (camera == null) return;
        ExposureState state = camera.getCameraInfo().getExposureState();
        if (!state.isExposureCompensationSupported()) return;
        Range<Integer> range = state.getExposureCompensationRange();
        int index = manualExposure()
            ? Math.max(range.getLower(), Math.min(range.getUpper(), settings.exposureIndex))
            : 0;
        camera.getCameraControl().setExposureCompensationIndex(index);
    }

    private boolean fillView() {
        return !CameraSettings.VIEW_WHOLE.equals(settings.viewMode);
    }

    private void setViewMode(String mode) {
        settings.viewMode = mode;
        persistSettings();
        applyViewMode();
    }

    // Remplir : la caméra va du haut de l'écran au panneau du bas, la barre
    // du haut par-dessus sur un dégradé. Image entière : sous la barre du
    // haut, opaque ; le reste se fond dans le fond de l'écran.
    private void applyViewMode() {
        boolean fill = fillView();
        preview.setScaleType(fill ? PreviewView.ScaleType.FILL_CENTER : PreviewView.ScaleType.FIT_START);
        frame.setFillView(fill);
        if (fill) topBar.setBackgroundResource(R.drawable.scanner_top_scrim);
        else topBar.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background));
        layoutCameraArea();
        styleChip(viewFill, fill);
        styleChip(viewWhole, !fill);
        viewHint.setText(fill ? R.string.scanner_view_fill_hint : R.string.scanner_view_whole_hint);
    }

    private void layoutCameraArea() {
        boolean fill = fillView();
        android.widget.FrameLayout.LayoutParams params =
            (android.widget.FrameLayout.LayoutParams) cameraArea.getLayoutParams();
        int top = fill ? 0 : topBar.getHeight();
        int bottom = bottomPanel.getHeight();
        if (params.topMargin != top || params.bottomMargin != bottom) {
            params.topMargin = top;
            params.bottomMargin = bottom;
            cameraArea.setLayoutParams(params);
        }
        // En remplissage, le cadre évite la barre du haut posée par-dessus.
        frame.setInsets(fill ? topBar.getHeight() : 0, 0);

        android.widget.FrameLayout.LayoutParams quickParams =
            (android.widget.FrameLayout.LayoutParams) quickActions.getLayoutParams();
        int quickBottom = bottom + Math.round(16 * getResources().getDisplayMetrics().density);
        if (quickParams.bottomMargin != quickBottom) {
            quickParams.bottomMargin = quickBottom;
            quickActions.setLayoutParams(quickParams);
        }

        // Réglages : au plus jusqu'au panneau du bas, défilants au-delà.
        if (settingsPanel == null) return;
        int available = bottomPanel.getTop() - topBar.getBottom()
            - Math.round(12 * getResources().getDisplayMetrics().density);
        View content = ((android.view.ViewGroup) settingsPanel).getChildAt(0);
        content.measure(
            View.MeasureSpec.makeMeasureSpec(Math.max(0, settingsPanel.getWidth()), View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        int height = available > 0 ? Math.min(available, content.getMeasuredHeight()) : android.view.ViewGroup.LayoutParams.WRAP_CONTENT;
        android.view.ViewGroup.LayoutParams panelParams = settingsPanel.getLayoutParams();
        if (panelParams.height != height) {
            panelParams.height = height;
            settingsPanel.setLayoutParams(panelParams);
        }
    }

    private void setScanMode(String mode) {
        settings.scanMode = mode;
        persistSettings();
        applyScanMode();
    }

    private boolean autoMode() {
        return CameraSettings.MODE_AUTO.equals(settings.scanMode);
    }

    private void applyScanMode() {
        frame.setFrameMode(!autoMode());
        frame.setFrameSize(settings.frameSize);
        extraRotation = 0;
        unreadableFrames = 0;
        if (session.total() == 0) {
            showStatus(getString(autoMode() ? R.string.scanner_hint_auto : R.string.scanner_hint),
                getString(R.string.scanner_hint_detail));
        }
        renderMode();
    }

    private void renderMode() {
        boolean auto = autoMode();
        styleChip(modeAuto, auto);
        styleChip(modeFrame, !auto);
        modeHint.setText(auto ? R.string.scanner_mode_auto_hint : R.string.scanner_mode_frame_hint);
        findViewById(R.id.scanner_frame_size_row).setVisibility(auto ? View.GONE : View.VISIBLE);
        frameSize.setProgress(Math.round((settings.frameSize - ScanFrameView.MIN_WIDTH_OF_IMAGE) * 100));
        frameSizeValue.setText(String.format(Locale.US, "%d%%", Math.round(settings.frameSize * 100)));
    }

    private void renderSettings() {
        if (camera == null) return;

        renderLenses();
        renderFocus();
        renderExposure();
        renderFlash();
    }

    // Caméras arrière distinctes, seulement quand il y en a plusieurs.
    private void renderLenses() {
        if (camera == null) return;
        findViewById(R.id.scanner_camera_section).setVisibility(backCameras.size() > 1 ? View.VISIBLE : View.GONE);
        String currentId = cameraIdOf(camera.getCameraInfo());
        cameraChips.removeAllViews();
        LayoutInflater inflater = LayoutInflater.from(this);
        for (int i = 0; i < backCameras.size(); i++) {
            CameraInfo info = backCameras.get(i);
            Button chip = (Button) inflater.inflate(R.layout.item_scanner_chip, cameraChips, false);
            chip.setText(labelOf(info, i));
            styleChip(chip, cameraIdOf(info).equals(currentId));
            chip.setOnClickListener(v -> selectCamera(info));
            cameraChips.addView(chip);
        }
    }

    // Section toujours visible : sur un objectif à focale fixe, elle le dit.
    private void renderFocus() {
        if (camera == null) return;
        boolean focusable = hasAutofocus();
        String mode = settings.focusMode;
        focusContinuous.setEnabled(focusable);
        focusTap.setEnabled(focusable);
        focusManual.setEnabled(focusable);
        styleChip(focusContinuous, focusable && CameraSettings.FOCUS_CONTINUOUS.equals(mode));
        styleChip(focusTap, focusable && CameraSettings.FOCUS_TAP.equals(mode));
        styleChip(focusManual, focusable && CameraSettings.FOCUS_MANUAL.equals(mode));
        float chipAlpha = focusable ? 1f : 0.4f;
        focusContinuous.setAlpha(chipAlpha);
        focusTap.setAlpha(chipAlpha);
        focusManual.setAlpha(chipAlpha);
        focusHint.setText(!focusable
            ? R.string.scanner_focus_fixed
            : CameraSettings.FOCUS_TAP.equals(mode)
                ? R.string.scanner_focus_tap_hint
                : CameraSettings.FOCUS_MANUAL.equals(mode)
                    ? R.string.scanner_focus_manual_hint
                    : R.string.scanner_focus_continuous_hint);
        findViewById(R.id.scanner_focus_manual_row).setVisibility(usesManualFocus() ? View.VISIBLE : View.GONE);
        focusDistance.setProgress(Math.round(settings.focusPosition * 100));
    }

    private boolean manualExposure() {
        return CameraSettings.EXPOSURE_MANUAL.equals(settings.exposureMode);
    }

    private void setExposureMode(String mode) {
        settings.exposureMode = mode;
        persistSettings();
        applyExposure();
        renderExposure();
    }

    // Auto par défaut ; en manuel, la glissière décale l'exposition de la
    // caméra (compensation en EV, l'exposition automatique reste active).
    private void renderExposure() {
        if (camera == null) return;
        ExposureState state = camera.getCameraInfo().getExposureState();
        boolean supported = state.isExposureCompensationSupported();
        findViewById(R.id.scanner_exposure_section).setVisibility(supported ? View.VISIBLE : View.GONE);
        if (!supported) return;
        boolean manual = manualExposure();
        styleChip(exposureAuto, !manual);
        styleChip(exposureManual, manual);
        exposureHint.setText(manual ? R.string.scanner_exposure_manual_hint : R.string.scanner_exposure_auto_hint);
        exposure.setVisibility(manual ? View.VISIBLE : View.GONE);
        Range<Integer> range = state.getExposureCompensationRange();
        exposure.setMax(range.getUpper() - range.getLower());
        int index = Math.max(range.getLower(), Math.min(range.getUpper(), settings.exposureIndex));
        exposure.setProgress(index - range.getLower());
        renderExposureValue();
    }

    private void renderExposureValue() {
        if (camera == null) return;
        if (!manualExposure()) {
            exposureValue.setText(R.string.scanner_exposure_auto);
            return;
        }
        ExposureState state = camera.getCameraInfo().getExposureState();
        Range<Integer> range = state.getExposureCompensationRange();
        int index = Math.max(range.getLower(), Math.min(range.getUpper(), settings.exposureIndex));
        float ev = index * state.getExposureCompensationStep().floatValue();
        exposureValue.setText(String.format(Locale.US, "%+.1f EV", ev));
    }

    private void styleChip(Button chip, boolean selected) {
        chip.setBackgroundResource(selected ? R.drawable.scanner_button_primary : R.drawable.scanner_button_secondary);
        chip.setTextColor(ContextCompat.getColor(this, selected ? R.color.scanner_on_accent : android.R.color.white));
    }

    private static String cameraIdOf(CameraInfo info) {
        return Camera2CameraInfo.from(info).getCameraId();
    }

    // Focale en équivalent 24×36 : ce que montrent les applis photo (13 mm
    // pour un ultra grand-angle, 24 mm pour la principale). 0 si inconnue.
    private int equivalentFocalLength(CameraInfo info) {
        Camera2CameraInfo characteristics = Camera2CameraInfo.from(info);
        float[] focals = characteristics.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS);
        SizeF sensor = characteristics.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE);
        if (focals == null || focals.length == 0 || sensor == null) return 0;
        double diagonal = Math.hypot(sensor.getWidth(), sensor.getHeight());
        return diagonal > 0 ? (int) Math.round(focals[0] * 43.27 / diagonal) : 0;
    }

    private String labelOf(CameraInfo info, int index) {
        int focal = equivalentFocalLength(info);
        if (focal <= 0) return getString(R.string.scanner_lens_other, index + 1);
        if (focal < 20) return getString(R.string.scanner_lens_ultrawide, focal);
        if (focal > 35) return getString(R.string.scanner_lens_telephoto, focal);
        return getString(R.string.scanner_lens_main, focal);
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyze(ImageProxy image) {
        if (image.getImage() == null) {
            image.close();
            return;
        }
        int turn = extraRotation;
        int rotation = (image.getImageInfo().getRotationDegrees() + turn) % 360;
        InputImage input = InputImage.fromMediaImage(image.getImage(), rotation);
        // Dimensions de l'image telle que lue (redressée), repère des lignes.
        boolean sideways = rotation == 90 || rotation == 270;
        int width = sideways ? image.getHeight() : image.getWidth();
        int height = sideways ? image.getWidth() : image.getHeight();
        // Résultat sur le fil principal, seul à toucher la session.
        recognizer.process(input)
            .addOnSuccessListener(ContextCompat.getMainExecutor(this), text -> onText(text, width, height, turn))
            .addOnCompleteListener(task -> image.close());
    }

    private void onText(Text text, int width, int height, int turn) {
        if (stopped || isFinishing()) return;
        List<CardTextParser.TextLine> lines = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) continue;
                lines.add(new CardTextParser.TextLine(line.getText(), box.left, box.top, box.right, box.bottom));
            }
        }
        ScanReading reading;
        if (autoMode()) {
            // Ce qui est lu est ce qui est visible (côtés rognés en remplissage) ;
            // une image tournée d'un quart de tour n'a plus ce repère.
            if (turn == 0) lines = linesIn(frame.visibleInImage(), lines, width, height, 0f);
            reading = CardTextParser.parseAround(lines, width / 2, height / 2, Math.round(width * COLUMN_TOLERANCE));
            // Image sans texte lisible : un quart de tour à l'essai suivant.
            if (turn == extraRotation && !reading.hasCollectorInfo()
                && CardTextParser.readableLines(lines) < MIN_READABLE_LINES) {
                if (++unreadableFrames >= UNREADABLE_FRAMES_BEFORE_TURN) {
                    extraRotation = (extraRotation + 90) % 360;
                    unreadableFrames = 0;
                }
            } else {
                unreadableFrames = 0;
            }
        } else {
            lines = linesInFrame(lines, width, height);
            reading = CardTextParser.parse(lines);
        }
        if (debuggable) logReading(lines, reading);
        long now = SystemClock.elapsedRealtime();
        String key = session.onReading(reading, now);
        if (session.counted != null) onCounted(session.counted);
        if (key != null) {
            if (now < pausedUntil) session.onLookupFailed(key);
            else lookup(key, reading);
        }
    }

    // Mode Cadre : les lignes dont le centre tombe dans le cadre, marge
    // comprise. L'aperçu et l'analyse montrent le même champ (4:3 entier).
    private List<CardTextParser.TextLine> linesInFrame(List<CardTextParser.TextLine> lines, int width, int height) {
        return linesIn(frame.frameInImage(), lines, width, height, FRAME_MARGIN);
    }

    // Lignes dont le centre tombe dans `zone` (fractions de l'image), agrandie
    // de `margin` (fraction de sa taille).
    private static List<CardTextParser.TextLine> linesIn(
        RectF zone, List<CardTextParser.TextLine> lines, int width, int height, float margin
    ) {
        if (zone == null || width <= 0 || height <= 0) return lines;
        zone.inset(-zone.width() * margin, -zone.height() * margin);
        List<CardTextParser.TextLine> kept = new ArrayList<>();
        for (CardTextParser.TextLine line : lines) {
            float x = (line.left + line.right) / 2f / width;
            float y = (line.top + line.bottom) / 2f / height;
            if (zone.contains(x, y)) kept.add(line);
        }
        return kept;
    }

    private void logReading(List<CardTextParser.TextLine> lines, ScanReading reading) {
        StringBuilder text = new StringBuilder();
        for (CardTextParser.TextLine line : lines) {
            text.append("\n  [").append(line.left).append(',').append(line.top).append("] ").append(line.text);
        }
        Log.d("SpellcacheScanner", "mode=" + settings.scanMode + " turn=" + extraRotation
            + " set=" + reading.setCode + " number=" + reading.collectorNumber
            + " lang=" + reading.language + " names=" + reading.names + text);
    }

    private void lookup(String key, ScanReading reading) {
        lookupExecutor.execute(() -> {
            try {
                CatalogClient.Lookup result = catalog.lookup(reading);
                ScanSession.Match match = result.match;
                // Icône du set chargée avec la lecture, avant l'affichage.
                if (match != null && match.exact) setIcons.load(match.setIconUri);
                runOnUiThread(() -> {
                    ScanSession.Entry counted = session.onLookup(key, match, SystemClock.elapsedRealtime());
                    if (counted != null) onCounted(counted);
                    else if (result.outsideSets) showStatus(null, getString(R.string.scanner_outside_sets));
                    else if (match == null && reading.hasCollectorInfo()) showStatus(null, getString(R.string.scanner_no_match));
                });
            } catch (CatalogClient.RefusedException e) {
                runOnUiThread(() -> onRefused(key, e.status));
            } catch (IOException e) {
                runOnUiThread(() -> {
                    session.onLookupFailed(key);
                    showStatus(null, getString(R.string.scanner_offline));
                });
            }
        });
    }

    private void onRefused(String key, int status) {
        session.onLookupFailed(key);
        if (status == 429) {
            pausedUntil = SystemClock.elapsedRealtime() + RATE_LIMIT_PAUSE_MS;
            showStatus(null, getString(R.string.scanner_rate_limited));
            return;
        }
        stopped = true;
        showStatus(getString(status == 404 ? R.string.scanner_disabled : R.string.scanner_signed_out), "");
    }

    private void onCounted(ScanSession.Entry entry) {
        ScanSession.Match match = entry.match;
        showStatus(match.name, detailOf(entry));
        // Comme dans l'app : icône du set, code, numéro.
        if (match.exact) showSetIcon(match);
        showQty(entry);
        frame.flash();
        // Son et vibration : réglages de scan de l'écran de revue.
        if (settings.sound && sounds != null) sounds.play(countedSound, 0.8f, 0.8f, 1, 0, 1f);
        if (settings.vibration) vibrate();
        updateButtons();
    }

    // Vibration demandée dans les réglages de scan : par le vibreur, en
    // usage média. Le retour tactile du système (`performHapticFeedback`)
    // est ignoré en mode silencieux ou quand l'utilisateur l'a coupé.
    private void vibrate() {
        Vibrator vibrator = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? ((VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
            : (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            vibrator.vibrate(VIBRATION_MS);
            return;
        }
        VibrationEffect effect = VibrationEffect.createOneShot(VIBRATION_MS, VibrationEffect.DEFAULT_AMPLITUDE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA));
        } else {
            vibrator.vibrate(effect, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build());
        }
    }

    private void undoLast() {
        ScanSession.Entry removed = session.undo();
        if (removed == null) return;
        showStatus(getString(R.string.scanner_undone, removed.match.name), "");
        updateButtons();
    }

    // Flash : marche/arrêt (raccourci de la barre du haut et réglages) et
    // intensité quand l'appareil la règle (Android 15+, ex. 23 niveaux sur
    // Pixel 9a).
    private void setTorch(boolean on) {
        settings.torchOn = on;
        persistSettings();
        applyTorch();
        renderFlash();
    }

    private void applyTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        camera.getCameraControl().enableTorch(settings.torchOn);
        if (camera.getCameraInfo().isTorchStrengthSupported()) {
            int max = camera.getCameraInfo().getMaxTorchStrengthLevel();
            int level = settings.torchLevel <= 0 ? max : Math.min(max, settings.torchLevel);
            camera.getCameraControl().setTorchStrengthLevel(level);
        }
        torch.setAlpha(settings.torchOn ? 1f : 0.7f);
        torch.setBackgroundResource(settings.torchOn ? R.drawable.scanner_button_primary_round : R.drawable.scanner_round_button);
    }

    private void renderFlash() {
        if (camera == null) return;
        boolean hasFlash = camera.getCameraInfo().hasFlashUnit();
        flashSection.setVisibility(hasFlash ? View.VISIBLE : View.GONE);
        if (!hasFlash) return;
        styleChip(flashOff, !settings.torchOn);
        styleChip(flashOn, settings.torchOn);
        boolean strength = camera.getCameraInfo().isTorchStrengthSupported();
        flashLevelRow.setVisibility(strength ? View.VISIBLE : View.GONE);
        if (!strength) return;
        int max = camera.getCameraInfo().getMaxTorchStrengthLevel();
        int level = settings.torchLevel <= 0 ? max : Math.min(max, settings.torchLevel);
        flashLevel.setMax(Math.max(0, max - 1));
        flashLevel.setProgress(level - 1);
        flashLevelValue.setText(String.format(Locale.US, "%d%%", Math.round(level * 100f / max)));
    }

    // Réglages : sur le téléphone tout de suite, sur le compte peu après.
    private void persistSettings() {
        settingsTouched = true;
        settings.save(this);
        mainHandler.removeCallbacks(pushSettings);
        mainHandler.postDelayed(pushSettings, SETTINGS_PUSH_DELAY_MS);
        pushPending = true;
    }

    private void pushSettings() {
        pushPending = false;
        org.json.JSONObject json = settings.toJson();
        lookupExecutor.execute(() -> {
            try {
                catalog.putSettings(json);
            } catch (IOException e) {
                // Réessayé au prochain changement ; la copie locale reste.
            }
        });
    }

    // Réglages du compte à l'ouverture : ils remplacent la copie locale,
    // sauf si un réglage a déjà été changé entre-temps.
    private void fetchSettings() {
        lookupExecutor.execute(() -> {
            org.json.JSONObject remote;
            try {
                remote = catalog.getSettings();
            } catch (IOException e) {
                return;
            }
            runOnUiThread(() -> {
                if (isFinishing() || settingsTouched) return;
                if (remote.length() == 0) {
                    // Rien sur le compte : la copie locale y est envoyée.
                    pushSettings();
                    return;
                }
                String before = settings.toJson().toString();
                settings.applyJson(remote);
                if (before.equals(settings.toJson().toString())) return;
                settings.save(this);
                applyViewMode();
                applyScanMode();
                if (cameraProvider != null) bindCamera(cameraProvider);
            });
        });
    }

    // « FIN #173 » avec l'icône du set, et le nom complet du set dessous.
    // « FIN #173 · Foil » puis le nom du set ; lue par son nom : « Added by
    // name », l'impression reste à confirmer.
    private CharSequence detailOf(ScanSession.Entry entry) {
        ScanSession.Match match = entry.match;
        android.text.SpannableStringBuilder text = new android.text.SpannableStringBuilder(match.exact
            ? getString(R.string.scanner_added_detail, match.setCode.toUpperCase(java.util.Locale.ROOT), match.collectorNumber)
            : getString(R.string.scanner_added_by_name));
        if (foilOf(entry)) {
            text.append(" · ");
            int start = text.length();
            text.append(getString(R.string.scanner_foil_label));
            text.setSpan(new android.text.style.ForegroundColorSpan(ContextCompat.getColor(this, R.color.scanner_accent_text)),
                start, text.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            text.setSpan(new android.text.style.StyleSpan(android.graphics.Typeface.BOLD),
                start, text.length(), android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }
        if (match.exact && match.setName != null) text.append("\n").append(match.setName);
        return text;
    }

    private void showStatus(String title, CharSequence subtitle) {
        if (title != null) status.setText(title);
        if (subtitle != null) {
            detail.setText(subtitle);
            shownMatch = null;
            showQty(null);
        }
    }

    // Invisible plutôt qu'absent : le panneau garde sa hauteur.
    private void showQty(ScanSession.Entry entry) {
        shownEntry = entry;
        qtyStepper.setVisibility(entry == null ? View.INVISIBLE : View.VISIBLE);
        renderQuickActions();
        if (entry == null) return;
        qtyValue.setText(String.valueOf(entry.qty));
        qtyMinus.setEnabled(entry.qty > 0);
        qtyMinus.setAlpha(entry.qty > 0 ? 1f : 0.4f);
    }

    private void changeQty(int delta) {
        if (shownEntry == null) return;
        if (delta > 0) session.increment(shownEntry);
        else session.decrement(shownEntry);
        showQty(shownEntry);
        updateButtons();
    }

    // Icône dans le texte, devant « FIN #173 » : alignée sur sa ligne, quelle
    // que soit la hauteur du bloc de détail.
    private void setDetailIcon(Drawable icon) {
        android.text.SpannableStringBuilder text = new android.text.SpannableStringBuilder("  ");
        int align = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? android.text.style.ImageSpan.ALIGN_CENTER
            : android.text.style.ImageSpan.ALIGN_BASELINE;
        text.setSpan(new android.text.style.ImageSpan(icon, align), 0, 1, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        CharSequence current = detail.getText();
        // Texte sans icône : celui posé par `onCounted`.
        if (current instanceof android.text.Spanned
            && ((android.text.Spanned) current).getSpans(0, current.length(), android.text.style.ImageSpan.class).length > 0) return;
        text.append(current);
        detail.setText(text);
    }

    private void showSetIcon(ScanSession.Match match) {
        shownMatch = match;
        Drawable icon = setIcons.cached(match.setIconUri);
        if (icon != null) {
            setDetailIcon(icon);
            return;
        }
        if (match.setIconUri == null) return;
        // Pas encore chargée (lecture déjà connue d'un autre set) : ajoutée
        // dès qu'elle arrive, si la carte est toujours affichée.
        lookupExecutor.execute(() -> {
            Drawable loaded = setIcons.load(match.setIconUri);
            if (loaded == null) return;
            runOnUiThread(() -> {
                if (shownMatch == match) setDetailIcon(loaded);
            });
        });
    }

    private void updateButtons() {
        int total = session.total();
        undo.setEnabled(total > 0);
        undo.setAlpha(total > 0 ? 1f : 0.5f);
        done.setText(total > 0 ? getString(R.string.scanner_done_count, total) : getString(R.string.scanner_done));
    }

    // Langues proposées (celles d'un holding, comme l'écran de revue).
    private static final String[] LANGUAGE_CODES = {"en", "fr", "de", "es", "it", "pt", "ja"};
    private static final String[] LANGUAGE_LABELS = {
        "English", "French", "German", "Spanish", "Italian", "Portuguese", "Japanese",
    };

    // Langue d'une carte : choisie ici, sinon celle des réglages de scan,
    // sinon celle imprimée sur la carte.
    private String languageOf(ScanSession.Entry entry) {
        return entry.language != null ? entry.language : defaultLanguageOf(entry.match);
    }

    private String defaultLanguageOf(ScanSession.Match match) {
        return "auto".equals(settings.defaultLanguage) ? match.language : settings.defaultLanguage;
    }

    // Foil : choisi ici, sinon celui des réglages de scan, dans les finitions
    // de l'impression (une promo seulement foil l'est toujours).
    private boolean foilOf(ScanSession.Entry entry) {
        ScanSession.Match match = entry.match;
        if (!match.hasFinish("nonfoil") && match.hasFinish("foil")) return true;
        if (!match.hasFinish("foil")) return false;
        return entry.foil != null ? entry.foil : settings.foilDefault;
    }

    private boolean canToggleFoil(ScanSession.Entry entry) {
        return entry.match.hasFinish("foil") && entry.match.hasFinish("nonfoil");
    }

    private void renderQuickActions() {
        ScanSession.Entry entry = shownEntry;
        quickActions.setVisibility(entry == null ? View.GONE : View.VISIBLE);
        if (entry == null) return;

        quickLanguage.setText(languageOf(entry).toUpperCase(java.util.Locale.ROOT));
        quickFoil.setVisibility(canToggleFoil(entry) || foilOf(entry) ? View.VISIBLE : View.GONE);
        quickFoil.setEnabled(canToggleFoil(entry));
        quickFoil.setBackgroundResource(foilOf(entry) ? R.drawable.scanner_button_primary_round : R.drawable.scanner_round_button);

        quickSet.setImageDrawable(null);
        String uri = entry.match.setIconUri;
        lookupExecutor.execute(() -> {
            Drawable icon = setIcons.load(uri, SetIcons.BUTTON_SIZE_DP, android.graphics.Color.WHITE);
            runOnUiThread(() -> {
                if (shownEntry == entry && icon != null) quickSet.setImageDrawable(icon);
            });
        });
    }

    // Choix d'édition : les impressions de la carte, avec l'icône du set.
    private void choosePrinting() {
        ScanSession.Entry entry = shownEntry;
        if (entry == null) return;
        String cardId = entry.match.cardId;
        lookupExecutor.execute(() -> {
            List<ScanSession.Match> printings;
            try {
                printings = catalog.printings(cardId);
            } catch (IOException e) {
                // Toast : la carte affichée et ses actions restent en place.
                runOnUiThread(() -> android.widget.Toast.makeText(this, R.string.scanner_offline, android.widget.Toast.LENGTH_SHORT).show());
                return;
            }
            List<Drawable> icons = new ArrayList<>();
            for (ScanSession.Match printing : printings) {
                icons.add(setIcons.load(printing.setIconUri, 20, android.graphics.Color.WHITE));
            }
            runOnUiThread(() -> showPrintings(entry, printings, icons));
        });
    }

    private void showPrintings(ScanSession.Entry entry, List<ScanSession.Match> printings, List<Drawable> icons) {
        if (isFinishing() || shownEntry != entry) return;
        if (printings.size() <= 1) {
            android.widget.Toast.makeText(this, R.string.scanner_only_printing, android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        List<ScannerPicker.Option> options = new ArrayList<>();
        for (int i = 0; i < printings.size(); i++) {
            ScanSession.Match printing = printings.get(i);
            options.add(new ScannerPicker.Option(
                getString(R.string.scanner_added_detail,
                    printing.setCode.toUpperCase(java.util.Locale.ROOT), printing.collectorNumber),
                printing.setName,
                icons.get(i),
                printing.cardId.equals(entry.match.cardId)));
        }
        ScannerPicker.show(this, entry.match.name, options, which -> {
            ScanSession.Match chosen = printings.get(which);
            if (chosen.cardId.equals(entry.match.cardId)) return;
            showCountedCard(session.restyle(entry, chosen, entry.foil, entry.language));
        });
    }

    private void chooseLanguage() {
        ScanSession.Entry entry = shownEntry;
        if (entry == null) return;
        // Comme le choix des réglages de scan : d'abord la langue lue sur la
        // carte, cochée tant qu'aucune autre n'est imposée.
        String printed = entry.match.language;
        boolean detected = entry.language == null && "auto".equals(settings.defaultLanguage);
        String current = languageOf(entry);
        List<ScannerPicker.Option> options = new ArrayList<>();
        int printedIndex = java.util.Arrays.asList(LANGUAGE_CODES).indexOf(printed);
        options.add(new ScannerPicker.Option(
            getString(R.string.scanner_language_detected),
            getString(R.string.scanner_language_detected_hint,
                printedIndex >= 0 ? LANGUAGE_LABELS[printedIndex] : printed.toUpperCase(java.util.Locale.ROOT)),
            null,
            detected));
        for (int i = 0; i < LANGUAGE_CODES.length; i++) {
            options.add(new ScannerPicker.Option(LANGUAGE_LABELS[i], null, null, !detected && LANGUAGE_CODES[i].equals(current)));
        }
        ScannerPicker.show(this, getString(R.string.scanner_quick_language), options, which -> {
            String language = which == 0 ? printed : LANGUAGE_CODES[which - 1];
            // `null` quand c'est la langue par défaut de la carte.
            String chosen = language.equals(defaultLanguageOf(entry.match)) ? null : language;
            showCountedCard(session.restyle(entry, entry.match, entry.foil, chosen));
        });
    }

    private void toggleFoil() {
        ScanSession.Entry entry = shownEntry;
        if (entry == null || !canToggleFoil(entry)) return;
        boolean foil = !foilOf(entry);
        // `null` quand c'est le foil par défaut.
        Boolean chosen = foil == settings.foilDefault ? null : foil;
        showCountedCard(session.restyle(entry, entry.match, chosen, entry.language));
    }

    // Panneau du bas pour cette carte : nom, édition, exemplaires, actions.
    private void showCountedCard(ScanSession.Entry entry) {
        ScanSession.Match match = entry.match;
        showStatus(match.name, detailOf(entry));
        if (match.exact) showSetIcon(match);
        showQty(entry);
        updateButtons();
    }

    private void finishWithCards() {
        JSONArray cards = new JSONArray();
        try {
            for (ScanSession.Entry entry : session.entries()) {
                cards.put(new JSONObject()
                    .put("cardId", entry.match.cardId)
                    .put("qty", entry.qty)
                    .put("exact", entry.match.exact)
                    .put("language", languageOf(entry))
                    .put("foil", foilOf(entry)));
            }
        } catch (JSONException e) {
            cards = new JSONArray();
        }
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_CARDS, cards.toString()));
        finish();
    }

    /** Intention qui ouvre le scanner sur l'instance `origin`. */
    public static Intent intent(Context context, String origin) {
        return new Intent(context, ScannerActivity.class).putExtra(EXTRA_ORIGIN, origin);
    }
}
