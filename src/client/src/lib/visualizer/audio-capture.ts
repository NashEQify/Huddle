/**
 * Audio capture for the visualizer — monitor source detection.
 *
 * Spec: 95.3
 * Detects the monitor/loopback source for the configured output device
 * (PipeWire/PulseAudio "Monitor of ..." or Windows "Stereo Mix").
 *
 * On Firefox: monitor sources appear in enumerateDevices() natively.
 * On Chromium+PipeWire: requires a pw-loopback service that exposes
 * the monitor as a regular source named "Huddle Audio Capture"
 * (Strategy 0). See scripts/setup-audio-capture.sh.
 */

export type AudioSourceType = 'monitor' | 'call' | 'none';

/**
 * Find the monitor/loopback source for the given output device.
 *
 * Spec: 95.3.1
 * Match strategies tried in order:
 *   0. "Huddle_Audio_Capture" — PipeWire virtual source (pw-loopback service)
 *   a. "Monitor of {exact output label}" (PipeWire/PulseAudio, works in Firefox)
 *   b. Contains "monitor" + substring of output label
 *   c. "Stereo Mix" or "What U Hear" (Windows)
 *   d. Contains "loopback" (generic)
 *   e. ANY input with "monitor" in the label (last resort)
 *
 * Never calls getUserMedia — only reads already-available device labels.
 * Returns the deviceId of the matching audioinput, or null.
 */
export async function findMonitorSource(
  outputDeviceId: string,
): Promise<string | null> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  let audioInputs = devices.filter((d) => d.kind === 'audioinput');

  // If labels are empty, request temporary mic permission to unlock them.
  // Firefox needs this to show monitor source labels. The track is stopped
  // immediately — we only need the side effect of unlocking labels.
  if (!audioInputs.some((d) => d.label.length > 0)) {
    console.info('[visualizer] No input labels — requesting mic permission to unlock');
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
      // Re-enumerate with labels now available
      devices = await navigator.mediaDevices.enumerateDevices();
      audioInputs = devices.filter((d) => d.kind === 'audioinput');
    } catch {
      console.warn('[visualizer] Mic permission denied — monitor detection skipped');
      return null;
    }
  }

  const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');

  // Debug: log all available devices
  console.info(
    '[visualizer] Audio outputs:\n' +
      audioOutputs.map((d) => `  ${d.deviceId.slice(0, 8)}… "${d.label}"`).join('\n'),
  );
  console.info(
    '[visualizer] Audio inputs:\n' +
      audioInputs.map((d) => `  ${d.deviceId.slice(0, 8)}… "${d.label}"`).join('\n'),
  );
  console.info('[visualizer] Looking for monitor of outputDeviceId:', outputDeviceId || '(not set)');

  // Strategy 0: PipeWire virtual source created by pw-loopback service.
  // Chromium doesn't expose PipeWire monitor sources in enumerateDevices(),
  // so a pw-loopback with a known name is the workaround.
  const huddleCapture = audioInputs.find((d) =>
    d.label.toLowerCase().includes('huddle') && d.label.toLowerCase().includes('capture'),
  );
  if (huddleCapture) {
    console.info('[visualizer] Strategy 0: Huddle virtual source →', huddleCapture.label);
    return huddleCapture.deviceId;
  }

  // Find the selected output device label
  let outputLabel = '';
  if (outputDeviceId) {
    const outputDevice = audioOutputs.find((d) => d.deviceId === outputDeviceId);
    if (outputDevice) {
      outputLabel = outputDevice.label;
      console.info('[visualizer] Matched output device label:', outputLabel);
    }
  }

  if (!outputLabel) {
    const defaultOutput = audioOutputs.find(
      (d) => d.deviceId === 'default' || d.label.toLowerCase().includes('default'),
    );
    if (defaultOutput) {
      outputLabel = defaultOutput.label;
      console.info('[visualizer] Falling back to default output:', outputLabel);
    }
  }

  // Strategy a: exact "Monitor of {label}" match (Firefox + PulseAudio)
  if (outputLabel) {
    const monitorPrefix = `Monitor of ${outputLabel}`;
    const exactMatch = audioInputs.find((d) => d.label.startsWith(monitorPrefix));
    if (exactMatch) {
      console.info('[visualizer] Strategy A: exact "Monitor of" match →', exactMatch.label);
      return exactMatch.deviceId;
    }
  }

  // Strategy b: contains "monitor" + output label substring
  if (outputLabel) {
    const outputLower = outputLabel.toLowerCase();
    const fullMatch = audioInputs.find((d) => {
      const dl = d.label.toLowerCase();
      return dl.includes('monitor') && dl.includes(outputLower);
    });
    if (fullMatch) {
      console.info('[visualizer] Strategy B: monitor + full label match →', fullMatch.label);
      return fullMatch.deviceId;
    }

    if (outputLabel.length >= 20) {
      const significantPart = outputLower.substring(0, 20);
      const partialMatch = audioInputs.find((d) => {
        const dl = d.label.toLowerCase();
        return dl.includes('monitor') && dl.includes(significantPart);
      });
      if (partialMatch) {
        console.info('[visualizer] Strategy B: monitor + partial label match →', partialMatch.label);
        return partialMatch.deviceId;
      }
    }
  }

  // Strategy c: Windows "Stereo Mix" or "What U Hear"
  const windowsMatch = audioInputs.find((d) => {
    const lower = d.label.toLowerCase();
    return lower.includes('stereo mix') || lower.includes('what u hear');
  });
  if (windowsMatch) {
    console.info('[visualizer] Strategy C: Windows loopback →', windowsMatch.label);
    return windowsMatch.deviceId;
  }

  // Strategy d: generic "loopback"
  const loopbackMatch = audioInputs.find((d) =>
    d.label.toLowerCase().includes('loopback'),
  );
  if (loopbackMatch) {
    console.info('[visualizer] Strategy D: generic loopback →', loopbackMatch.label);
    return loopbackMatch.deviceId;
  }

  // Strategy e: any monitor source — last resort
  const anyMonitor = audioInputs.find((d) =>
    d.label.toLowerCase().includes('monitor'),
  );
  if (anyMonitor) {
    console.info('[visualizer] Strategy E: any monitor source →', anyMonitor.label);
    return anyMonitor.deviceId;
  }

  console.warn('[visualizer] No monitor/loopback source found among', audioInputs.length, 'inputs');
  return null;
}

/**
 * Capture audio from a monitor/loopback device.
 * Spec: 95.3.1 step 5.
 */
export async function captureMonitorAudio(
  monitorDeviceId: string,
): Promise<MediaStream> {
  console.info('[visualizer] Capturing monitor audio, deviceId:', monitorDeviceId.slice(0, 12) + '…');
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: monitorDeviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

/**
 * Result of capturing call audio — includes the stream plus the AudioContext
 * used to build it. The caller MUST close the context in its cleanup path to
 * avoid leaking it across visualizer sessions (CGL-012 / F-CSD-198).
 */
export interface CallAudioCapture {
  stream: MediaStream;
  context: AudioContext;
}

/**
 * Capture call audio from the <audio> elements that track.attach() creates.
 * These are appended to document.body with id="lk-audio-{participantId}".
 * We merge all remote audio streams into a single MediaStream via AudioContext.
 *
 * Returns null if no call audio is available. When a capture is returned,
 * the caller owns the AudioContext and must close() it when done.
 */
export function captureCallAudio(): CallAudioCapture | null {
  const audioEls = document.querySelectorAll<HTMLAudioElement>('audio[id^="lk-audio-"]');
  if (audioEls.length === 0) return null;

  const ctx = new AudioContext();
  const merger = ctx.createChannelMerger(Math.max(audioEls.length, 2));

  let connected = 0;
  audioEls.forEach((el) => {
    try {
      const source = ctx.createMediaElementSource(el);
      source.connect(merger, 0, 0);
      // Also connect back to destination so the user still hears the call
      source.connect(ctx.destination);
      connected++;
    } catch (err) {
      // createMediaElementSource fails if element already has a source
      console.warn('[visualizer] Could not tap call audio element:', err);
    }
  });

  if (connected === 0) {
    ctx.close().catch(() => {});
    return null;
  }

  const dest = ctx.createMediaStreamDestination();
  merger.connect(dest);
  console.info('[visualizer] Captured call audio from', connected, 'participants');
  return { stream: dest.stream, context: ctx };
}

