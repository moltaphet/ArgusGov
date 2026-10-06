"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "How does ArgusGov prevent malicious griefing or vote disruption?",
    a: (
      <>
        <p>Every challenge needs an exact <strong>2.0 GEN bond</strong>, so flagging is never free. If validators judge the proposal safe, the bond is slashed automatically: <strong>50% goes to the DAO&apos;s security pool and 50% to a burn vault</strong> with no withdrawal path.</p>
        <p>The challenger is then locked out for a <strong>4-hour cooldown</strong>. Independent rate limits (3 flags per caller and 10 per DAO per 24 hours) cap how fast anyone can spam, and a committed proposal has one live flag at a time. One that validators judged safe can be challenged once more, at double the bond, so a single cheap bond cannot clear a malicious proposal for good.</p>
      </>
    ),
  },
  {
    q: "What happens if a forum post is edited or cloaked after inspection?",
    a: (
      <>
        <p>The execution side is immutable. The DAO&apos;s guardian (or timelock) commits the targets, native values, calldata and forum link once, and the contract stores a <code>keccak256(abi.encode(...))</code> <code>payload_hash</code> of them. A challenger cannot supply or alter any of it: flagging takes only a DAO key and a proposal id, so a stranger cannot freeze a real proposal with fabricated calldata.</p>
        <p>The forum post is different. Validators read it live during inspection and the contract does not snapshot it, so an edit made <em>after</em> the verdict is not re-read. What stays on-chain is the score and the full reasoning text. A post that cannot be read at all is treated as <strong>no declared intent</strong>, which makes every privileged call an undisclosed action.</p>
      </>
    ),
  },
  {
    q: "Can a DAO appeal an automated circuit breaker freeze?",
    a: (
      <>
        <p>Yes. The DAO guardian has a <strong>24-hour window</strong> after a malicious verdict and must post a <strong>2x counter-bond</strong> (4.0 GEN against the standard bond). The record moves to <code>CHALLENGED_PAUSED</code> and execution stays frozen while the appeal is pending.</p>
        <p>Anyone can then trigger <code>resolve_appeal</code>, which runs a <strong>fresh validator consensus round</strong>. If the flag is upheld, the appellant&apos;s bond is split between the challenger and the burn vault. If it is overturned, the appellant is refunded, the freeze lifts, and the challenger is treated as a false alarm.</p>
      </>
    ),
  },
  {
    q: "Which networks and governance frameworks are supported?",
    a: (
      <>
        <p>ArgusGov is a native GenLayer intelligent contract (Python on GenVM), currently deployed on <strong>GenLayer Studio Next, Chain ID 61997</strong>. It judges a proposal from its target addresses and calldata, so it can assess any proposal that has that shape, including OpenZeppelin Governor and Compound-style timelock proposals.</p>
        <p>Integration is deliberately explicit: the contract does not watch other chains and ships no framework adapters yet. The guardian commits each proposal, a DAO compares <code>payload_hash</code> with its own proposal hash, and its execution guard passes that hash to <code>is_execution_frozen</code>, which answers true only for a payload that matches the commitment byte for byte. Because the guardian is whoever registered the DAO first (until the timelock claims the role), integrators should check the guardian address too.</p>
      </>
    ),
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <section id="faq" className="scroll-mt-6 pt-16" aria-labelledby="faq-heading">
      <div className="mx-auto max-w-2xl text-center">
        <span className="eyebrow">FAQ</span>
        <h2 id="faq-heading" className="mt-2 text-3xl font-semibold tracking-tight text-zinc-100">Institutional questions</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-400">What reviewers and DAO operators ask before they rely on a circuit breaker.</p>
      </div>
      <div className="mx-auto mt-9 max-w-3xl space-y-3">
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className={`surface overflow-hidden transition-all duration-300 hover:border-zinc-500/50 hover:bg-zinc-800/40 ${isOpen ? "!border-indigo-300/30 shadow-[0_0_36px_-12px_rgba(129,140,248,0.45)]" : ""}`}>
              <h3>
                <button type="button" id={`${base}-q${i}`} aria-expanded={isOpen} aria-controls={`${base}-a${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="group flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/60">
                  {item.q}
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] ${isOpen ? "rotate-180 border-indigo-300/40 bg-indigo-400/10 text-indigo-200 shadow-[0_0_18px_rgba(129,140,248,0.5)]" : "border-white/[0.08] text-zinc-500 group-hover:text-zinc-300"}`}>
                    <ChevronDown size={15} />
                  </span>
                </button>
              </h3>
              <div id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`}
                className={`grid transition-all duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)] ${isOpen ? "grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] -translate-y-1 opacity-0"}`}>
                <div className="overflow-hidden">
                  <div className="space-y-3 border-t border-white/[0.06] px-5 pb-5 pt-4 text-[13.5px] leading-relaxed text-zinc-400 [&_code]:rounded [&_code]:bg-white/[0.07] [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-zinc-200 [&_strong]:font-semibold [&_strong]:text-zinc-200">
                    {item.a}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
