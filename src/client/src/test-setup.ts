import '@testing-library/jest-dom/vitest';

// Polyfill MediaStream for jsdom
if (typeof globalThis.MediaStream === 'undefined') {
  (globalThis as any).MediaStream = class MockMediaStream {
    private _tracks: any[] = [];
    constructor(tracks?: any[]) {
      if (tracks) this._tracks = [...tracks];
    }
    getAudioTracks() {
      return this._tracks.filter((t: any) => !t.kind || t.kind === 'audio');
    }
    getVideoTracks() {
      return this._tracks.filter((t: any) => t.kind === 'video');
    }
    getTracks() { return this._tracks; }
    addTrack(track: any) { this._tracks.push(track); }
  };
}

// Polyfill AudioContext for jsdom
if (typeof globalThis.AudioContext === 'undefined') {
  const mockProcessedTrack = { id: 'processed', kind: 'audio', stop: () => {} };
  (globalThis as any).AudioContext = class MockAudioContext {
    createMediaStreamSource() {
      return { connect: () => {}, disconnect: () => {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
        connect: () => {},
        disconnect: () => {},
      };
    }
    createMediaStreamDestination() {
      return {
        stream: new MediaStream([mockProcessedTrack as any]),
      };
    }
    close() {}
  };
}
