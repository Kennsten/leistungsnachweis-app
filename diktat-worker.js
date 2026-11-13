// Diktat: Spracherkennung auf dem Gerät (Hintergrund-Helfer)
// Das Sprachmodell wird einmalig von Hugging Face geladen und im Browser gespeichert.
// Aufnahmen und Texte verlassen das Gerät nie.
import { pipeline, env } from './lib/diktat/transformers.min.js';

const MODELL = 'onnx-community/whisper-large-v3-turbo-german-ONNX';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Rechenkern von der eigenen App-Adresse, nicht von einem fremden Server
env.backends.onnx.wasm.wasmPaths = new URL('./lib/diktat/', self.location.href).href;

let erkenner = null;
let laden = null;

async function grafik() {
  try {
    if (self.navigator && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return { f16: adapter.features.has('shader-f16') };
    }
  } catch (e) { /* keine Grafik-Beschleunigung */ }
  return null;
}

// Drei Stufen: „gpu“ (alles Grafik), „gemischt“ (großer Teil Prozessor, kleiner Teil Grafik),
// „cpu“ (alles Prozessor). Manche Geräte (z. B. iPad) erlauben der Grafik nicht genug Speicher.
async function einstellungen(modus) {
  const g = await grafik();
  if (!g) modus = 'cpu';
  const q = g && g.f16 ? 'q4f16' : 'q4';
  if (modus === 'gpu') return { modus, device: 'webgpu', dtype: { encoder_model: q, decoder_model_merged: q } };
  if (modus === 'gemischt') {
    return {
      modus,
      device: { encoder_model: 'wasm', decoder_model_merged: 'webgpu' },
      dtype: { encoder_model: 'q4', decoder_model_merged: q }
    };
  }
  return { modus: 'cpu', device: 'wasm', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } };
}

function bereitmachen(modus) {
  if (laden) return laden;
  laden = (async () => {
    const wahl = await einstellungen(modus || 'gpu');
    const stand = {};
    erkenner = await pipeline('automatic-speech-recognition', MODELL, {
      device: wahl.device,
      dtype: wahl.dtype,
      // Kein wachsender Vorrats-Speicher: sonst stürzt Safari auf dem iPad beim zweiten Satz ab
      session_options: { enableCpuMemArena: false, enableMemPattern: false },
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        stand[p.file] = [p.loaded, p.total];
        let geladen = 0, gesamt = 0;
        for (const [l, g] of Object.values(stand)) { geladen += l; gesamt += g; }
        self.postMessage({ typ: 'fortschritt', geladen, gesamt });
      }
    });
    self.postMessage({ typ: 'bereit', modus: wahl.modus });
  })().catch((e) => {
    laden = null;
    throw e;
  });
  return laden;
}

self.onmessage = async (e) => {
  const auftrag = e.data || {};
  try {
    if (auftrag.typ === 'laden') {
      await bereitmachen(auftrag.modus);
    } else if (auftrag.typ === 'umwandeln') {
      await bereitmachen(auftrag.modus);
      const ergebnis = await erkenner(auftrag.audio, {
        language: 'german',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      const text = (Array.isArray(ergebnis) ? ergebnis.map((r) => r.text).join(' ') : ergebnis.text) || '';
      self.postMessage({ typ: 'text', id: auftrag.id, text: text.trim() });
    }
  } catch (fehler) {
    self.postMessage({ typ: 'fehler', id: auftrag.id, meldung: String((fehler && fehler.message) || fehler) });
  }
};
