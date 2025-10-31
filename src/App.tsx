import React, { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type Season = "bassa" | "alta";

type Inputs = {
  destinazione: string;
  durataGiorni: number;
  stagione: Season;
  motoN: number;
  dataPrenotazione: string;
  dataPartenza: string;
  cTrasporto: number;
  cAlloggio: number;
  cGuide: number;
  cAltri: number;
  margineTarget: number;
};

type Result = {
  prezzoBasePP: number;
  prezzoConsPP: number;
  ricaviTotali: number;
  margineAss: number;
  marginePerc: number;
};

type HistoryItem = {
  id: string;
  title: string;
  timestamp: number;
  inputs: Inputs;
  result: Result;
};

const STORAGE_KEY = "libermoto_history_v1";

export default function App() {
  const DEFAULTS = {
    agency: "Libermoto",
    currency: "EUR",
    marginTarget: 0.25,
    seasonFactor: { bassa: 1.0, alta: 1.3 },
    leadTimeRules: [
      { maxDays: 14, factor: 1.1 },
      { maxDays: 30, factor: 1.05 },
      { maxDays: 90, factor: 1.0 },
      { maxDays: 9999, factor: 0.97 },
    ],
    groupRules: [
      { max: 6, factor: 1.1 },
      { max: 12, factor: 1.0 },
      { max: 9999, factor: 0.95 },
    ],
  } as const;

  const [inputs, setInputs] = useState<Inputs>({
    destinazione: "",
    durataGiorni: 7,
    stagione: "alta",
    motoN: 12,
    dataPrenotazione: "",
    dataPartenza: "",
    cTrasporto: 0,
    cAlloggio: 0,
    cGuide: 0,
    cAltri: 0,
    margineTarget: DEFAULTS.marginTarget,
  });

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setHistory(JSON.parse(raw)); } catch {}
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: DEFAULTS.currency }).format(
      isFinite(n) ? n : 0
    );
  const diffInDays = (d1: string, d2: string): number | null => {
    if (!d1 || !d2) return null;
    const t1 = new Date(d1);
    const t2 = new Date(d2);
    if (isNaN(t1.getTime()) || isNaN(t2.getTime())) return null;
    const diffMs = t2.getTime() - t1.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  };
  const pickFactorByLeadTime = (lt: number | null) => {
    if (lt === null) return 1;
    for (const rule of DEFAULTS.leadTimeRules) {
      if (lt <= rule.maxDays) return rule.factor;
    }
    return 1;
  };
  const pickFactorByGroup = (n: number) => {
    const x = Math.max(0, n);
    for (const r of DEFAULTS.groupRules) {
      if (x <= r.max) return r.factor;
    }
    return 1;
  };

  const leadTime = useMemo(() => diffInDays(inputs.dataPrenotazione, inputs.dataPartenza), [inputs.dataPrenotazione, inputs.dataPartenza]);
  const costsTotal = useMemo(() => inputs.cTrasporto + inputs.cAlloggio + inputs.cGuide + inputs.cAltri, [inputs.cTrasporto, inputs.cAlloggio, inputs.cGuide, inputs.cAltri]);
  const fStagione = DEFAULTS.seasonFactor[inputs.stagione];
  const fLead = pickFactorByLeadTime(leadTime ?? 0);
  const fGroup = pickFactorByGroup(inputs.motoN);

  const prezzoBasePP = useMemo(() => {
    const m = inputs.motoN;
    if (m <= 0) return 0;
    return (costsTotal * (1 + inputs.margineTarget)) / m;
  }, [costsTotal, inputs.margineTarget, inputs.motoN]);

  const prezzoConsPP = useMemo(() => prezzoBasePP * fStagione * fLead * fGroup, [prezzoBasePP, fStagione, fLead, fGroup]);
  const ricaviTotali = useMemo(() => inputs.motoN * prezzoConsPP, [inputs.motoN, prezzoConsPP]);
  const margineAss = useMemo(() => ricaviTotali - costsTotal, [ricaviTotali, costsTotal]);
  const marginePerc = useMemo(() => (ricaviTotali > 0 ? margineAss / ricaviTotali : 0), [margineAss, ricaviTotali]);

  const saveToHistory = () => {
    const title = inputs.destinazione?.trim() || `Viaggio ${new Date().toLocaleDateString("it-IT")} (${inputs.motoN} moto)`;
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      title,
      timestamp: Date.now(),
      inputs: { ...inputs },
      result: { prezzoBasePP, prezzoConsPP, ricaviTotali, margineAss, marginePerc },
    };
    setHistory((h) => [item, ...h]);
  };
  const loadFromHistory = (id: string) => {
    const it = history.find((x) => x.id === id);
    if (it) setInputs({ ...it.inputs });
  };
  const deleteFromHistory = (id: string) => setHistory((h) => h.filter((x) => x.id !== id));
  const clearHistory = () => { if (confirm("Cancellare tutta la cronologia?")) setHistory([]); };

  const reportRef = useRef<HTMLDivElement>(null);
  const exportPDF = async () => {
    const el = reportRef.current;
    if (!el) return;
    const canvas = await html2canvas(el, { scale: 2 });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const imgW = canvas.width * ratio;
    const imgH = canvas.height * ratio;
    const x = (pageWidth - imgW) / 2;
    const y = 24;
    pdf.text(`Libermoto – Report ${new Date().toLocaleString("it-IT")}`, 24, 16);
    pdf.addImage(imgData, "PNG", x, y, imgW, imgH);
    pdf.save(`libermoto_${inputs.destinazione || "viaggio"}.pdf`);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-emerald-50 to-white">
      <div className="bg-gradient-to-r from-emerald-700 to-lime-600 text-white">
        <div className="max-w-7xl mx-auto flex items-center gap-4 p-4">
          <img src="/libermoto-logo.jpg" alt="Libermoto logo" className="w-12 h-12 rounded-xl object-cover ring-2 ring-white/20" />
          <div className="flex-1">
            <h1 className="text-xl md:text-2xl font-semibold tracking-wide">Libermoto • Pricing &amp; Margini</h1>
            <p className="text-white/80 text-xs md:text-sm">The best motorbike travel experience</p>
          </div>
          <button onClick={saveToHistory} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm">Salva in cronologia</button>
          <button onClick={exportPDF} className="ml-2 px-3 py-2 rounded-xl bg-white text-emerald-800 hover:bg-emerald-50 text-sm">Esporta PDF</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <section className="bg-white rounded-2xl shadow border border-emerald-100">
            <div className="p-5 border-b rounded-t-2xl bg-emerald-50/60">
              <h2 className="text-lg font-semibold text-emerald-900">Dati viaggio</h2>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Destinazione">
                  <input className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.destinazione} onChange={(e) => setInputs({ ...inputs, destinazione: e.target.value })} placeholder="Es. Puglia Tour" />
                </Field>
                <Field label="Durata (giorni)">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.durataGiorni} min={1} onChange={(e) => setInputs({ ...inputs, durataGiorni: Number(e.target.value) })} />
                </Field>
                <Field label="Stagione">
                  <select className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.stagione} onChange={(e) => setInputs({ ...inputs, stagione: e.target.value as Season })}>
                    <option value="bassa">Bassa (×{DEFAULTS.seasonFactor.bassa})</option>
                    <option value="alta">Alta (×{DEFAULTS.seasonFactor.alta})</option>
                  </select>
                </Field>
                <Field label="# Moto (max 12)">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.motoN} min={1} max={12} onChange={(e) => setInputs({ ...inputs, motoN: Number(e.target.value) })} />
                </Field>
                <Field label="Data prenotazione">
                  <input type="date" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.dataPrenotazione} onChange={(e) => setInputs({ ...inputs, dataPrenotazione: e.target.value })} />
                </Field>
                <Field label="Data partenza">
                  <input type="date" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.dataPartenza} onChange={(e) => setInputs({ ...inputs, dataPartenza: e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                <Field label="Costi trasporto">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.cTrasporto} min={0} onChange={(e) => setInputs({ ...inputs, cTrasporto: Number(e.target.value) })} />
                </Field>
                <Field label="Costi alloggio">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.cAlloggio} min={0} onChange={(e) => setInputs({ ...inputs, cAlloggio: Number(e.target.value) })} />
                </Field>
                <Field label="Costi guide">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.cGuide} min={0} onChange={(e) => setInputs({ ...inputs, cGuide: Number(e.target.value) })} />
                </Field>
                <Field label="Altri costi">
                  <input type="number" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.cAltri} min={0} onChange={(e) => setInputs({ ...inputs, cAltri: Number(e.target.value) })} />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                <Field label="Margine target">
                  <input type="number" step="0.01" className="w-full mt-1 rounded-xl border p-2 focus:outline-none focus:ring-2 focus:ring-emerald-400" value={inputs.margineTarget} min={0} max={2} onChange={(e) => setInputs({ ...inputs, margineTarget: Number(e.target.value) })} />
                  <p className="text-xs text-emerald-700/80 mt-1">Decimale (es. 0.25 = 25%)</p>
                </Field>
                <Field label="Lead‑time (calcolato)">
                  <input className="w-full mt-1 rounded-xl border p-2 bg-gray-50" value={leadTime ?? ""} readOnly />
                  <p className="text-xs text-emerald-700/80 mt-1">Giorni tra prenotazione e partenza</p>
                </Field>
                <Field label="Fattore gruppo">
                  <input className="w-full mt-1 rounded-xl border p-2 bg-gray-50" value={pickFactorByGroup(inputs.motoN).toFixed(2)} readOnly />
                </Field>
                <Field label="Fattore lead‑time">
                  <input className="w-full mt-1 rounded-xl border p-2 bg-gray-50" value={pickFactorByLeadTime(leadTime ?? 0).toFixed(2)} readOnly />
                </Field>
              </div>
            </div>
          </section>

          <section ref={reportRef} className="bg-white rounded-2xl shadow border border-emerald-100">
            <div className="p-5 border-b rounded-t-2xl bg-emerald-50/60">
              <h2 className="text-lg font-semibold text-emerald-900">Risultati</h2>
              <p className="text-sm text-emerald-700/80">{inputs.destinazione || "Viaggio"} • {inputs.motoN} moto • {inputs.stagione}</p>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPI label="Costi totali" value={fmtMoney(costsTotal)} />
              <KPI label="Prezzo base / persona" value={fmtMoney(prezzoBasePP)} />
              <KPI label="Prezzo consigliato / persona" value={fmtMoney(prezzoConsPP)} />
              <KPI label="Ricavi totali stimati" value={fmtMoney(ricaviTotali)} />
              <KPI label="Margine assoluto stimato" value={fmtMoney(margineAss)} />
              <KPI label="Margine % stimata" value={(marginePerc * 100).toFixed(1) + "%"} />
            </div>
          </section>
        </div>

        <aside className="lg:col-span-4">
          <div className="bg-white rounded-2xl shadow border border-emerald-100 overflow-hidden">
            <div className="p-4 bg-emerald-50/60 border-b flex items-center gap-2">
              <h3 className="font-semibold text-emerald-900 flex-1">Cronologia</h3>
              <input placeholder="Cerca…" value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-lg border p-1.5 text-sm" />
              <button onClick={clearHistory} className="ml-2 text-sm px-2 py-1 rounded-lg border hover:bg-emerald-50">Svuota</button>
            </div>
            <ul className="max-h-[560px] overflow-auto divide-y">
              {history.filter((h) => h.title.toLowerCase().includes(filter.toLowerCase())).map((h) => (
                <li key={h.id} className="p-3 hover:bg-emerald-50/40">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-emerald-900">{h.title}</div>
                      <div className="text-xs text-emerald-700/80">{new Date(h.timestamp).toLocaleString("it-IT")}</div>
                      <div className="text-xs text-gray-500">{h.inputs.motoN} moto • {h.inputs.stagione} • {fmtMoney(h.result.prezzoConsPP)} /pp</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => loadFromHistory(h.id)} className="px-2 py-1 rounded-lg border text-sm hover:bg-emerald-50">Carica</button>
                      <button onClick={() => deleteFromHistory(h.id)} className="px-2 py-1 rounded-lg border text-sm hover:bg-red-50 text-red-600 border-red-200">Elimina</button>
                    </div>
                  </div>
                </li>
              ))}
              {history.length === 0 && <li className="p-4 text-sm text-gray-500">Nessuna voce ancora. Premi “Salva in cronologia”.</li>}
            </ul>
          </div>
        </aside>
      </div>

      <footer className="text-xs text-emerald-800/80 px-6 pb-6 max-w-7xl mx-auto">
        <p>Formula: Prezzo consigliato / persona = (CostiTotali × (1 + MargineTarget) ÷ N_Moto) × Fstagione × FleetTime × Fgruppo</p>
        <p>© {new Date().getFullYear()} Libermoto</p>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm text-emerald-900">{label}</label>
      {children}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border p-4 bg-white shadow-sm hover:shadow transition">
      <div className="text-xs text-emerald-700/80">{label}</div>
      <div className="text-lg font-semibold mt-1 text-emerald-900">{value}</div>
    </div>
  );
}
