package io.github.spellcache.scanner;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.SystemClock;
import android.util.AttributeSet;
import android.view.View;

import androidx.core.content.ContextCompat;

import io.github.spellcache.R;

/**
 * Cadre au format d'une carte (63 × 88 mm) sur l'aperçu, le reste voilé.
 * Mode Cadre : seule la carte du cadre (et une marge) est lue, et c'est la
 * zone de toucher pour la mise au point ; sa taille se règle. Mode Auto : pas
 * de cadre, toute l'image est lue et sert de zone de toucher. Le cadre (ou le
 * bord de l'image en Auto) passe à l'accent un instant quand une carte est
 * comptée ; un anneau marque le point de mise au point touché.
 *
 * Taille et place fixes : le cadre est posé sur l'image de la caméra, entre
 * les barres de l'écran dont la hauteur ne change pas (les réglages
 * s'affichent en surcouche). Deux affichages de l'image 4:3 : elle remplit
 * la vue, côtés rognés (`PreviewView.ScaleType.FILL_CENTER`), ou elle est
 * entière, en haut de la vue (`FIT_START`).
 */
public final class ScanFrameView extends View {

    private static final float CARD_RATIO = 88f / 63f;
    // Format du capteur, côté long / côté court (aperçu en 4:3).
    private static final float SENSOR_ASPECT = 4f / 3f;
    // Largeur du cadre sur la largeur visible de l'image (ce que montre
    // l'écran). Par défaut, la carte y tient tenue à 15-20 cm en
    // remplissage, distance où l'objectif principal fait la mise au point.
    public static final float DEFAULT_WIDTH_OF_IMAGE = 0.78f;
    public static final float MIN_WIDTH_OF_IMAGE = 0.45f;
    public static final float MAX_WIDTH_OF_IMAGE = 0.92f;
    private static final long FLASH_MS = 450;
    private static final long FOCUS_RING_MS = 900;

    private final Paint dim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF frame = new RectF();
    private final RectF image = new RectF();
    // Partie de l'image visible dans la vue.
    private final RectF visible = new RectF();
    private boolean fillView = true;
    private boolean frameMode = true;
    private float widthOfImage = DEFAULT_WIDTH_OF_IMAGE;
    private final Path veil = new Path();
    private final float radius;
    private final float ringRadius;
    private final int idleColor;
    private final int accentColor;
    private long flashUntil;

    private float focusX;
    private float focusY;
    private long focusShownAt = -1;
    private boolean focusLocked;

    // Marges du haut et du bas laissées aux barres de l'écran.
    private int topInset;
    private int bottomInset;

    public ScanFrameView(Context context, AttributeSet attrs) {
        super(context, attrs);
        float density = getResources().getDisplayMetrics().density;
        radius = 14 * density;
        ringRadius = 30 * density;
        idleColor = 0xCCFFFFFF;
        accentColor = ContextCompat.getColor(context, R.color.scanner_accent);
        dim.setColor(ContextCompat.getColor(context, R.color.scanner_dim));
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(3 * density);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(2 * density);
    }

    public void setInsets(int top, int bottom) {
        if (top == topInset && bottom == bottomInset) return;
        topInset = top;
        bottomInset = bottom;
        invalidate();
    }

    /** `true` : l'image remplit la vue ; `false` : entière, en haut de la vue. */
    public void setFillView(boolean fill) {
        fillView = fill;
        invalidate();
    }

    public void setFrameMode(boolean enabled) {
        frameMode = enabled;
        invalidate();
    }

    public void setFrameSize(float fractionOfImage) {
        widthOfImage = Math.max(MIN_WIDTH_OF_IMAGE, Math.min(MAX_WIDTH_OF_IMAGE, fractionOfImage));
        invalidate();
    }

    /** Zone de toucher : le cadre, ou toute l'image en mode Auto. */
    public boolean frameContains(float x, float y) {
        return frameMode ? frame.contains(x, y) : visible.contains(x, y);
    }

    /** La partie visible de l'image, en fractions de l'image (0 à 1). */
    public RectF visibleInImage() {
        if (image.width() <= 0 || image.height() <= 0) return null;
        return new RectF(
            (visible.left - image.left) / image.width(),
            (visible.top - image.top) / image.height(),
            (visible.right - image.left) / image.width(),
            (visible.bottom - image.top) / image.height());
    }

    /** Le cadre en fractions de l'image affichée (0 à 1), `null` en mode Auto. */
    public RectF frameInImage() {
        if (!frameMode || image.width() <= 0 || image.height() <= 0) return null;
        return new RectF(
            (frame.left - image.left) / image.width(),
            (frame.top - image.top) / image.height(),
            (frame.right - image.left) / image.width(),
            (frame.bottom - image.top) / image.height());
    }

    public void flash() {
        flashUntil = SystemClock.uptimeMillis() + FLASH_MS;
        invalidate();
        postInvalidateDelayed(FLASH_MS);
    }

    /** Anneau blanc au point touché, le temps de la mise au point. */
    public void showFocus(float x, float y) {
        focusX = x;
        focusY = y;
        focusLocked = false;
        focusShownAt = SystemClock.uptimeMillis();
        invalidate();
    }

    /** Mise au point faite : l'anneau passe à l'accent puis s'efface. */
    public void focusDone(boolean success) {
        focusLocked = success;
        focusShownAt = SystemClock.uptimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        // Image placée comme l'aperçu : remplissant la vue, centrée, ou
        // entière, centrée en largeur et en haut.
        float viewWidth = getWidth();
        float viewHeight = getHeight();
        float imageAspect = viewHeight >= viewWidth ? 1f / SENSOR_ASPECT : SENSOR_ASPECT;
        float scaleToWidth = viewWidth;
        float scaleToHeight = viewHeight * imageAspect;
        float imageWidth = fillView ? Math.max(scaleToWidth, scaleToHeight) : Math.min(scaleToWidth, scaleToHeight);
        float imageHeight = imageWidth / imageAspect;
        float imageLeft = (viewWidth - imageWidth) / 2f;
        float imageTop = fillView ? (viewHeight - imageHeight) / 2f : 0f;
        image.set(imageLeft, imageTop, imageLeft + imageWidth, imageTop + imageHeight);
        visible.set(
            Math.max(0, image.left), Math.max(0, image.top),
            Math.min(viewWidth, image.right), Math.min(viewHeight, image.bottom));

        // Partie de l'image entre les barres de l'écran.
        float areaTop = Math.max(visible.top, topInset);
        float areaBottom = Math.min(visible.bottom, viewHeight - bottomInset);
        if (areaBottom <= areaTop) {
            areaTop = topInset;
            areaBottom = viewHeight - bottomInset;
        }

        float width = visible.width() * widthOfImage;
        float height = width * CARD_RATIO;
        float maxHeight = (areaBottom - areaTop) * 0.92f;
        if (height > maxHeight) {
            height = maxHeight;
            width = height / CARD_RATIO;
        }
        float left = visible.left + (visible.width() - width) / 2f;
        float top = areaTop + (areaBottom - areaTop - height) / 2f;
        frame.set(left, top, left + width, top + height);

        long now = SystemClock.uptimeMillis();
        if (frameMode) {
            veil.reset();
            veil.setFillType(Path.FillType.EVEN_ODD);
            veil.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            veil.addRoundRect(frame, radius, radius, Path.Direction.CW);
            canvas.drawPath(veil, dim);
            stroke.setColor(now < flashUntil ? accentColor : idleColor);
            canvas.drawRoundRect(frame, radius, radius, stroke);
        } else if (now < flashUntil) {
            stroke.setColor(accentColor);
            canvas.drawRect(visible, stroke);
        }

        if (focusShownAt >= 0) {
            long age = now - focusShownAt;
            if (age < FOCUS_RING_MS) {
                int alpha = (int) (255 * (1f - (float) age / FOCUS_RING_MS));
                ring.setColor(focusLocked ? accentColor : 0xFFFFFFFF);
                ring.setAlpha(alpha);
                canvas.drawCircle(focusX, focusY, ringRadius, ring);
                postInvalidateOnAnimation();
            } else {
                focusShownAt = -1;
            }
        }
    }
}
