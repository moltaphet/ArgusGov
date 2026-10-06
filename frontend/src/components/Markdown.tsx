import { Fragment } from "react";
import { findAmountMentions } from "@/lib/intent";

// A deliberately small markdown renderer (headings, lists, bold, inline code,
// paragraphs). It builds React elements only, so forum text can never inject
// markup. Promised amounts are highlighted so they can be read against the calldata.

function Highlighted({ text }: { text: string }) {
  const mentions = findAmountMentions(text);
  if (mentions.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  mentions.forEach((m, i) => {
    if (m.start < cursor) return;
    parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark key={i} className="rounded bg-amber-400/15 px-1 py-px font-medium text-amber-200 ring-1 ring-inset ring-amber-400/25" title="Promised expenditure">
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  parts.push(text.slice(cursor));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

function Inline({ text }: { text: string }) {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.startsWith("**") && t.endsWith("**") && t.length > 4) return <strong key={i} className="font-semibold text-zinc-100"><Highlighted text={t.slice(2, -2)} /></strong>;
        if (t.startsWith("`") && t.endsWith("`") && t.length > 2) return <code key={i} className="rounded bg-white/[0.07] px-1 py-px font-mono text-[12px] text-zinc-200">{t.slice(1, -1)}</code>;
        return <Highlighted key={i} text={t} />;
      })}
    </>
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = source.split("\n");
  let list: string[] = [];
  let paragraph: string[] = [];
  const flushList = () => {
    if (list.length) blocks.push(<ul key={blocks.length} className="ml-4 list-disc space-y-1 marker:text-zinc-600">{list.map((l, i) => <li key={i}><Inline text={l} /></li>)}</ul>);
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}><Inline text={paragraph.join(" ")} /></p>);
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line) { flushList(); flushParagraph(); continue; }
    if (heading) {
      flushList(); flushParagraph();
      blocks.push(<h4 key={blocks.length} className="pt-1 text-[13px] font-semibold text-zinc-100"><Inline text={heading[2]} /></h4>);
    } else if (item) {
      flushParagraph(); list.push(item[1]);
    } else {
      flushList(); paragraph.push(line);
    }
  }
  flushList(); flushParagraph();
  return <div className="space-y-2.5 text-[13px] leading-relaxed text-zinc-400">{blocks}</div>;
}
