let context: AudioContext | null = null;
export function playCue(kind: "select" | "lock" | "reveal" | "finish") {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const frequencies = kind === "finish" ? [220, 330, 440] : kind === "reveal" ? [110, 165, 330] : kind === "lock" ? [85, 60] : [480];
    frequencies.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const start = context!.currentTime + index * .08;
      oscillator.type = kind === "select" ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.055, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + .22);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + .24);
    });
  } catch { /* Audio is optional; visual feedback remains authoritative. */ }
}
