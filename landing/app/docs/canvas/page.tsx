import type { Metadata } from "next";
import { DocTitle, Section, P, UL, C, Kbd, Callout, PrevNext } from "@/components/docs-ui";

export const metadata: Metadata = {
  title: "The canvas — CodeGrid Docs",
  description: "Pan, zoom, drag, resize, and tile your agent panes with AUTO, FOCUS, COLS, ROWS, GRID, and FIT.",
  alternates: { canonical: "https://www.codegrid.app/docs/canvas" },
};

export default function Page() {
  return (
    <>
      <DocTitle title="The canvas" intro="An infinite surface for arranging your agents exactly how you think." />

      <Section title="Navigating">
        <UL items={[
          <><b className="text-text-primary">Pan</b> — drag empty canvas, or trackpad two-finger scroll.</>,
          <><b className="text-text-primary">Zoom</b> — pinch, or <C>⌘</C>+scroll. The current zoom shows in the toolbar.</>,
          <><b className="text-text-primary">Move a pane</b> — drag its title bar. <b className="text-text-primary">Resize</b> — drag any edge or corner.</>,
          <><b className="text-text-primary">Lock</b> — the <C>UNLCK/LOCK</C> toggle freezes the canvas so you don&apos;t move panes by accident.</>,
        ]} />
      </Section>

      <Section title="Layout presets">
        <P>The toolbar at the top-right of the canvas tiles every pane instantly and resets zoom to 1:1:</P>
        <UL items={[
          <><b className="text-text-primary">AUTO</b> — optimal grid for any number of panes (the everyday default).</>,
          <><b className="text-text-primary">FOCUS</b> — one large main pane with the rest stacked in a sidebar.</>,
          <><b className="text-text-primary">COLS</b> / <b className="text-text-primary">ROWS</b> — equal columns or equal rows.</>,
          <><b className="text-text-primary">GRID</b> — a strict N×M grid.</>,
          <><b className="text-text-primary">FIT</b> — zoom out so every pane fits in view (without re-arranging).</>,
        ]} />
        <Callout kind="tip">Lost a pane off-screen? Hit <b className="text-text-primary">FIT</b> to bring everything back into view, or <b className="text-text-primary">AUTO</b> to re-tile.</Callout>
      </Section>

      <Section title="Keyboard control">
        <UL items={[
          <><Kbd>⌘←→↑↓</Kbd> — move focus between panes by direction.</>,
          <><Kbd>⌘⇧←→↑↓</Kbd> — swap the focused pane with its neighbor.</>,
          <><Kbd>⌘1</Kbd>–<Kbd>⌘9</Kbd> — jump straight to a pane by number.</>,
          <><Kbd>⌘⏎</Kbd> — maximize the focused pane (press again to restore).</>,
        ]} />
      </Section>

      <Section title="Minimized panes">
        <P>Collapse a pane to a chip in the minimized bar to declutter without closing its session. Click the chip to restore it where it was.</P>
      </Section>

      <PrevNext current="/docs/canvas" />
    </>
  );
}
