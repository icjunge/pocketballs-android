package com.idleballs.pocket;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.SoundPool;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.SparseBooleanArray;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/** Short local collision sounds and restrained haptics. Called on the UI thread. */
final class CollisionFeedback {
    private final Context context;
    private final AudioManager audio;
    private final Vibrator vibrator;
    private final SoundPool sounds;
    private final Map<String, Integer> samples = new HashMap<>();
    private final SparseBooleanArray loaded = new SparseBooleanArray();
    private final int[] activeStreams = new int[4];
    private int nextStream;
    private boolean foregroundActive, sceneActive = true, soundEnabled = true,
        hapticsEnabled = true, destroyed;
    private long lastSoundMs = -1000, lastHapticMs = -1000;

    CollisionFeedback(Context context) {
        this.context = context.getApplicationContext();
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        sounds = new SoundPool.Builder().setMaxStreams(activeStreams.length)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .build();
        sounds.setOnLoadCompleteListener((pool, sampleId, status) -> {
            if (!destroyed && status == 0) loaded.put(sampleId, true);
        });
        for (String type : new String[]{"soccer", "tennis", "basketball", "volleyball"}) {
            samples.put(type, 0);
            try (AssetFileDescriptor asset = context.getAssets().openFd("audio/" + type + ".wav")) {
                samples.put(type, sounds.load(asset, 1));
            } catch (IOException unavailable) {
                // Missing/unavailable audio never prevents physics or haptics.
            }
        }
    }

    void setActive(boolean value) {
        foregroundActive = value && !destroyed;
        if (!foregroundActive) {
            stopSounds();
            if (vibrator != null) vibrator.cancel();
            lastSoundMs = lastHapticMs = -1000;
        }
    }

    void setState(boolean active, boolean sound, boolean haptics) {
        sceneActive = active;
        soundEnabled = sound;
        hapticsEnabled = haptics;
        if (!active || !sound) stopSounds();
        if ((!active || !haptics) && vibrator != null) vibrator.cancel();
    }

    private void stopSounds() {
        for (int i = 0; i < activeStreams.length; i++) {
            if (activeStreams[i] != 0) sounds.stop(activeStreams[i]);
            activeStreams[i] = 0;
        }
    }

    void play(String type, double rawStrength, boolean sound, boolean haptics) {
        if (!foregroundActive || !sceneActive || destroyed
                || !Double.isFinite(rawStrength) || rawStrength <= 0) return;
        double strength = Math.min(1, rawStrength);
        Integer sample = samples.get(type);
        // Reject unknown types instead of turning arbitrary bridge input into filenames.
        if (sample == null) return;
        long now = SystemClock.elapsedRealtime();
        if (sound && soundEnabled && strength >= .06 && now - lastSoundMs >= 55 && loaded.get(sample)
                && audio != null && audio.getRingerMode() == AudioManager.RINGER_MODE_NORMAL
                && audio.getStreamVolume(AudioManager.STREAM_MUSIC) > 0) {
            float volume = (float) Math.min(.5, .04 + .46 * strength);
            int stream = sounds.play(sample, volume, volume, 1, 0, 1);
            if (stream != 0) {
                activeStreams[nextStream] = stream;
                nextStream = (nextStream + 1) % activeStreams.length;
                lastSoundMs = now;
            }
        }
        // Tiny contacts stay quiet. A pile of balls cannot become continuous buzzing.
        if (haptics && hapticsEnabled && strength >= .25 && now - lastHapticMs >= 100
                && vibrator != null && vibrator.hasVibrator()
                && Settings.System.getInt(context.getContentResolver(),
                    Settings.System.HAPTIC_FEEDBACK_ENABLED, 1) != 0) {
            long durationMs = 8 + Math.round(strength * 7);
            int amplitude = 20 + (int) Math.round(strength * 45);
            vibrator.vibrate(VibrationEffect.createOneShot(durationMs, amplitude));
            lastHapticMs = now;
        }
    }

    void destroy() {
        if (destroyed) return;
        setActive(false);
        destroyed = true;
        sounds.release();
        loaded.clear();
        samples.clear();
    }
}
