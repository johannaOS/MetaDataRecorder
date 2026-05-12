/**
 * Expo config plugin — adds android:foregroundServiceType="microphone" to every
 * foreground service declared in the merged AndroidManifest.xml.
 *
 * Required on Android 12+ (API 31+): without this attribute the OS revokes
 * OP_RECORD_AUDIO (App op 27) approximately 5 seconds after the app loses
 * foreground, silencing background recordings.
 *
 * Apply in app.json plugins array.  Requires a new native build.
 */

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withForegroundMicrophoneService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return config;

    if (!app.service) app.service = [];

    app.service.forEach((svc) => {
      if (!svc.$) return;
      const existing = svc.$['android:foregroundServiceType'] ?? '';
      if (!existing.includes('microphone')) {
        svc.$['android:foregroundServiceType'] = existing
          ? `${existing}|microphone`
          : 'microphone';
      }
    });

    return config;
  });
};
