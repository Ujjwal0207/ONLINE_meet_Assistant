/** Build generation options supported by the selected Whisper checkpoint. */
export function buildWhisperGenerationOptions(
  streaming: boolean,
  englishOnly: boolean,
  language: string | null,
): Record<string, unknown> {
  const options: Record<string, unknown> = streaming
    ? {
        sampling_rate: 16000,
        temperature: 0,
        no_speech_threshold: 0.6,
        // Suppress repetition loops on near-silent streaming windows.
        compression_ratio_threshold: 2.4,
        condition_on_previous_text: false,
        return_timestamps: false,
      }
    : {
        sampling_rate: 16000,
        condition_on_previous_text: false,
        compression_ratio_threshold: 2.4,
        logprob_threshold: -1.0,
        no_speech_threshold: 0.6,
      };

  // English-only checkpoints encode transcription behavior in their model
  // config and reject explicit task/language generation options.
  if (!englishOnly) {
    options.task = 'transcribe';
    if (language) options.language = language;
  }

  return options;
}
