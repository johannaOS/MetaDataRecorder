export const S = {
  // ── Common ──────────────────────────────────────────────────────────────────
  save: 'Spara',
  cancel: 'Avbryt',
  delete: 'Radera',
  error: 'Fel',
  untitled: 'Namnlös',

  // ── Field labels ────────────────────────────────────────────────────────────
  fieldTitle: 'Titel',
  fieldOfAfter: 'Av / efter',
  fieldFrom: 'Från',
  fieldSongType: 'Låttyp',
  fieldWhosPlaying: 'Vem spelar',
  fieldNotes: 'Anteckningar',
  fieldRecorded: 'Inspelad',

  // ── Placeholders ────────────────────────────────────────────────────────────
  placeholderUntitled: 'Namnlös',
  placeholderOfAfter: 't.ex. Erik Jonsson',
  placeholderFrom: 't.ex. Dalarna',
  placeholderSongType: 't.ex. Schottis, Vals, Polska…',
  placeholderPerformer: 'Musikerns namn',
  placeholderNotes: 'Ytterligare anteckningar…',
  placeholderSearch: 'Sök',

  // ── Screen 1: Recorder ──────────────────────────────────────────────────────
  appTitle: 'Röstinspelning',
  recordingInProgress: 'Inspelning pågår',
  tapToRecord: 'Tryck för att spela in',
  tapToStop: 'Tryck ■ för att stoppa',
  paused: 'Pausad',
  library: 'Bibliotek',

  // ── Screen 2: Metadata ──────────────────────────────────────────────────────
  addDetails: 'Lägg till detaljer',
  stopRecordingBtn: 'Stoppa',
  inlineFormPlaceholder: 'Titel, låttyp, ursprung...',
  discardBackButton: 'Kasta',
  discardRecording: 'Kasta inspelning?',
  discardRecordingMessage: 'Ljudfilen raderas permanent.',
  keepEditing: 'Fortsätt redigera',
  discard: 'Kasta',

  // ── Field management ─────────────────────────────────────────────────────────
  manageFields: 'Hantera fält',
  addField: 'Lägg till fält',
  newFieldPlaceholder: 'Fältnamn…',
  deleteField: 'Radera fält',
  builtInFieldHint: 'Inbyggt fält kan inte raderas',
  maxFieldsTitle: 'Maximalt antal fält nått',
  maxFieldsMessage: 'Du kan ha högst 20 fält totalt (inklusive dolda fält). Radera ett befintligt fält för att frigöra plats.',

  // ── Filter keywords ───────────────────────────────────────────────────────────
  addKeyword: 'Lägg till sökord',
  keywordPlaceholder: 'Nytt sökord…',

  // ── Screen 3: Library ───────────────────────────────────────────────────────
  filterLabel: 'Filtrera:',
  clearFilter: '✕ Rensa',
  noRecordingsYet: 'Inga inspelningar ännu',
  cancelSelection: 'Avbryt',
  deleteSelected: 'Radera valda',
  deleteRecordingPlural: 'Radera inspelningar?',
  deleteAlsoFromMusicFolder: 'Vill du även radera ljudfilerna från telefonens Music/VoiceRecorder-mapp?',
  deleteAppOnly: 'Bara i appen',
  deleteAppAndDevice: 'Appen och telefonen',

  // ── Screen 4: Detail ────────────────────────────────────────────────────────
  editScreenTitle: 'Redigera',
  recordingScreenTitle: 'Inspelning',
  recordingNotFound: 'Inspelningen hittades inte.',
  deleteRecording: 'Radera inspelning?',
  deleteRecordingMessage: 'Ljudfilen och all metadata raderas permanent.',

  // ── Settings / backup ────────────────────────────────────────────────────────
  settingsTitle: 'Inställningar',
  backupAndRestore: 'Säkerhetskopiering och återställning',
  mostRecentBackup: 'Senaste säkerhetskopia',
  noBackup: 'Ingen säkerhetskopia ännu',
  backupNow: 'Säkerhetskopiera nu',
  backupSuccess: 'Säkerhetskopia sparad',
  restoreFromBackup: 'Återställ från säkerhetskopia',
  confirmRestore: 'Bekräfta återställning',
  restoreConfirmMessage: 'Vill du återställa från denna säkerhetskopia? All nuvarande inspelningsdata kommer att skrivas över permanent.',
  restoreWarning: 'Varning: Återställning skriver över all nuvarande inspelningsdata. Åtgärden kan inte ångras.',
  audioFilesNote: 'Obs: Ljudfiler lagras separat och påverkas inte av säkerhetskopiering eller återställning.',
  restoreSuccess: 'Återställningen slutförd',

  // ── Import / save-to-phone ───────────────────────────────────────────────────
  importAudio: 'Importera ljud',
  couldNotImport: 'Kunde inte importera filen.',
  saveToPhone: 'Spara till Music-mapp',
  savedToPhone: 'Sparad till Music/VoiceRecorder',
  alreadyOnPhone: 'Filen finns redan i Music/VoiceRecorder.',
  importedTitle: 'Importerad',
  importedMessage: 'Filen har importerats till VoiceRecorder. Originalfilen är kvar på sin ursprungliga plats — inget har flyttats eller raderats.',
  importedMultiple: 'filer importerade. Originalfilerna är kvar på sina ursprungliga platser.',

  // ── Tags / labels ─────────────────────────────────────────────────────────────
  tagsLabel: 'Taggar',
  addTagPlaceholder: 'Ny tagg…',

  // ── Playback controls ─────────────────────────────────────────────────────────
  skipBack: 'Hoppa tillbaka',
  skipForward: 'Hoppa framåt',

  // ── Alerts ──────────────────────────────────────────────────────────────────
  permissionRequired: 'Behörighet krävs',
  microphonePermissionMessage: 'Mikrofonåtkomst krävs för att spela in ljud.',
  recordingError: 'Inspelningsfel',
  recordingUriNull: 'Inspelningsfilen saknar URI — inget sparades.',
  couldNotStartRecording: 'Kunde inte starta inspelningen.',
  couldNotPauseRecording: 'Kunde inte pausa inspelningen.',
  couldNotResumeRecording: 'Kunde inte återuppta inspelningen.',
  couldNotStopRecording: 'Kunde inte stoppa inspelningen.',
  couldNotSaveRecording: 'Kunde inte spara inspelningen.',
  couldNotSaveChanges: 'Kunde inte spara ändringarna.',
  couldNotDelete: 'Kunde inte radera inspelningen.',
  fileNotFound: 'Filen hittades inte',
  fileNoLongerExists: 'Ljudfilen finns inte längre på:\n',
  playbackError: 'Uppspelningsfel',
};
