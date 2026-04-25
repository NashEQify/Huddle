/**
 * Audio utility functions for voice test and call GainNode pipeline.
 *
 * Spec: 70.3, 70.6
 */

/**
 * Calculate RMS level from AnalyserNode time-domain data.
 *
 * Formula: rms = sqrt(sum((sample/128 - 1)^2) / N)
 * Normalized to 0.0-1.0 (clamped at 1.0).
 *
 * The AnalyserNode taps the GainNode output (post-gain).
 */
export function calculateRms(data: Uint8Array): number {
  if (data.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = data[i] / 128 - 1;
    sum += normalized * normalized;
  }

  const rms = Math.sqrt(sum / data.length);
  return Math.min(rms, 1.0);
}

/**
 * GainNode pipeline result.
 * Used by both VoiceTest and CallProvider.
 */
export interface GainPipelineResult {
  /** The AudioContext for this pipeline */
  audioContext: AudioContext;
  /** The GainNode controlling input volume */
  gainNode: GainNode;
  /** AnalyserNode for level metering */
  analyserNode: AnalyserNode;
  /** The processed MediaStreamTrack (post-gain) */
  processedTrack: MediaStreamTrack;
  /** The destination stream (for loopback or publishing) */
  destinationStream: MediaStream;
  /** Cleanup function to disconnect the graph */
  cleanup: () => void;
}

/**
 * Create GainNode pipeline from a raw MediaStreamTrack.
 *
 * Signal chain (from spec 70.3):
 *   Raw MediaStreamTrack
 *   -> AudioContext.createMediaStreamSource(new MediaStream([rawTrack]))
 *   -> GainNode (gain.value = storedGain / 100)
 *   -> [tap: AnalyserNode for level meter — parallel output from GainNode]
 *   -> AudioContext.createMediaStreamDestination()
 *   -> destination.stream.getAudioTracks()[0] = processedTrack
 */
export function createGainPipeline(
  rawTrack: MediaStreamTrack,
  gainValue: number,
): GainPipelineResult {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(
    new MediaStream([rawTrack]),
  );

  // GainNode
  const gainNode = audioContext.createGain();
  gainNode.gain.value = gainValue / 100;

  // AnalyserNode (taps GainNode output)
  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;

  // Destination
  const destination = audioContext.createMediaStreamDestination();

  // Wire: source -> gain -> destination
  source.connect(gainNode);
  gainNode.connect(destination);

  // Tap: gain -> analyser (parallel)
  gainNode.connect(analyserNode);

  const processedTrack = destination.stream.getAudioTracks()[0];

  const cleanup = () => {
    try {
      source.disconnect();
      gainNode.disconnect();
      analyserNode.disconnect();
      audioContext.close();
      rawTrack.stop(); // Release the mic
    } catch {
      // Ignore errors during cleanup
    }
  };

  return {
    audioContext,
    gainNode,
    analyserNode,
    processedTrack,
    destinationStream: destination.stream,
    cleanup,
  };
}
