/**
 * useMediaSettings — localStorage wrapper for audio/video device preferences.
 *
 * Spec: 70.9
 * All device preferences are stored in localStorage. This hook prevents
 * scattered localStorage.getItem calls across components.
 */

import { useState, useCallback } from 'react';

export interface MediaSettings {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  audioInputGain: number;
  audioOutputVolume: number;
  audioNoiseSuppression: boolean;
  videoCameraDeviceId: string;
  videoMirrorSelfView: boolean;
  videoBackgroundBlur: boolean;
}

// Map from MediaSettings keys to localStorage keys
const STORAGE_KEYS: Record<keyof MediaSettings, string> = {
  audioInputDeviceId: 'audio.inputDeviceId',
  audioOutputDeviceId: 'audio.outputDeviceId',
  audioInputGain: 'audio.inputGain',
  audioOutputVolume: 'audio.outputVolume',
  audioNoiseSuppression: 'audio.noiseSuppression',
  videoCameraDeviceId: 'video.cameraDeviceId',
  videoMirrorSelfView: 'video.mirrorSelfView',
  videoBackgroundBlur: 'video.backgroundBlur',
};

const DEFAULTS: MediaSettings = {
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  audioInputGain: 100,
  audioOutputVolume: 100,
  audioNoiseSuppression: true,
  videoCameraDeviceId: '',
  videoMirrorSelfView: true,
  videoBackgroundBlur: false,
};

function readFromStorage(): MediaSettings {
  const settings = { ...DEFAULTS };

  for (const [key, storageKey] of Object.entries(STORAGE_KEYS)) {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) continue;

    const settingKey = key as keyof MediaSettings;
    const defaultVal = DEFAULTS[settingKey];

    if (typeof defaultVal === 'number') {
      const num = Number(raw);
      if (!Number.isNaN(num)) {
        (settings as Record<string, unknown>)[settingKey] = num;
      }
    } else if (typeof defaultVal === 'boolean') {
      (settings as Record<string, unknown>)[settingKey] = raw === 'true';
    } else {
      (settings as Record<string, unknown>)[settingKey] = raw;
    }
  }

  return settings;
}

export function useMediaSettings(): MediaSettings & {
  update: (key: keyof MediaSettings, value: string | number | boolean) => void;
} {
  const [settings, setSettings] = useState<MediaSettings>(readFromStorage);

  const update = useCallback(
    (key: keyof MediaSettings, value: string | number | boolean) => {
      const storageKey = STORAGE_KEYS[key];
      localStorage.setItem(storageKey, String(value));
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  return { ...settings, update };
}

/**
 * Read media settings directly from localStorage without React state.
 * Used in CallProvider (joinCall) where we don't need reactivity.
 */
export function getMediaSettings(): MediaSettings {
  return readFromStorage();
}
