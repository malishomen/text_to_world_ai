'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mic, MicOff, Sparkles, Moon, Stars } from 'lucide-react';
import { DEMO_PRESETS, type DemoPreset } from '@/lib/demo-presets';

export default function Home() {
  const [dreamText, setDreamText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; size: number; delay: number }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const router = useRouter();

  useEffect(() => {
    // SSR-safe: random visual jitter is generated client-side only to avoid
    // hydration mismatch. setState-in-effect is the canonical Next.js App
    // Router pattern for browser-only initial state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParticles(
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        delay: Math.random() * 5,
      })),
    );
  }, []);

  const startRecording = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser. Please type your dream.');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setDreamText(transcript);
    };

    recognition.onend = () => setIsRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const handleSubmit = async () => {
    if (!dreamText.trim()) return;
    setIsSubmitting(true);
    localStorage.removeItem('gameConfig');
    localStorage.removeItem('gameAssets');
    localStorage.removeItem('generationId');
    localStorage.setItem('dreamText', dreamText);
    router.push('/loading-dream');
  };

  const handlePresetClick = (preset: DemoPreset) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    localStorage.removeItem('gameAssets');
    localStorage.setItem('dreamText', preset.dream);
    localStorage.setItem('gameConfig', JSON.stringify(preset.config));
    localStorage.setItem('generationId', preset.generationId);
    router.push('/play'); // SKIP /loading-dream entirely
  };

  const exampleDreams = [
    "I was flying over a crystal city at night, chased by shadows made of starlight...",
    "A forest where trees whispered secrets and mushrooms glowed like lanterns...",
    "I fought a dragon on a floating island, but the dragon was made of memories...",
  ];

  return (
    <main className="min-h-screen bg-[#0a0015] flex flex-col items-center justify-center relative overflow-hidden px-4">
      {/* Animated background particles */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full bg-purple-400 opacity-40 animate-pulse"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${3 + p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-700/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-800/10 rounded-full blur-3xl" />

      <div className="relative z-10 w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Moon className="text-purple-300" size={32} />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-300 via-violet-200 to-indigo-300 bg-clip-text text-transparent">
              DreamCraft
            </h1>
            <Stars className="text-indigo-300" size={32} />
          </div>
          <p className="text-purple-200/70 text-lg">
            Tell your dream. Play it in 60 seconds.
          </p>
        </div>

        {/* Instant-demo preset cards — skip the LLM, jump straight to /play */}
        <section className="mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles size={16} className="text-purple-400" />
            <h2 className="text-purple-300/80 text-sm font-medium uppercase tracking-wider">Try a sample dream</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {DEMO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetClick(preset)}
                disabled={isSubmitting}
                aria-label={`Play sample dream: ${preset.label}`}
                className="group relative text-left rounded-2xl border border-purple-500/20 p-4 transition-all hover:scale-[1.02] hover:border-purple-400/50 hover:shadow-lg hover:shadow-purple-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${preset.config.color_palette[0]}1f, ${preset.config.color_palette[2] ?? preset.config.color_palette[0]}33)`,
                }}
              >
                <span className="absolute top-2 right-3 text-[10px] uppercase tracking-wider text-purple-200/70 bg-purple-900/40 px-2 py-0.5 rounded-full border border-purple-500/30">
                  {preset.badge.replace(/_/g, ' ')}
                </span>
                <h3 className="text-purple-100 font-semibold text-base mb-1 mt-1">{preset.label}</h3>
                <p className="text-purple-200/60 text-xs italic leading-relaxed">&ldquo;{preset.teaser}&rdquo;</p>
              </button>
            ))}
          </div>
        </section>

        {/* Input card */}
        <div className="bg-white/5 backdrop-blur-xl border border-purple-500/20 rounded-3xl p-8 shadow-2xl shadow-purple-900/30">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-purple-400" />
            <span className="text-purple-300 text-sm font-medium">Describe your dream</span>
          </div>

          <textarea
            value={dreamText}
            onChange={(e) => setDreamText(e.target.value)}
            placeholder="I was walking through a neon forest where the trees were made of glass, and a giant moon hung so close I could touch it..."
            aria-label="Describe your dream"
            className="w-full h-40 bg-transparent text-purple-100 placeholder-purple-400/40 text-base resize-none outline-none border border-purple-500/20 rounded-2xl p-4 focus:border-purple-400/50 transition-colors"
          />

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording'}
              className={`flex items-center gap-2 px-5 py-3 rounded-2xl font-medium transition-all duration-300 ${
                isRecording
                  ? 'bg-red-500/20 border border-red-400/50 text-red-300 animate-pulse'
                  : 'bg-purple-600/20 border border-purple-500/40 text-purple-300 hover:bg-purple-600/30'
              }`}
            >
              {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
              {isRecording ? 'Stop' : 'Speak'}
            </button>

            <button
              onClick={handleSubmit}
              disabled={!dreamText.trim() || isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-2xl font-semibold text-white transition-all duration-300 shadow-lg shadow-purple-900/40"
            >
              <Sparkles size={18} />
              {isSubmitting ? 'Entering the dream...' : 'Craft My Game'}
            </button>
          </div>
        </div>

        {/* Example prompts */}
        <div className="mt-6">
          <p className="text-purple-400/50 text-xs text-center mb-3">Need inspiration?</p>
          <div className="flex flex-col gap-2">
            {exampleDreams.map((dream, i) => (
              <button
                key={i}
                onClick={() => setDreamText(dream)}
                className="text-left text-purple-300/50 text-sm px-4 py-2 rounded-xl hover:bg-purple-900/20 hover:text-purple-300/80 transition-all border border-transparent hover:border-purple-700/30 truncate"
              >
                &ldquo;{dream}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
