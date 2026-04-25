/**
 * Ambient type declarations for butterchurn and butterchurn-presets.
 *
 * Neither package ships TypeScript declarations. These are minimal
 * declarations covering the API surface used by the visualizer.
 */

declare module 'butterchurn' {
  interface VisualizerInstance {
    connectAudio(sourceNode: AudioNode): void;
    loadPreset(preset: object, blendTime: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }

  interface VisualizerOptions {
    width: number;
    height: number;
    meshWidth?: number;
    meshHeight?: number;
    pixelRatio?: number;
  }

  interface Butterchurn {
    createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options: VisualizerOptions,
    ): VisualizerInstance;
  }

  const butterchurn: Butterchurn;
  export default butterchurn;
}

declare module 'butterchurn/lib/isSupported.min' {
  function isSupported(): boolean;
  export default isSupported;
}

declare module 'butterchurn/dist/isSupported.min' {
  function isSupported(): boolean;
  export default isSupported;
}

declare module 'butterchurn-presets' {
  const presets: Record<string, object>;
  export default presets;
}

declare module 'butterchurn-presets/minimal' {
  const presets: Record<string, object>;
  export default presets;
}

declare module 'butterchurn-presets/lib/butterchurnPresetsMinimal.min' {
  const presets: Record<string, object>;
  export default presets;
}

declare module 'butterchurn-presets/dist/minimal.min' {
  const presets: Record<string, object>;
  export default presets;
}
