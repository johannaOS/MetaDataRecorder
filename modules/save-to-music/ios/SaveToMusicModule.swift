import ExpoModulesCore

// iOS has no shared Music folder for third-party apps.
// Return nil so the JS caller falls back to app documents,
// which are visible in the Files app when UIFileSharingEnabled is set.
public class SaveToMusicModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SaveToMusic")

    AsyncFunction("saveAudioFile") { (_: String, _: String) -> String? in
      return nil
    }
  }
}
