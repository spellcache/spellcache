package io.github.spellcache.scanner;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.ListView;
import android.widget.TextView;

import io.github.spellcache.R;

import java.util.List;

/**
 * Choix dans une liste, en feuille du bas sombre comme `PickerSheet` dans
 * l'app : les dialogues système du thème AppCompat juraient sur le scanner.
 */
final class ScannerPicker {

    static final class Option {
        final String label;
        /** `null` : pas de deuxième ligne. */
        final String hint;
        /** `null` : pas d'icône. */
        final Drawable icon;
        final boolean selected;

        Option(String label, String hint, Drawable icon, boolean selected) {
            this.label = label;
            this.hint = hint;
            this.icon = icon;
            this.selected = selected;
        }
    }

    interface OnPick {
        void onPick(int index);
    }

    // Au-delà, la liste défile : la feuille ne couvre jamais tout l'aperçu.
    private static final float MAX_LIST_HEIGHT = 0.6f;

    private ScannerPicker() {}

    static void show(Activity activity, String title, List<Option> options, OnPick onPick) {
        Dialog dialog = new Dialog(activity, R.style.ScannerPickerDialog);
        View sheet = LayoutInflater.from(activity).inflate(R.layout.scanner_picker, null);
        ((TextView) sheet.findViewById(R.id.scanner_picker_title)).setText(title);
        sheet.findViewById(R.id.scanner_picker_close).setOnClickListener(v -> dialog.dismiss());

        ListView list = sheet.findViewById(R.id.scanner_picker_list);
        list.setClipToOutline(true);
        list.setAdapter(new BaseAdapter() {
            @Override
            public int getCount() {
                return options.size();
            }

            @Override
            public Object getItem(int position) {
                return options.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                View row = convertView != null
                    ? convertView
                    : LayoutInflater.from(activity).inflate(R.layout.scanner_picker_row, parent, false);
                Option option = options.get(position);
                ImageView icon = row.findViewById(R.id.scanner_picker_icon);
                icon.setImageDrawable(option.icon);
                icon.setVisibility(option.icon == null ? View.GONE : View.VISIBLE);
                ((TextView) row.findViewById(R.id.scanner_picker_label)).setText(option.label);
                TextView hint = row.findViewById(R.id.scanner_picker_hint);
                hint.setText(option.hint);
                hint.setVisibility(option.hint == null ? View.GONE : View.VISIBLE);
                // Coche sur le choix courant, chevron sur les autres.
                ((ImageView) row.findViewById(R.id.scanner_picker_mark))
                    .setImageResource(option.selected ? R.drawable.ic_scanner_check : R.drawable.ic_scanner_chevron);
                return row;
            }
        });
        list.setOnItemClickListener((parent, view, position, id) -> {
            dialog.dismiss();
            onPick.onPick(position);
        });
        dialog.setContentView(sheet);

        // Hauteur bornée une fois la liste mesurée ; le choix courant visible.
        int maxHeight = Math.round(activity.getResources().getDisplayMetrics().heightPixels * MAX_LIST_HEIGHT);
        list.post(() -> {
            if (list.getHeight() > maxHeight) {
                ViewGroup.LayoutParams params = list.getLayoutParams();
                params.height = maxHeight;
                list.setLayoutParams(params);
            }
            for (int i = 0; i < options.size(); i++) {
                if (options.get(i).selected) list.setSelection(Math.max(0, i - 2));
            }
        });

        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setGravity(Gravity.BOTTOM);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.setDimAmount(0.5f);
            // La feuille se prolonge sous la barre de navigation (bord à bord,
            // imposé depuis Android 15), son contenu au-dessus.
            androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false);
            int bottom = sheet.getPaddingBottom();
            androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(sheet, (view, insets) -> {
                int navigation = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars()).bottom;
                view.setPadding(view.getPaddingLeft(), view.getPaddingTop(), view.getPaddingRight(), bottom + navigation);
                return insets;
            });
            window.setWindowAnimations(android.R.style.Animation_InputMethod);
        }
        dialog.show();
    }
}
