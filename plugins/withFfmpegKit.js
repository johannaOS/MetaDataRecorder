/**
 * Config plugin that adds expo-ffmpeg-kit's bundled AAR to the main app's
 * build.gradle as a runtime dependency.
 *
 * expo-ffmpeg-kit's own build.gradle uses `compileOnly` for the AAR, which
 * means the AAR is available at compile time but not bundled into the app.
 * This plugin adds the missing `implementation` declaration so the AAR is
 * included at runtime.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');
const path = require('path');

const MARKER = '// expo-ffmpeg-kit runtime dependency';

module.exports = function withFfmpegKit(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    if (gradle.includes(MARKER)) return config; // already applied

    // Resolve the path to the bundled AAR relative to the android/ dir
    // During EAS prebuild the android/ dir sits at <projectRoot>/android/
    const aarRelPath = '../../node_modules/expo-ffmpeg-kit/android/libs';

    // 1. Add flatDir repository so Gradle can find the local AAR
    const repoBlock = `
    // ${MARKER}
    flatDir {
        dirs "${aarRelPath}"
    }`;

    // Insert inside the existing repositories { } block in the android section
    if (gradle.includes('repositories {')) {
      gradle = gradle.replace('repositories {', `repositories {${repoBlock}`);
    } else {
      // Fallback: append a repositories block before dependencies
      gradle = gradle.replace(
        /^(dependencies\s*\{)/m,
        `repositories {${repoBlock}\n}\n\n$1`,
      );
    }

    // 2. Add implementation dependency for the bundled AAR
    const implLine = `\n    // ${MARKER}\n    implementation(name: 'ffmpeg-kit', ext: 'aar')\n`;
    gradle = gradle.replace(/^(dependencies\s*\{)/m, `$1${implLine}`);

    config.modResults.contents = gradle;
    return config;
  });
};
