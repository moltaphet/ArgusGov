"use client";

import { BrainCircuit, CircuitBoard, Coins, Radar } from "lucide-react";
import { TEST_COUNTS } from "@/lib/project";
import { useEffect, useState, type ReactNode } from "react";

interface Stage {
  step: string;
  label: string;
  title: string;
  body: string;
  facts: string[];
  icon: ReactNode;
  /** Tailwind classes per tint, written out in full so they survive purging. */
  num: string;
  node: string;
  ring: string;
  glow: string;
}

const STAGES: Stage[] = [
  {
    step: "01", label: "Proposal Ingestion", title: "Proposal Ingestion & Payload Binding", icon: <Radar size={18} />,
    body: "A DAO's guardian, or its timelock, commits what each proposal will execute: targets, native values, calldata and the forum link, fingerprinted with the keccak256 layout Governor contracts use. A challenger then flags it by id alone and posts a bond, so no one else can put forged calldata under a real proposal.",
    facts: ["keccak256 commitment", "Flag by id, never by payload"],
    num: "from-indigo-200 to-indigo-500", node: "bg-indigo-300", ring: "border-indigo-300/50", glow: "shadow-[0_0_34px_-6px_rgba(129,140,248,0.55)]",
  },
  {
    step: "02", label: "GenVM Consensus", title: "GenVM Multi-Validator Consensus", icon: <BrainCircuit size={18} />,
    body: "Each validator independently reads the forum thread, decodes function selectors, arguments and native values in deterministic code, and has its LLM score the gap between declared intent and calldata. Validators agree only when scores land on the same side of 75 and within 20 points.",
    facts: ["Deterministic decoding", "Leader + validator re-run"],
    num: "from-cyan-200 to-sky-500", node: "bg-cyan-300", ring: "border-cyan-300/50", glow: "shadow-[0_0_34px_-6px_rgba(34,211,238,0.5)]",
  },
  {
    step: "03", label: "Circuit Breaker", title: "Autonomous Circuit Breaker", icon: <CircuitBoard size={18} />,
    body: "A score of 75 or more marks the proposal FLAGGED_MALICIOUS and raises its on-chain freeze flag. A DAO's execution guard calls is_execution_frozen with the hash of the proposal it is about to run, and the freeze applies only if that hash equals the committed one. An appeal moves the record to CHALLENGED_PAUSED while a fresh consensus round re-evaluates it.",
    facts: ["Threshold: score >= 75", "Freeze stays during appeal"],
    num: "from-rose-200 to-rose-500", node: "bg-rose-400", ring: "border-rose-400/50", glow: "shadow-[0_0_34px_-6px_rgba(244,63,94,0.55)]",
  },
  {
    step: "04", label: "Bond Settlement", title: "Bonded Anti-Griefing Game Theory", icon: <Coins size={18} />,
    body: "Challengers post a 2.0 GEN bond. A confirmed threat returns the bond plus a bounty of 10% of the DAO's security pool after the appeal window. A false alarm is slashed, half to the DAO and half burned, and the challenger is locked out for four hours.",
    facts: ["50% DAO / 50% burn", "4h lockout on false alarms"],
    num: "from-emerald-200 to-emerald-500", node: "bg-emerald-300", ring: "border-emerald-300/50", glow: "shadow-[0_0_34px_-6px_rgba(52,211,153,0.5)]",
  },
];

const INVARIANTS = [
  ["Conservation", "Contract balance always equals pool + escrow + claimable + burn vault."],
  ["Exact bonds", "Challenge and appeal bonds must match exactly; no change accrues."],
  ["Committed payloads", "Only the guardian or timelock can commit a payload, once; a flag never carries one."],
  ["One settlement", "Every lifecycle step is legal from exactly one state."],
  ["Vesting first", "Rewards are claimable only after the appeal window closes."],
  ["Reserved bounties", "A bounty is set aside when a flag is raised, so the pool cannot be drained from under a challenger."],
];

export function AboutSection() {
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);

  // The pipeline advances on its own until a visitor hovers or focuses a stage.
  useEffect(() => {
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (engaged || reducedMotion) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STAGES.length), 3200);
    return () => clearInterval(id);
  }, [engaged]);

  return (
    <section id="how-it-works" className="scroll-mt-6 pt-20" aria-labelledby="about-heading">
      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">Architecture flow</span>
        <h2 id="about-heading" className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">Autonomous Consensus Guard</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">How ArgusGov halts malicious governance executions in real-time.</p>
      </div>

      {/* Stage rail: a compact map of the flow, mirrored by the cards below. */}
      <ol className="mx-auto mt-10 hidden max-w-4xl items-center xl:flex" aria-label="Pipeline stages">
        {STAGES.map((s, i) => (
          <li key={s.step} className="flex flex-1 items-center last:flex-none">
            <button type="button" onClick={() => { setEngaged(true); setActive(i); }} aria-current={active === i ? "step" : undefined}
              className={`flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-300 ${active === i ? `border-white/20 bg-white/[0.08] text-zinc-100 ${s.glow}` : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"}`}>
              <span className="relative flex h-2 w-2">
                {active === i && <span className={`absolute inline-flex h-full w-full animate-pulseRing rounded-full ${s.node}`} />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${active >= i ? s.node : "bg-zinc-700"}`} />
              </span>
              {s.label}
            </button>
            {i < STAGES.length - 1 && (
              <span aria-hidden className="relative mx-2 h-px flex-1 bg-white/[0.08]">
                <span className={`absolute inset-0 transition-opacity duration-500 ${active > i ? "opacity-100" : "opacity-0"}`}>
                  <span className="flow-x absolute inset-0 animate-flowX" />
                </span>
                <span className="absolute -right-0.5 -top-[3px] h-0 w-0 border-y-4 border-l-[6px] border-y-transparent border-l-white/30" />
              </span>
            )}
          </li>
        ))}
      </ol>

      <ol className="mt-8 grid gap-6 xl:grid-cols-4 xl:gap-10">
        {STAGES.map((s, i) => {
          const on = active === i;
          return (
            <li key={s.step} className="relative">
              <div tabIndex={0}
                onMouseEnter={() => { setEngaged(true); setActive(i); }} onMouseLeave={() => setEngaged(false)}
                onFocus={() => { setEngaged(true); setActive(i); }} onBlur={() => setEngaged(false)}
                className={`surface group relative flex h-full flex-col overflow-hidden p-6 outline-none transition-all duration-300 hover:border-zinc-500/50 hover:bg-zinc-800/40 focus-visible:ring-2 focus-visible:ring-indigo-400/60 ${on ? `!border-white/20 ${s.glow}` : ""}`}>
                <div aria-hidden className={`pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full blur-3xl transition-opacity duration-500 ${s.node} ${on ? "opacity-[0.16]" : "opacity-[0.05]"}`} />
                <div className="relative flex items-start justify-between">
                  <span className={`bg-gradient-to-b bg-clip-text font-mono text-4xl font-bold leading-none tracking-tighter text-transparent ${s.num}`}
                    style={{ filter: on ? "drop-shadow(0 0 14px currentColor)" : undefined }}>
                    {s.step}
                  </span>
                  <span className={`relative grid h-10 w-10 place-items-center rounded-xl border bg-white/[0.04] text-zinc-100 transition-all duration-300 ${on ? s.ring : "border-white/[0.08]"}`}>
                    {s.icon}
                    {on && <span aria-hidden className={`absolute inset-0 animate-radar rounded-xl border ${s.ring}`} />}
                  </span>
                </div>
                <h3 className="relative mt-5 text-[15px] font-semibold leading-snug text-zinc-100">{s.title}</h3>
                <p className="relative mt-2 flex-1 text-[13px] leading-relaxed text-zinc-400">{s.body}</p>
                <ul className="relative mt-4 flex flex-wrap gap-1.5">
                  {s.facts.map((f) => <li key={f} className="badge badge-mute font-mono">{f}</li>)}
                </ul>
              </div>

              {/* Connector to the next stage: horizontal on wide screens, vertical when stacked. */}
              {i < STAGES.length - 1 && (
                <>
                  <span aria-hidden className="pointer-events-none absolute left-full top-[38px] hidden h-px w-10 xl:block">
                    <span className="absolute inset-0 bg-white/[0.09]" />
                    <span className={`absolute inset-0 transition-opacity duration-500 ${active > i ? "opacity-100" : "opacity-30"}`}><span className="flow-x absolute inset-0 animate-flowX" /></span>
                    <span className={`absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full ${STAGES[i].node} ${active === i ? "animate-pulse" : "opacity-60"}`} />
                    <span className={`absolute -right-1 -top-[3px] h-[7px] w-[7px] rounded-full ${STAGES[i + 1].node} ${active === i + 1 ? "animate-pulse" : "opacity-60"}`} />
                  </span>
                  <span aria-hidden className="pointer-events-none absolute left-1/2 top-full block h-6 w-px -translate-x-1/2 xl:hidden">
                    <span className="absolute inset-0 bg-white/[0.09]" />
                    <span className="flow-y absolute inset-0 animate-flowY" />
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>

      <div id="invariants" className="surface mt-8 scroll-mt-6 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">Protocol invariants</h3>
          <span className="font-mono text-[11px] text-zinc-500">enforced in contract, checked by {TEST_COUNTS.contract} tests</span>
        </div>
        <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {INVARIANTS.map(([name, text]) => (
            <div key={name} className="border-l border-emerald-400/30 pl-3.5">
              <dt className="text-xs font-semibold text-zinc-200">{name}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-zinc-500">{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
