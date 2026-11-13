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
let geraetArt = '';

async function geraetWaehlen() {
  try {
    if (self.navigator && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return { device: 'webgpu', dtype: adapter.features.has('shader-f16') ? 'q4f16' : 'q4' };
      }
    }
  } catch (e) { /* kein WebGPU */ }
  return { device: 'wasm', dtype: 'q4' };
}

function bereitmachen() {
  if (laden) return laden;
  laden = (async () => {
    const wahl = await geraetWaehlen();
    geraetArt = wahl.device;
    const stand = {};
    erkenner = await pipeline('automatic-speech-recognition', MODELL, {
      device: wahl.device,
      dtype: { encoder_model: wahl.dtype, decoder_model_merged: wahl.dtype },
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        stand[p.file] = [p.loaded, p.total];
        let geladen = 0, gesamt = 0;
        for (const [l, g] of Object.values(stand)) { geladen += l; gesamt += g; }
        self.postMessage({ typ: 'fortschritt', geladen, gesamt });
      }
    });
    self.postMessage({ typ: 'bereit', geraet: geraetArt, dtype: wahl.dtype });
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
      await bereitmachen();
    } else if (auftrag.typ === 'umwandeln') {
      await bereitmachen();
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
