/**
 * Adds android:foregroundServiceType="microphone" to every foreground service
 * declared in the merged AndroidManifest.xml.
 *
 * Required on Android 12+ (API 31+): without this attribute the OS revokes
 * microphone access (OP_RECORD_AUDIO / App op 27) when the app loses foreground.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withForegroundMicrophoneService(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (!app) return config;

    (app.service ?? []).forEach((svc) => {
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
