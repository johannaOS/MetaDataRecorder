/**
 * Config plugin that ensures every foreground service in the app declares
 * android:foregroundServiceType="microphone".
 *
 * Required on Android 12+ (API 31+): without this attribute the OS revokes
 * microphone access (OP_RECORD_AUDIO / App op 27) when the app loses foreground.
 *
 * Additionally, this plugin explicitly overrides notifee's ForegroundService
 * declaration (which ships with foregroundServiceType="shortService" in its AAR)
 * so that the Gradle manifest merger picks up the microphone type. The
 * tools:replace attribute tells the merger to use our app-level value instead of
 * the library's value.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const NOTIFEE_SERVICE  = 'app.notifee.core.ForegroundService';
// microphone — keeps mic access during recording
// mediaPlayback — keeps audio output alive during background playback (Android 14 requirement)
const NOTIFEE_FGS_TYPE = 'microphone|mediaPlayback';

module.exports = function withForegroundMicrophoneService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return config;

    // Ensure the tools namespace is present on the root manifest element
    // (required for tools:replace to work during Gradle manifest merge).
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // 1. Add microphone type to every service already declared in our app manifest.
    (app.service ?? []).forEach((svc) => {
      if (!svc.$) return;
      const existing = svc.$['android:foregroundServiceType'] ?? '';
      if (!existing.includes('microphone')) {
        svc.$['android:foregroundServiceType'] = existing
          ? `${existing}|microphone`
          : 'microphone';
      }
    });

    // 2. Redeclare notifee's ForegroundService in our app manifest so the
    //    Gradle merger overrides the library AAR's "shortService" with "microphone".
    //    tools:replace="android:foregroundServiceType" tells the merger to prefer
    //    this app-level declaration over the library's.
    if (!app.service) app.service = [];
    const existing = app.service.find(
      (s) => s.$?.['android:name'] === NOTIFEE_SERVICE,
    );
    if (!existing) {
      app.service.push({
        $: {
          'android:name': NOTIFEE_SERVICE,
          'android:exported': 'false',
          'android:foregroundServiceType': NOTIFEE_FGS_TYPE,
          'tools:replace': 'android:foregroundServiceType',
        },
      });
    } else {
      existing.$['android:foregroundServiceType'] = NOTIFEE_FGS_TYPE;
      existing.$['tools:replace'] = 'android:foregroundServiceType';
    }

    return config;
  });
};
